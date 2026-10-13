import { PDFDocument } from 'pdf-lib'
import { openPdf } from '../../lib/pdfjs'

/** Fichier source de la fusion intelligente (PDF ou image). */
export interface MergeItem {
  id: string
  name: string
  kind: 'pdf' | 'image'
  /** Octets du PDF (kind='pdf'). */
  bytes?: ArrayBuffer
  /** Data URL de l'image (kind='image'). */
  dataUrl?: string
  /** Dimensions de l'image en points (kind='image'). */
  width?: number
  height?: number
  pageCount: number
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function loadImageDims(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      // Plafonné à la largeur A4
      const ratio = Math.min(1, 595.28 / img.width)
      resolve({ width: img.width * ratio, height: img.height * ratio })
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Lit des fichiers PDF/image en `MergeItem[]`. */
export async function readFilesAsMergeItems(files: File[]): Promise<MergeItem[]> {
  const newItems: MergeItem[] = []
  for (const file of files) {
    if (file.type === 'application/pdf') {
      const bytes = await file.arrayBuffer()
      const doc = await openPdf(bytes)
      newItems.push({ id: newId(), name: file.name, kind: 'pdf', bytes, pageCount: doc.numPages })
    } else if (file.type.startsWith('image/')) {
      const dataUrl = await readAsDataUrl(file)
      const dims = await loadImageDims(dataUrl)
      newItems.push({ id: newId(), name: file.name, kind: 'image', dataUrl, ...dims, pageCount: 1 })
    }
  }
  return newItems
}

/** Fusionne tous les éléments dans l'ordre de la liste. */
export async function buildMergedPdf(items: MergeItem[]): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  for (const item of items) {
    if (item.kind === 'pdf' && item.bytes) {
      const src = await PDFDocument.load(item.bytes)
      const copied = await out.copyPages(src, src.getPageIndices())
      for (const p of copied) out.addPage(p)
    } else if (item.kind === 'image' && item.dataUrl) {
      const bytes = await fetch(item.dataUrl).then((r) => r.arrayBuffer())
      const image = item.dataUrl.startsWith('data:image/png')
        ? await out.embedPng(bytes)
        : await out.embedJpg(bytes)
      const w = item.width ?? image.width
      const h = item.height ?? image.height
      const page = out.addPage([w, h])
      page.drawImage(image, { x: 0, y: 0, width: w, height: h })
    }
  }
  return out.save()
}
