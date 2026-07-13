import { openPdf } from '../../lib/pdfjs'
import { recognizeCanvas } from '../../lib/ocr'
import { getSplitVerifier } from './hooks'

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
  /** Vérifier chaque coupure proposée avec le LLM local (WebGPU). */
  useLlm: boolean
  /** Identifiant du modèle WebLLM à utiliser. */
  llmModel: string
}

export const DEFAULT_CONFIG: SmartSplitConfig = {
  patterns: ['Facture\\s+n[°o]', 'Num[ée]ro de facture', 'Invoice\\s+#?\\d'],
  usePatterns: true,
  useBlank: true,
  blankInkPct: 0.1,
  useVisual: false,
  visualThreshold: 24,
  excludeBlank: true,
  useLlm: false,
  llmModel: 'onnx-community/gemma-4-E2B-it-ONNX',
}

export interface PageAnalysis {
  index: number
  thumb: string
  /**
   * Rendu ~700 px (JPEG, data URL) pour le vérificateur LLM multimodal —
   * assez grand pour lire les en-têtes. Vide quand le LLM est désactivé.
   */
  render: string
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

/** Bilan de la passe LLM, pour que l'UI montre ce que l'IA a réellement fait. */
export interface LlmReport {
  /** Frontières effectivement soumises au modèle. */
  examined: number
  confirmed: number
  removed: number
  added: number
  /** Message d'erreur si le moteur a lâché en cours de passe. */
  failed: string | null
}

export interface CutsResult {
  cuts: CutInfo[]
  /** null si la vérification IA n'était pas active. */
  llm: LlmReport | null
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

    // Rendu intermédiaire pour le vérificateur multimodal (Gemma 4) : les
    // miniatures 160 px sont illisibles pour un modèle de vision.
    let render = ''
    if (config.useLlm) {
      const mid = document.createElement('canvas')
      const mScale = Math.min(700 / canvas.width, 1)
      mid.width = Math.round(canvas.width * mScale)
      mid.height = Math.round(canvas.height * mScale)
      mid.getContext('2d')!.drawImage(canvas, 0, 0, mid.width, mid.height)
      render = mid.toDataURL('image/jpeg', 0.8)
    }

    // Texte de la page : couche texte embarquée d'abord (PDF numériques —
    // fiable et instantané), OCR seulement si elle est vide ou squelettique
    // (scans, ou pages composées d'images).
    let text = ''
    if (!isBlank) {
      const content = await page.getTextContent()
      text = content.items
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text.length < 50) {
        const { text: t } = await recognizeCanvas(canvas, (pct) =>
          onProgress({ page: i, totalPages: pdf.numPages, phase: 'ocr', pct })
        )
        text = t
      }
    }

    const matchedPattern = regexes.find((r) => r.test(text))?.source ?? null

    pages.push({
      index: i - 1,
      thumb: small.toDataURL(),
      render,
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
): Promise<CutsResult> {
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

  // Passe LLM optionnelle (réglages avancés) : chaque frontière entre deux
  // pages non blanches est examinée — les coupures proposées peuvent être
  // confirmées ou retirées, et le modèle peut AJOUTER une coupure que les
  // heuristiques ont manquée (uniquement sur un verdict net, jamais 'unsure').
  const verifySplitBoundary = getSplitVerifier()
  let llm: LlmReport | null = null
  if (verifySplitBoundary) {
    llm = { examined: 0, confirmed: 0, removed: 0, added: 0, failed: null }
    const boundaries: number[] = []
    for (let i = 1; i < pages.length; i++) {
      if (cuts.has(i) || (!pages[i - 1].isBlank && !pages[i].isBlank)) boundaries.push(i)
    }
    let done = 0
    for (const before of boundaries) {
      onProgress?.({
        page: before,
        totalPages: pages.length,
        phase: 'verify',
        pct: done++ / boundaries.length,
      })
      try {
        const verdict = await verifySplitBoundary(
          { index: before - 1, text: pages[before - 1].text, image: pages[before - 1].render },
          { index: before, text: pages[before].text, image: pages[before].render }
        )
        llm.examined++
        if (cuts.has(before)) {
          if (verdict === 'continue') {
            cuts.delete(before)
            llm.removed++
          } else if (verdict === 'new') {
            cuts.get(before)!.push('Confirmé par IA')
            llm.confirmed++
          }
        } else if (verdict === 'new') {
          addReason(before, 'Détecté par IA')
          llm.added++
        }
      } catch (err) {
        // Moteur indisponible : coupures conservées telles quelles, et on
        // n'insiste pas sur les frontières suivantes.
        console.warn('Vérification LLM indisponible :', err)
        llm.failed = err instanceof Error ? err.message : String(err)
        break
      }
    }
  }

  const list = [...cuts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([beforePage, reasons]) => ({ beforePage, reasons, manual: false }))
  return { cuts: list, llm }
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
