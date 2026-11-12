import { renderPageToCanvas, type PdfJsDocument } from '../../lib/pdfjs'
import { itemsToWords, type PdfTextItemLike, type TextBox } from '../../lib/tableExtract'
import { toDarkImage, type DarkImage } from '../../lib/tableRulings'

/** Mots d'une page, dans le repère de la page affichée (points, origine en haut à gauche). */
export interface PageText {
  words: TextBox[]
  width: number
  height: number
  /** `pdf` : couche texte du fichier ; `ocr` : relecture par l'OCR intégré. */
  source: 'pdf' | 'ocr'
}

/** Lit la couche texte existante de la page (texte natif ou OCR déjà présent). */
export async function readPageText(pdf: PdfJsDocument, pageIndex: number): Promise<PageText> {
  const page = await pdf.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const items = content.items.filter((item) => 'str' in item) as PdfTextItemLike[]
  return {
    words: itemsToWords(items, viewport.transform),
    width: viewport.width,
    height: viewport.height,
    source: 'pdf',
  }
}

/**
 * Relit la page avec l'OCR intégré (page sans couche texte, ou couche texte de
 * mauvaise qualité). Rendu à 300 dpi environ, plafonné pour la mémoire.
 */
export async function ocrPageText(
  pdf: PdfJsDocument,
  pageIndex: number,
  onProgress?: (p: number) => void
): Promise<PageText> {
  const page = await pdf.getPage(pageIndex + 1)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(300 / 72, 4200 / Math.max(base.width, base.height))
  const canvas = await renderPageToCanvas(pdf, pageIndex + 1, scale)
  // tesseract n'est chargé qu'à la première utilisation
  const { recognizeCanvas } = await import('../../lib/ocr')
  const result = await recognizeCanvas(canvas, onProgress)
  canvas.width = 0
  canvas.height = 0
  return {
    words: result.words.map((w) => ({
      text: w.text,
      x0: w.x0 / scale,
      y0: w.y0 / scale,
      x1: w.x1 / scale,
      y1: w.y1 / scale,
    })),
    width: base.width,
    height: base.height,
    source: 'ocr',
  }
}

/** Image binarisée d'un canvas de page (pour repérer les traits du tableau). */
export function canvasToDark(canvas: HTMLCanvasElement): DarkImage {
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
  return toDarkImage(pixels.data, canvas.width, canvas.height)
}

/** Image binarisée d'une page qui n'a pas encore été affichée. */
export async function readPageImage(pdf: PdfJsDocument, pageIndex: number): Promise<DarkImage> {
  const page = await pdf.getPage(pageIndex + 1)
  const base = page.getViewport({ scale: 1 })
  const canvas = await renderPageToCanvas(pdf, pageIndex + 1, Math.min(2.35, 1400 / base.width))
  const image = canvasToDark(canvas)
  canvas.width = 0
  canvas.height = 0
  return image
}
