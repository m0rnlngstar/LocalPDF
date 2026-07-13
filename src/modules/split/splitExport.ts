import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
import { downloadBytes } from '../create/exportPdf'

/**
 * Export de segments d'un PDF : un fichier par segment.
 * Un seul segment → téléchargement PDF direct ; plusieurs → archive .zip.
 * Partagé entre l'Éclateur et le Splitteur intelligent.
 */

export interface Segment {
  /** Indices de pages (0-based) dans le document source. */
  pages: number[]
  /** Nom de fichier proposé (sans extension). */
  name: string
}

export async function buildSubsetPdf(srcBytes: ArrayBuffer, pageIndices: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(srcBytes)
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, pageIndices)
  for (const p of copied) out.addPage(p)
  return out.save()
}

export async function exportSegments(
  srcBytes: ArrayBuffer,
  segments: Segment[],
  zipName: string,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  if (segments.length === 0) return

  if (segments.length === 1) {
    const bytes = await buildSubsetPdf(srcBytes, segments[0].pages)
    downloadBytes(bytes, `${segments[0].name}.pdf`)
    return
  }

  const zip = new JSZip()
  // Un seul chargement du document source pour tous les segments
  const src = await PDFDocument.load(srcBytes)
  let done = 0
  for (const seg of segments) {
    const out = await PDFDocument.create()
    const copied = await out.copyPages(src, seg.pages)
    for (const p of copied) out.addPage(p)
    zip.file(`${seg.name}.pdf`, await out.save())
    done++
    onProgress?.(done, segments.length)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  downloadBytes(bytes, zipName, 'application/zip')
}

/**
 * Analyse une saisie de plages type "1-3, 5, 7-9" (1-based) en segments.
 * Lève une Error avec message lisible si la saisie est invalide.
 */
export function parseRanges(input: string, pageCount: number): Segment[] {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Saisissez au moins une plage (ex. 1-3, 4-6)')
  const segments: Segment[] = []
  for (const part of trimmed.split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part)
    if (!m) throw new Error(`Plage invalide : « ${part.trim()} »`)
    const start = parseInt(m[1], 10)
    const end = m[2] ? parseInt(m[2], 10) : start
    if (start < 1 || end > pageCount || start > end) {
      throw new Error(`Plage hors limites : « ${part.trim()} » (document de ${pageCount} pages)`)
    }
    const pages = []
    for (let i = start - 1; i < end; i++) pages.push(i)
    segments.push({ pages, name: start === end ? `page-${start}` : `pages-${start}-${end}` })
  }
  return segments
}
