import { openPdf, type PdfJsDocument } from '../../lib/pdfjs'
import { displaySize, totalRotation, type EditPage } from './types'

/**
 * Rendu d'une page de travail (PDF, vierge ou image) vers un canvas,
 * rotation d'affichage appliquée. Les documents pdf.js sont mis en cache
 * par docId pour éviter de re-parser les octets à chaque rendu.
 */

const docCache = new Map<string, Promise<PdfJsDocument>>()

export function getPdfDoc(docId: string, bytes: ArrayBuffer): Promise<PdfJsDocument> {
  let doc = docCache.get(docId)
  if (!doc) {
    doc = openPdf(bytes)
    docCache.set(docId, doc)
  }
  return doc
}

export function clearDocCache() {
  docCache.clear()
}

const imageCache = new Map<string, Promise<HTMLImageElement>>()

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  let p = imageCache.get(dataUrl)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = dataUrl
    })
    imageCache.set(dataUrl, p)
  }
  return p
}

/** Rend la page à l'échelle donnée (1 = taille réelle en points PDF). */
export async function renderEditPage(
  page: EditPage,
  docs: Record<string, ArrayBuffer>,
  scale: number
): Promise<HTMLCanvasElement> {
  const { width, height } = displaySize(page)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * scale)
  canvas.height = Math.ceil(height * scale)
  const ctx = canvas.getContext('2d')!

  if (page.source.kind === 'pdf') {
    const doc = await getPdfDoc(page.source.docId, docs[page.source.docId])
    const pdfPage = await doc.getPage(page.source.pageIndex + 1)
    // pdf.js : le paramètre rotation est ABSOLU (remplace la rotation propre)
    const viewport = pdfPage.getViewport({ scale, rotation: totalRotation(page) })
    await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise
    return canvas
  }

  // Pages vierges et images : fond blanc
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  if (page.source.kind === 'image') {
    const img = await loadImage(page.source.dataUrl)
    const rot = totalRotation(page)
    ctx.save()
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((rot * Math.PI) / 180)
    const w = page.source.width * scale
    const h = page.source.height * scale
    ctx.drawImage(img, -w / 2, -h / 2, w, h)
    ctx.restore()
  }

  return canvas
}
