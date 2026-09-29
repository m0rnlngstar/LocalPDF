import { openPdf } from '../../lib/pdfjs'
import { renderHtmlToPages, A4_PAGE } from './htmlToPages'
import { newId, type ConvertItem, type RenderedPage } from './types'
import { blobToPage, makeThumb, releaseCanvas } from './raster'

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  return m ? m[1].toLowerCase() : ''
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function convertImageFile(file: Blob): Promise<RenderedPage[]> {
  return [await blobToPage(file, A4_PAGE.widthPt)]
}

async function convertHeicFile(file: File): Promise<RenderedPage[]> {
  const { default: heic2any } = await import('heic2any')
  const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
  return convertImageFile(Array.isArray(result) ? result[0] : result)
}

/** Miniature de la première page d'un PDF source ; le document pdf.js est libéré ensuite. */
async function inspectPdf(bytes: ArrayBuffer): Promise<{ pageCount: number; thumb: string }> {
  const doc = await openPdf(bytes)
  try {
    const page = await doc.getPage(1)
    const vp0 = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: 260 / vp0.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
    const thumb = makeThumb(canvas)
    releaseCanvas(canvas)
    return { pageCount: doc.numPages, thumb }
  } finally {
    void doc.loadingTask.destroy()
  }
}

async function convertDocxFile(file: File): Promise<RenderedPage[]> {
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const { value: html } = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement((image) =>
        image.read('base64').then((data) => ({ src: `data:${image.contentType};base64,${data}` }))
      ),
    }
  )
  return renderHtmlToPages(`<div>${html}</div>`)
}

async function convertMarkdownFile(file: File): Promise<RenderedPage[]> {
  const { marked } = await import('marked')
  const text = await file.text()
  const html = await marked.parse(text)
  return renderHtmlToPages(`<div>${html}</div>`)
}

async function convertTxtFile(file: File): Promise<RenderedPage[]> {
  const text = await file.text()
  const html = `<pre style="white-space:pre-wrap;word-wrap:break-word;font-family:Consolas,'Cascadia Code',monospace;font-size:13px;margin:0;">${escapeHtml(text)}</pre>`
  return renderHtmlToPages(html)
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'])

/** Convertit un fichier source en un `ConvertItem` prêt à être assemblé dans le PDF final. */
export async function convertFile(file: File): Promise<ConvertItem> {
  const id = newId()
  const name = file.name
  const ext = extOf(name)

  try {
    if (file.type === 'application/pdf' || ext === 'pdf') {
      const bytes = await file.arrayBuffer()
      const { pageCount, thumb } = await inspectPdf(bytes)
      return { id, name, kind: 'pdf', status: 'ready', bytes, pageCount, thumb }
    }

    if (ext === 'heic' || ext === 'heif' || file.type === 'image/heic' || file.type === 'image/heif') {
      const pages = await convertHeicFile(file)
      return { id, name, kind: 'pages', status: 'ready', pages, pageCount: pages.length, thumb: pages[0]?.thumb, isImage: true }
    }

    if (file.type.startsWith('image/') || IMAGE_EXTS.has(ext)) {
      const pages = await convertImageFile(file)
      return { id, name, kind: 'pages', status: 'ready', pages, pageCount: pages.length, thumb: pages[0]?.thumb, isImage: true }
    }

    if (
      ext === 'docx' ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const pages = await convertDocxFile(file)
      return { id, name, kind: 'pages', status: 'ready', pages, pageCount: pages.length, thumb: pages[0]?.thumb }
    }

    if (ext === 'md' || ext === 'markdown' || file.type === 'text/markdown') {
      const pages = await convertMarkdownFile(file)
      return { id, name, kind: 'pages', status: 'ready', pages, pageCount: pages.length, thumb: pages[0]?.thumb }
    }

    if (ext === 'txt' || file.type === 'text/plain') {
      const pages = await convertTxtFile(file)
      return { id, name, kind: 'pages', status: 'ready', pages, pageCount: pages.length, thumb: pages[0]?.thumb }
    }

    throw new Error('Format non pris en charge')
  } catch (err) {
    return {
      id,
      name,
      kind: 'pages',
      status: 'error',
      error: err instanceof Error ? err.message : 'Échec de la conversion',
      pageCount: 0,
    }
  }
}
