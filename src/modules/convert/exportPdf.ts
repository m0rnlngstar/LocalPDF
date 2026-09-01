import type { ConvertItem } from './types'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export interface BuildPdfOptions {
  /** Ajoute une couche de texte invisible (OCR) sur les pages issues d'images. */
  ocr?: boolean
  onOcrProgress?: (done: number, total: number) => void
}

/** Assemble tous les éléments prêts, dans l'ordre de la liste, en un seul PDF. */
export async function buildFinalPdf(
  items: ConvertItem[],
  { ocr = false, onOcrProgress }: BuildPdfOptions = {}
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const out = await PDFDocument.create()

  const ocrTotal = ocr
    ? items.reduce((n, it) => n + (it.status === 'ready' && it.kind === 'pages' && it.isImage ? it.pages!.length : 0), 0)
    : 0
  let ocrDone = 0
  const font = ocrTotal > 0 ? await out.embedFont(StandardFonts.Helvetica) : null

  for (const item of items) {
    if (item.status !== 'ready') continue

    if (item.kind === 'pdf' && item.bytes) {
      const src = await PDFDocument.load(item.bytes)
      const copied = await out.copyPages(src, src.getPageIndices())
      for (const p of copied) out.addPage(p)
    } else if (item.kind === 'pages' && item.pages) {
      for (const pg of item.pages) {
        const bytes = await fetch(pg.dataUrl).then((r) => r.arrayBuffer())
        const image = await out.embedPng(bytes)
        const page = out.addPage([pg.width, pg.height])
        page.drawImage(image, { x: 0, y: 0, width: pg.width, height: pg.height })

        if (ocr && item.isImage && font) {
          const { recognizeCanvas } = await import('../../lib/ocr')
          const { preprocessForOcr } = await import('../../lib/preprocess')
          const img = await loadImage(pg.dataUrl)
          const raw = document.createElement('canvas')
          raw.width = img.naturalWidth
          raw.height = img.naturalHeight
          raw.getContext('2d')!.drawImage(img, 0, 0)
          const canvas = preprocessForOcr(raw, { binarize: true })
          const pxPerPt = canvas.width / pg.width
          const { words } = await recognizeCanvas(canvas)
          for (const w of words) {
            const fontSize = Math.max(4, (w.y1 - w.y0) / pxPerPt)
            page.drawText(w.text, {
              x: w.x0 / pxPerPt,
              y: pg.height - w.y1 / pxPerPt,
              size: fontSize,
              font,
              color: rgb(0, 0, 0),
              opacity: 0,
            })
          }
          ocrDone++
          onOcrProgress?.(ocrDone, ocrTotal)
        }
      }
    }
  }

  return out.save()
}

export { downloadBytes } from '../create/exportPdf'
