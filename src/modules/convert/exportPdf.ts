import type { ConvertItem } from './types'

/** Assemble tous les éléments prêts, dans l'ordre de la liste, en un seul PDF. */
export async function buildFinalPdf(items: ConvertItem[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const out = await PDFDocument.create()

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
      }
    }
  }

  return out.save()
}

export { downloadBytes } from '../create/exportPdf'
