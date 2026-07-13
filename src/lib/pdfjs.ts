import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Le worker pdf.js est servi en local par Vite : aucun CDN, aucun réseau.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export type PdfJsDocument = pdfjsLib.PDFDocumentProxy

/** Ouvre un PDF depuis des octets (copie interne, le buffer source reste utilisable). */
export async function openPdf(data: ArrayBuffer | Uint8Array): Promise<PdfJsDocument> {
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0))
  return pdfjsLib.getDocument({ data: bytes }).promise
}

/**
 * Rend une page dans un canvas hors-écran et le retourne.
 * `scale` en multiple de 72 dpi (1 = taille réelle PDF).
 */
export async function renderPageToCanvas(
  doc: PdfJsDocument,
  pageNumber: number,
  scale = 1.5
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')!
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  return canvas
}
