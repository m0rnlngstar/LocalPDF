import type { ConvertItem } from './types'
import { downloadBytes } from '../create/exportPdf'
import { pageToCanvas, releaseCanvas } from './raster'

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
        // JPEG intégré tel quel par pdf-lib (pas de décodage, contrairement au PNG)
        const image = await out.embedJpg(await pg.blob.arrayBuffer())
        const page = out.addPage([pg.width, pg.height])
        page.drawImage(image, { x: 0, y: 0, width: pg.width, height: pg.height })

        if (ocr && item.isImage && font) {
          const { recognizeCanvas } = await import('../../lib/ocr')
          const { preprocessForOcr } = await import('../../lib/preprocess')
          const raw = await pageToCanvas(pg)
          const canvas = preprocessForOcr(raw, { binarize: true })
          releaseCanvas(raw)
          const pxPerPt = canvas.width / pg.width
          const { words } = await recognizeCanvas(canvas)
          releaseCanvas(canvas)
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

/** Nom de sortie : même nom que le fichier source, extension remplacée par .pdf. */
function pdfName(name: string): string {
  return name.replace(/\.[^./\\]+$/, '') + '.pdf'
}

/**
 * Convertit chaque élément prêt en un PDF distinct, nommé comme son fichier source.
 * Un seul fichier → téléchargement PDF direct ; plusieurs → archive .zip.
 */
export async function exportSeparatePdfs(
  items: ConvertItem[],
  zipName: string,
  { ocr = false, onOcrProgress }: BuildPdfOptions = {}
): Promise<number> {
  const ready = items.filter((i) => i.status === 'ready')
  if (ready.length === 0) return 0

  const ocrTotal = ocr
    ? ready.reduce((n, it) => n + (it.kind === 'pages' && it.isImage ? it.pages!.length : 0), 0)
    : 0
  let ocrOffset = 0
  const used = new Set<string>()
  const files: { name: string; bytes: Uint8Array }[] = []

  for (const item of ready) {
    const bytes = await buildFinalPdf([item], {
      ocr,
      onOcrProgress: (done) => onOcrProgress?.(ocrOffset + done, ocrTotal),
    })
    if (ocr && item.kind === 'pages' && item.isImage) ocrOffset += item.pages!.length

    // Déduplique les noms identiques (ex. photo.jpg et photo.png → photo.pdf, photo (2).pdf)
    const base = pdfName(item.name)
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) name = base.replace(/\.pdf$/, ` (${n}).pdf`)
    used.add(name.toLowerCase())
    files.push({ name, bytes })
  }

  if (files.length === 1) {
    downloadBytes(files[0].bytes, files[0].name)
    return 1
  }

  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  for (const f of files) zip.file(f.name, f.bytes)
  // Pas de recompression : les PDF (images JPEG) ne gagneraient presque rien, pour beaucoup de CPU
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  downloadBytes(new Uint8Array(await blob.arrayBuffer()), zipName, 'application/zip')
  return files.length
}

export { downloadBytes }
