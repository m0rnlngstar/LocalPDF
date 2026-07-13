import { createWorker, type Worker } from 'tesseract.js'

/**
 * Moteur OCR partagé (modules OCR et Splitteur intelligent).
 *
 * 100% local : le worker, le cœur WASM et les modèles fra/eng sont servis par
 * l'application elle-même (public/tesseract, public/tessdata) — aucun CDN.
 * Le worker tesseract est créé en LAZY au premier usage puis réutilisé ;
 * les modèles sont mis en cache par tesseract.js dans IndexedDB.
 */

export interface OcrWord {
  text: string
  /** Boîte englobante en pixels de l'image analysée. */
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrResult {
  text: string
  words: OcrWord[]
}

/**
 * Deux jeux de modèles sont embarqués : `fast` (léger, ~2,5 Mo, chargé par
 * défaut) et `best` (float LSTM, ~16 Mo, nettement plus précis sur les
 * scans/photos difficiles). Chaque jeu a son propre cachePath IndexedDB.
 */
export type OcrQuality = 'fast' | 'best'

const QUALITY_KEY = 'ocr-quality'
let currentQuality: OcrQuality =
  localStorage.getItem(QUALITY_KEY) === 'best' ? 'best' : 'fast'

let workerPromise: Promise<Worker> | null = null
/** Callback de progression de la reconnaissance EN COURS (0..1). */
let currentProgress: ((p: number) => void) | null = null

export function getOcrQuality(): OcrQuality {
  return currentQuality
}

/** Change de jeu de modèles ; le worker sera recréé au prochain usage. */
export function setOcrQuality(quality: OcrQuality) {
  if (quality === currentQuality) return
  currentQuality = quality
  localStorage.setItem(QUALITY_KEY, quality)
  const old = workerPromise
  workerPromise = null
  void old?.then((w) => w.terminate()).catch(() => {})
}

function getWorker(): Promise<Worker> {
  workerPromise ??= (async () => {
    const dataDir = currentQuality === 'best' ? '/tessdata-best' : '/tessdata'
    const worker = await createWorker(['fra', 'eng'], 1, {
      workerPath: '/tesseract/worker.min.js',
      // Les modèles best (float) exigent le cœur complet ET la variante simd :
      // les cœurs « -lstm » n'embarquent pas les fonctions float, et les builds
      // « relaxedsimd » (choisis en priorité par tesseract.js sur Chrome)
      // référencent DotProductSSE sans l'implémenter → abort au chargement.
      corePath:
        currentQuality === 'best'
          ? '/tesseract/core/tesseract-core-simd.wasm.js'
          : '/tesseract/core',
      langPath: dataDir,
      cachePath: dataDir,
      legacyCore: currentQuality === 'best',
      legacyLang: currentQuality === 'best',
      logger: (m) => {
        if (m.status === 'recognizing text') currentProgress?.(m.progress)
      },
    })
    // Les images/canvas n'ont pas de DPI : sans cette valeur, tesseract
    // le devine (mal) et dégrade sa segmentation.
    await worker.setParameters({ user_defined_dpi: '300' })
    return worker
  })()
  return workerPromise
}

/** Parcourt la hiérarchie blocs → paragraphes → lignes → mots. */
interface BlocksLike {
  blocks?: {
    paragraphs?: { lines?: { words?: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[]
  }[] | null
}

function collectWords(data: BlocksLike): OcrWord[] {
  const words: OcrWord[] = []
  for (const block of data.blocks ?? []) {
    for (const par of block.paragraphs ?? []) {
      for (const line of par.lines ?? []) {
        for (const w of line.words ?? []) {
          if (w.text.trim()) {
            words.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 })
          }
        }
      }
    }
  }
  return words
}

/**
 * Reconnaît le texte d'un canvas. Les reconnaissances sont sérialisées
 * (un seul worker) ; `onProgress` reçoit la progression réelle 0..1.
 */
let queue: Promise<unknown> = Promise.resolve()

export function recognizeCanvas(
  canvas: HTMLCanvasElement,
  onProgress?: (p: number) => void
): Promise<OcrResult> {
  const run = async (): Promise<OcrResult> => {
    const worker = await getWorker()
    currentProgress = onProgress ?? null
    try {
      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true })
      return { text: data.text ?? '', words: collectWords(data as BlocksLike) }
    } finally {
      currentProgress = null
    }
  }
  const result = queue.then(run, run)
  queue = result.catch(() => {})
  return result
}
