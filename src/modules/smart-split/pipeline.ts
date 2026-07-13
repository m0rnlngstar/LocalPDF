import { openPdf } from '../../lib/pdfjs'
import { recognizeCanvas } from '../../lib/ocr'
import { verifySplitBoundary } from './hooks'

/**
 * Pipeline d'analyse du Splitteur intelligent.
 *
 * Pour chaque page : rendu → détection de page blanche (taux d'encre) →
 * hash perceptuel (aHash 8×8) → OCR (sauf pages blanches).
 * Puis proposition de coupures à partir de trois signaux :
 *   1. motifs regex configurables détectés dans le texte OCR (début de doc)
 *   2. page blanche utilisée comme séparateur (coupure après la blanche)
 *   3. rupture de similarité visuelle entre pages consécutives (signal secondaire)
 * Enfin, si un vérificateur LLM est branché (hooks.ts), chaque coupure lui est
 * soumise pour confirmation.
 */

export interface SmartSplitConfig {
  /** Motifs (regex, insensibles à la casse), un par ligne côté UI. */
  patterns: string[]
  usePatterns: boolean
  useBlank: boolean
  /** % de pixels encrés en dessous duquel une page est considérée blanche (0..5). */
  blankInkPct: number
  useVisual: boolean
  /** Distance de Hamming (0..64) au-delà de laquelle on suggère une coupure. */
  visualThreshold: number
  /** Retirer les pages blanches des fichiers exportés. */
  excludeBlank: boolean
}

export const DEFAULT_CONFIG: SmartSplitConfig = {
  patterns: ['Facture\\s+n[°o]', 'Invoice\\s+#?\\d'],
  usePatterns: true,
  useBlank: true,
  blankInkPct: 0.1,
  useVisual: false,
  visualThreshold: 24,
  excludeBlank: true,
}

export interface PageAnalysis {
  index: number
  thumb: string
  text: string
  inkRatio: number
  isBlank: boolean
  phash: Uint8Array
  /** Motif regex ayant matché (le premier), s'il y en a un. */
  matchedPattern: string | null
}

export interface CutInfo {
  /** Coupure placée AVANT cette page (1-based côté affichage). */
  beforePage: number
  reasons: string[]
  manual: boolean
}

export interface AnalysisProgress {
  page: number
  totalPages: number
  phase: 'render' | 'analyse' | 'ocr' | 'verify'
  pct: number
}

/**
 * Taux de pixels « encrés » d'un canvas réduit. Seuil de luminance à 245 :
 * sur une miniature, le texte anti-aliasé devient gris clair — un seuil trop
 * bas ferait passer les pages peu denses pour blanches.
 */
function computeInkRatio(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d')!
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let ink = 0
  const total = canvas.width * canvas.height
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    if (lum < 245) ink++
  }
  return ink / total
}

/** aHash 8×8 : 64 bits, 1 si le pixel est plus sombre que la moyenne. */
function computePhash(source: HTMLCanvasElement): Uint8Array {
  const c = document.createElement('canvas')
  c.width = 8
  c.height = 8
  const ctx = c.getContext('2d')!
  ctx.drawImage(source, 0, 0, 8, 8)
  const { data } = ctx.getImageData(0, 0, 8, 8)
  const lums: number[] = []
  for (let i = 0; i < data.length; i += 4) {
    lums.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
  }
  const mean = lums.reduce((a, b) => a + b, 0) / 64
  const hash = new Uint8Array(8)
  lums.forEach((l, i) => {
    if (l < mean) hash[i >> 3] |= 1 << (i & 7)
  })
  return hash
}

export function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  let d = 0
  for (let i = 0; i < 8; i++) {
    let x = a[i] ^ b[i]
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d
}

export async function analyzeDocument(
  bytes: ArrayBuffer,
  config: SmartSplitConfig,
  onProgress: (p: AnalysisProgress) => void,
  isCancelled: () => boolean
): Promise<PageAnalysis[]> {
  const pdf = await openPdf(bytes)
  const pages: PageAnalysis[] = []
  const regexes = config.usePatterns
    ? config.patterns.filter(Boolean).map((p) => new RegExp(p, 'i'))
    : []

  for (let i = 1; i <= pdf.numPages; i++) {
    if (isCancelled()) break
    onProgress({ page: i, totalPages: pdf.numPages, phase: 'render', pct: 0 })
    const page = await pdf.getPage(i)
    const vp0 = page.getViewport({ scale: 1 })

    // Rendu OCR (largeur ~1300 px) — sert aussi de base aux analyses visuelles
    const scale = Math.min(1300 / vp0.width, 2.5)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise

    onProgress({ page: i, totalPages: pdf.numPages, phase: 'analyse', pct: 0 })
    // Version réduite pour taux d'encre + hash + miniature
    const small = document.createElement('canvas')
    const sScale = 160 / canvas.width
    small.width = 160
    small.height = Math.round(canvas.height * sScale)
    small.getContext('2d')!.drawImage(canvas, 0, 0, small.width, small.height)

    const inkRatio = computeInkRatio(small)
    const isBlank = inkRatio * 100 < config.blankInkPct
    const phash = computePhash(small)

    let text = ''
    if (!isBlank) {
      const { text: t } = await recognizeCanvas(canvas, (pct) =>
        onProgress({ page: i, totalPages: pdf.numPages, phase: 'ocr', pct })
      )
      text = t
    }

    const matchedPattern = regexes.find((r) => r.test(text))?.source ?? null

    pages.push({
      index: i - 1,
      thumb: small.toDataURL(),
      text,
      inkRatio,
      isBlank,
      phash,
      matchedPattern,
    })
  }
  return pages
}

/** Propose les coupures à partir des analyses de pages. */
export async function proposeCuts(
  pages: PageAnalysis[],
  config: SmartSplitConfig,
  onProgress?: (p: AnalysisProgress) => void
): Promise<CutInfo[]> {
  const cuts = new Map<number, string[]>()

  function addReason(before: number, reason: string) {
    const r = cuts.get(before) ?? []
    r.push(reason)
    cuts.set(before, r)
  }

  for (let i = 1; i < pages.length; i++) {
    const prev = pages[i - 1]
    const cur = pages[i]

    if (config.usePatterns && cur.matchedPattern) {
      addReason(i, `Motif « ${cur.matchedPattern} »`)
    }
    if (config.useBlank && prev.isBlank && !cur.isBlank) {
      addReason(i, 'Après page blanche')
    }
    if (config.useVisual && !prev.isBlank && !cur.isBlank) {
      const d = hammingDistance(prev.phash, cur.phash)
      if (d > config.visualThreshold) {
        addReason(i, `Rupture visuelle (distance ${d})`)
      }
    }
  }

  // Vérification LLM optionnelle (point d'extension, non branché par défaut)
  if (verifySplitBoundary) {
    for (const [before, reasons] of [...cuts.entries()]) {
      onProgress?.({ page: before, totalPages: pages.length, phase: 'verify', pct: 0 })
      const ok = await verifySplitBoundary(
        { index: before - 1, text: pages[before - 1].text, thumb: pages[before - 1].thumb },
        { index: before, text: pages[before].text, thumb: pages[before].thumb }
      )
      if (!ok) cuts.delete(before)
      else reasons.push('Confirmé par LLM')
    }
  }

  return [...cuts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([beforePage, reasons]) => ({ beforePage, reasons, manual: false }))
}

/** Construit les segments finaux à partir des coupures validées. */
export function buildSegments(
  pages: PageAnalysis[],
  cuts: CutInfo[],
  excludeBlank: boolean
): number[][] {
  const cutSet = new Set(cuts.map((c) => c.beforePage))
  const segments: number[][] = []
  let current: number[] = []
  for (let i = 0; i < pages.length; i++) {
    if (cutSet.has(i) && current.length) {
      segments.push(current)
      current = []
    }
    if (excludeBlank && pages[i].isBlank) continue
    current.push(i)
  }
  if (current.length) segments.push(current)
  return segments
}
