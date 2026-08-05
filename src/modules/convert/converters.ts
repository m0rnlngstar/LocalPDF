import { openPdf } from '../../lib/pdfjs'
import { renderHtmlToPages, A4_PAGE } from './htmlToPages'
import { newId, type ConvertItem, type RenderedPage } from './types'

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  return m ? m[1].toLowerCase() : ''
}

function readAsDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Rasterise une image déjà décodée en une page PNG, mise à l'échelle A4 max. */
function rasterizeImage(img: HTMLImageElement): RenderedPage {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  // Fond blanc : les images transparentes (PNG) sont posées sur une page blanche.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0)
  const ratio = Math.min(1, A4_PAGE.widthPt / img.naturalWidth)
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: img.naturalWidth * ratio,
    height: img.naturalHeight * ratio,
  }
}

async function convertImageFile(file: File): Promise<RenderedPage[]> {
  const dataUrl = await readAsDataUrl(file)
  const img = await loadImage(dataUrl)
  return [rasterizeImage(img)]
}

async function convertHeicFile(file: File): Promise<RenderedPage[]> {
  const { default: heic2any } = await import('heic2any')
  const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
  const blob = Array.isArray(result) ? result[0] : result
  const dataUrl = await readAsDataUrl(blob)
  const img = await loadImage(dataUrl)
  return [rasterizeImage(img)]
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
      const doc = await openPdf(bytes)
      return { id, name, kind: 'pdf', status: 'ready', bytes, pageCount: doc.numPages }
    }

    if (ext === 'heic' || ext === 'heif' || file.type === 'image/heic' || file.type === 'image/heif') {
      const pages = await convertHeicFile(file)
      return { id, name, kind: 'pages', status: 'ready', pages, pageCount: pages.length }
    }

    if (file.type.startsWith('image/') || IMAGE_EXTS.has(ext)) {
      const pages = await convertImageFile(file)
      return { id, name, kind: 'pages', status: 'ready', pages, pageCount: pages.length }
    }

    if (
      ext === 'docx' ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const pages = await convertDocxFile(file)
      return { id, name, kind: 'pages', status: 'ready', pages, pageCount: pages.length }
    }

    if (ext === 'md' || ext === 'markdown' || file.type === 'text/markdown') {
      const pages = await convertMarkdownFile(file)
      return { id, name, kind: 'pages', status: 'ready', pages, pageCount: pages.length }
    }

    if (ext === 'txt' || file.type === 'text/plain') {
      const pages = await convertTxtFile(file)
      return { id, name, kind: 'pages', status: 'ready', pages, pageCount: pages.length }
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
