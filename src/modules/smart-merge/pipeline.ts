import { openPdf, type PdfJsDocument } from '../../lib/pdfjs'
import { recognizeCanvas } from '../../lib/ocr'
import { computePhash, hammingDistance } from '../smart-split/pipeline'
import type { MergeItem } from '../merge/store'
import { getMergeVerifier } from './hooks'

/**
 * Pipeline d'analyse de la Fusion intelligente.
 *
 * Pour chaque fichier (PDF ou image) : rendu de la première et de la dernière
 * page → texte (couche PDF puis OCR si besoin) → hash perceptuel (aHash 8×8).
 * Un ordre de fusion est ensuite proposé à partir du premier signal
 * disponible, par ordre de confiance :
 *   1. numéros de page détectés dans le texte (ex. « Page 2/5 »), cohérents
 *      entre eux (même total) ;
 *   2. chaînage visuel glouton : on relie chaque fichier à celui dont la
 *      première page ressemble le plus à la dernière page du précédent ;
 *   3. à défaut, ordre alphabétique (numérique) du nom de fichier.
 * Puis, si un vérificateur LLM est branché (hooks.ts), chaque jointure
 * proposée lui est soumise pour confirmation — à titre indicatif seulement,
 * l'ordre proposé n'est jamais modifié automatiquement par l'IA.
 */

export interface SmartMergeConfig {
  /** Motifs (regex) à 2 groupes capturants (numéro, total), un par ligne côté UI. */
  patterns: string[]
  usePageNumbers: boolean
  useVisualChaining: boolean
  /** Distance de Hamming (0..64) au-delà de laquelle une jointure visuelle est peu fiable. */
  visualThreshold: number
  /** Vérifier chaque jointure proposée avec le LLM local (WebGPU). */
  useLlm: boolean
  llmModel: string
}

export const DEFAULT_CONFIG: SmartMergeConfig = {
  patterns: [
    'Page\\s*n?[o°]?\\s*(\\d{1,4})\\s*(?:\\/|sur|of|de)\\s*(\\d{1,4})',
    '\\((\\d{1,4})\\s*\\/\\s*(\\d{1,4})\\)',
  ],
  usePageNumbers: true,
  useVisualChaining: true,
  visualThreshold: 24,
  useLlm: false,
  llmModel: 'onnx-community/gemma-4-E2B-it-ONNX',
}

export interface ItemAnalysis {
  firstThumb: string
  /** Rendus ~700 px pour le vérificateur LLM multimodal ; vides si l'IA est désactivée. */
  firstRender: string
  lastRender: string
  firstText: string
  lastText: string
  firstPhash: Uint8Array
  lastPhash: Uint8Array
  pageNumber: { num: number; total: number } | null
}

export interface AnalysisProgress {
  index: number
  total: number
  phase: 'render' | 'ocr' | 'verify'
  pct: number
}

export interface LlmReport {
  /** Jointures effectivement soumises au modèle. */
  examined: number
  confirmed: number
  flagged: number
  failed: string | null
}

export interface OrderResult {
  /** Identifiants des fichiers, dans l'ordre proposé. */
  order: string[]
  reasons: Map<string, string[]>
  method: 'numbers' | 'visual' | 'filename'
  llm: LlmReport | null
}

function shrink(source: HTMLCanvasElement, width: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  const scale = width / source.width
  c.width = width
  c.height = Math.max(1, Math.round(source.height * scale))
  c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height)
  return c
}

function midRender(source: HTMLCanvasElement): string {
  const mid = shrink(source, Math.min(700, source.width))
  return mid.toDataURL('image/jpeg', 0.8)
}

async function renderPdfPage(
  doc: PdfJsDocument,
  pageNumber: number,
  needText: boolean
): Promise<{ canvas: HTMLCanvasElement; text: string }> {
  const page = await doc.getPage(pageNumber)
  const vp0 = page.getViewport({ scale: 1 })
  const scale = Math.min(1300 / vp0.width, 2.5)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise

  let text = ''
  if (needText) {
    const content = await page.getTextContent()
    text = content.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length < 20) {
      const { text: t } = await recognizeCanvas(canvas)
      text = t
    }
  }
  return { canvas, text }
}

function loadImageCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      resolve(canvas)
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

/** Cherche un numéro de page dans le texte ; renvoie le premier motif qui matche avec un total cohérent. */
function detectPageNumber(text: string, regexes: RegExp[]): { num: number; total: number } | null {
  for (const re of regexes) {
    const m = re.exec(text)
    if (!m || !m[1] || !m[2]) continue
    const num = parseInt(m[1], 10)
    const total = parseInt(m[2], 10)
    if (Number.isFinite(num) && Number.isFinite(total) && total > 0 && num > 0 && num <= total) {
      return { num, total }
    }
  }
  return null
}

/** Tri naturel (numérique) du nom de fichier, utilisé comme repli sans autre signal. */
function byFilename(items: MergeItem[]): MergeItem[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }))
}

export async function analyzeItems(
  items: MergeItem[],
  config: SmartMergeConfig,
  onProgress: (p: AnalysisProgress) => void,
  isCancelled: () => boolean
): Promise<Map<string, ItemAnalysis>> {
  const result = new Map<string, ItemAnalysis>()
  const regexes = config.usePageNumbers
    ? config.patterns.filter(Boolean).map((p) => new RegExp(p, 'i'))
    : []
  const needText = config.usePageNumbers || config.useLlm

  for (let i = 0; i < items.length; i++) {
    if (isCancelled()) break
    const item = items[i]
    onProgress({ index: i, total: items.length, phase: 'render', pct: 0 })

    let firstCanvas: HTMLCanvasElement
    let lastCanvas: HTMLCanvasElement
    let firstText = ''
    let lastText = ''

    if (item.kind === 'pdf' && item.bytes) {
      const doc = await openPdf(item.bytes.slice(0))
      const first = await renderPdfPage(doc, 1, needText)
      firstCanvas = first.canvas
      firstText = first.text
      onProgress({ index: i, total: items.length, phase: 'ocr', pct: 0.5 })
      if (doc.numPages > 1) {
        const last = await renderPdfPage(doc, doc.numPages, needText)
        lastCanvas = last.canvas
        lastText = last.text
      } else {
        lastCanvas = firstCanvas
        lastText = firstText
      }
    } else {
      firstCanvas = await loadImageCanvas(item.dataUrl!)
      lastCanvas = firstCanvas
      if (needText) {
        onProgress({ index: i, total: items.length, phase: 'ocr', pct: 0.5 })
        const { text } = await recognizeCanvas(firstCanvas)
        firstText = text
        lastText = text
      }
    }

    const firstSmall = shrink(firstCanvas, 160)
    const lastSmall = lastCanvas === firstCanvas ? firstSmall : shrink(lastCanvas, 160)
    const firstPhash = computePhash(firstSmall)
    const lastPhash = lastCanvas === firstCanvas ? firstPhash : computePhash(lastSmall)

    const pageNumber = detectPageNumber(firstText, regexes) ?? detectPageNumber(lastText, regexes)
    const firstRender = config.useLlm ? midRender(firstCanvas) : ''
    const lastRender = config.useLlm ? (lastCanvas === firstCanvas ? firstRender : midRender(lastCanvas)) : ''

    result.set(item.id, {
      firstThumb: firstSmall.toDataURL(),
      firstRender,
      lastRender,
      firstText,
      lastText,
      firstPhash,
      lastPhash,
      pageNumber,
    })
  }
  return result
}

/** Propose un ordre de fusion à partir des analyses de fichiers. */
export async function proposeOrder(
  items: MergeItem[],
  analysis: Map<string, ItemAnalysis>,
  config: SmartMergeConfig,
  onProgress?: (p: AnalysisProgress) => void
): Promise<OrderResult> {
  const reasons = new Map<string, string[]>()
  function addReason(id: string, r: string) {
    const list = reasons.get(id) ?? []
    list.push(r)
    reasons.set(id, list)
  }

  let order: MergeItem[] | null = null
  let method: OrderResult['method'] = 'filename'

  // Signal 1 : numéros de page détectés, cohérents entre eux (même total)
  if (config.usePageNumbers) {
    const withNum = items
      .map((it) => ({ it, num: analysis.get(it.id)?.pageNumber ?? null }))
      .filter((x): x is { it: MergeItem; num: { num: number; total: number } } => x.num !== null)
    if (withNum.length >= 2) {
      const totalCounts = new Map<number, number>()
      for (const { num } of withNum) totalCounts.set(num.total, (totalCounts.get(num.total) ?? 0) + 1)
      const majorityTotal = [...totalCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      const consistent = withNum.filter((x) => x.num.total === majorityTotal)
      const nums = consistent.map((x) => x.num.num)
      const uniqueNums = new Set(nums).size === nums.length
      if (consistent.length >= 2 && uniqueNums) {
        const sortedConsistent = [...consistent].sort((a, b) => a.num.num - b.num.num)
        const consistentIds = new Set(consistent.map((x) => x.it.id))
        const rest = byFilename(items.filter((it) => !consistentIds.has(it.id)))
        order = [...sortedConsistent.map((x) => x.it), ...rest]
        method = 'numbers'
        for (const x of sortedConsistent) addReason(x.it.id, `Numéro détecté (${x.num.num}/${x.num.total})`)
        for (const it of rest) addReason(it.id, 'Aucun numéro détecté — placé par ordre alphabétique')
      }
    }
  }

  // Signal 2 : chaînage visuel glouton (plus proche voisin sur l'empreinte des pages)
  if (!order && config.useVisualChaining && items.length >= 2 && items.every((it) => analysis.get(it.id))) {
    const remaining = new Set(items.map((it) => it.id))

    // Point de départ : le fichier dont la 1ère page ressemble le moins à la
    // dernière page de tous les autres (donc le moins probable comme « suite »).
    let startId = items[0].id
    let bestScore = -Infinity
    for (const it of items) {
      const a = analysis.get(it.id)!
      let minDist = Infinity
      for (const other of items) {
        if (other.id === it.id) continue
        const d = hammingDistance(analysis.get(other.id)!.lastPhash, a.firstPhash)
        if (d < minDist) minDist = d
      }
      if (minDist > bestScore) {
        bestScore = minDist
        startId = it.id
      }
    }

    const chain: MergeItem[] = []
    let currentId = startId
    remaining.delete(currentId)
    chain.push(items.find((it) => it.id === currentId)!)
    addReason(currentId, 'Point de départ (aucune suite visuelle détectée avant)')

    while (remaining.size > 0) {
      const currentLast = analysis.get(currentId)!.lastPhash
      let bestId: string | null = null
      let bestDist = Infinity
      for (const id of remaining) {
        const d = hammingDistance(currentLast, analysis.get(id)!.firstPhash)
        if (d < bestDist) {
          bestDist = d
          bestId = id
        }
      }
      remaining.delete(bestId!)
      chain.push(items.find((it) => it.id === bestId)!)
      addReason(
        bestId!,
        `Chaînage visuel (distance ${bestDist}${bestDist > config.visualThreshold ? ' — confiance faible' : ''})`
      )
      currentId = bestId!
    }
    order = chain
    method = 'visual'
  }

  if (!order) {
    order = byFilename(items)
    method = 'filename'
    for (const it of order) addReason(it.id, 'Ordre alphabétique du nom de fichier (aucun autre signal)')
  }

  // Passe LLM optionnelle : chaque jointure proposée est soumise au modèle,
  // à titre indicatif — l'ordre n'est jamais modifié automatiquement.
  const verifyAdjacency = getMergeVerifier()
  let llm: LlmReport | null = null
  if (verifyAdjacency && order.length >= 2) {
    llm = { examined: 0, confirmed: 0, flagged: 0, failed: null }
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1]
      const b = order[i]
      const aAn = analysis.get(a.id)!
      const bAn = analysis.get(b.id)!
      onProgress?.({ index: i, total: order.length, phase: 'verify', pct: (i - 1) / order.length })
      try {
        const verdict = await verifyAdjacency(
          { index: i - 1, text: aAn.lastText, image: aAn.lastRender },
          { index: i, text: bAn.firstText, image: bAn.firstRender }
        )
        llm.examined++
        if (verdict === 'continue') {
          addReason(b.id, 'Enchaînement confirmé par IA')
          llm.confirmed++
        } else if (verdict === 'new') {
          addReason(b.id, 'IA : rupture possible ici — vérifiez cette jointure')
          llm.flagged++
        }
      } catch (err) {
        console.warn('Vérification LLM indisponible :', err)
        llm.failed = err instanceof Error ? err.message : String(err)
        break
      }
    }
  }

  return { order: order.map((it) => it.id), reasons, method, llm }
}
