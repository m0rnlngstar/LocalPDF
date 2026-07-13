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

let workerPromise: Promise<Worker> | null = null
/** Callback de progression de la reconnaissance EN COURS (0..1). */
let currentProgress: ((p: number) => void) | null = null

function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker(['fra', 'eng'], 1, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract/core',
    langPath: '/tessdata',
    logger: (m) => {
      if (m.status === 'recognizing text') currentProgress?.(m.progress)
    },
  })
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
