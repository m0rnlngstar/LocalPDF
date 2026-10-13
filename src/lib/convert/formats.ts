import { PDFDocument, PDFName, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from 'pdf-lib'
import { canvasToPage, MAX_PAGE_PX, releaseCanvas, TEXT_QUALITY } from './raster'
import type { RenderedPage } from './types'

/**
 * Reconnaissance des formats par leur CONTENU (signature binaire) et non par
 * l'extension : les fichiers issus de scanners, de mails ou de logiciels
 * métiers ont souvent une extension absente ou erronée.
 */

export type SniffedFormat =
  | 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'ico' | 'tiff'
  | 'heif' | 'avif' | 'jxl' | 'jp2' | 'svg' | 'zip'

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let s = ''
  for (let i = from; i < Math.min(to, bytes.length); i++) s += String.fromCharCode(bytes[i])
  return s
}

export async function sniffFormat(file: Blob): Promise<SniffedFormat | null> {
  const b = new Uint8Array(await file.slice(0, 1024).arrayBuffer())
  const head = ascii(b, 0, 1024)
  if (head.includes('%PDF-')) return 'pdf'
  if (b[0] === 0x89 && head.startsWith('PNG', 1)) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (head.startsWith('GIF8')) return 'gif'
  if (head.startsWith('RIFF') && ascii(b, 8, 12) === 'WEBP') return 'webp'
  if (head.startsWith('BM')) return 'bmp'
  if (b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0) return 'ico'
  if (head.startsWith('II*\0') || head.startsWith('MM\0*') || head.startsWith('II+\0') || head.startsWith('MM\0+')) return 'tiff'
  if ((b[0] === 0xff && b[1] === 0x0a) || ascii(b, 4, 8) === 'JXL ') return 'jxl'
  if (ascii(b, 4, 8) === 'jP  ' || (b[0] === 0xff && b[1] === 0x4f && b[2] === 0xff && b[3] === 0x51)) return 'jp2'
  if (ascii(b, 4, 8) === 'ftyp') {
    const size = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]
    const brands = ascii(b, 8, Math.min(size || 32, 64))
    if (/avif|avis/.test(brands)) return 'avif'
    if (/hei[cmsx]|hev[cmsx]|mif1|msf1/.test(brands)) return 'heif'
  }
  if (head.startsWith('PK\x03\x04')) return 'zip'
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'svg'
  return null
}

/* ------------------------------------------------------------------------- */
/* TIFF (scanners, fax) — multipage                                           */
/* ------------------------------------------------------------------------- */

/** Résolution (points par pouce) déclarée dans le TIFF, si présente. */
function tiffDpi(ifd: Record<string, unknown>): number | null {
  const raw = ifd.t282 as number[] | undefined
  const unit = (ifd.t296 as number[] | undefined)?.[0] ?? 2
  const v = Array.isArray(raw) ? Number(raw[0]) : Number(raw)
  if (!v || !Number.isFinite(v) || v < 30 || v > 2400) return null
  return unit === 3 ? v * 2.54 : v
}

export async function convertTiff(file: Blob, maxWidthPt: number): Promise<RenderedPage[]> {
  const UTIF = await import('utif2')
  const buf = await file.arrayBuffer()
  const ifds = UTIF.decode(buf)
  const pages: RenderedPage[] = []
  for (const ifd of ifds) {
    UTIF.decodeImage(buf, ifd)
    const w = ifd.width as number | undefined
    const h = ifd.height as number | undefined
    if (!w || !h) continue
    const rgba = UTIF.toRGBA8(ifd)
    const full = document.createElement('canvas')
    full.width = w
    full.height = h
    full.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, w * h * 4), w, h), 0, 0)

    const scale = Math.min(1, MAX_PAGE_PX / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(full, 0, 0, canvas.width, canvas.height)
    releaseCanvas(full)

    // Taille réelle si la résolution est connue (scan A4 à 300 dpi → page A4)
    const dpi = tiffDpi(ifd as Record<string, unknown>)
    const ratio = dpi ? 72 / dpi : Math.min(1, maxWidthPt / w)
    pages.push(await canvasToPage(canvas, w * ratio, h * ratio, TEXT_QUALITY))
  }
  if (!pages.length) throw new Error('TIFF sans image lisible')
  return pages
}

/* ------------------------------------------------------------------------- */
/* JPEG 2000 — encapsulé tel quel dans un PDF (décodé ensuite par pdf.js)     */
/* ------------------------------------------------------------------------- */

function jp2Size(bytes: Uint8Array): { width: number; height: number } {
  for (let i = 0; i < bytes.length - 20; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0x51) {
      const v = new DataView(bytes.buffer, bytes.byteOffset + i + 2)
      // Lsiz (2) + Rsiz (2), puis Xsiz, Ysiz, XOsiz, YOsiz
      const xs = v.getUint32(4)
      const ys = v.getUint32(8)
      const xo = v.getUint32(12)
      const yo = v.getUint32(16)
      return { width: xs - xo, height: ys - yo }
    }
  }
  throw new Error('JPEG 2000 illisible')
}

export async function jp2ToPdf(file: Blob, maxWidthPt: number): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { width, height } = jp2Size(bytes)
  const doc = await PDFDocument.create()
  const image = doc.context.register(
    doc.context.stream(bytes, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, Filter: 'JPXDecode' })
  )
  const ratio = Math.min(1, maxWidthPt / width)
  const w = width * ratio
  const h = height * ratio
  const page = doc.addPage([w, h])
  page.node.setXObject(PDFName.of('Im0'), image)
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(w, 0, 0, h, 0, 0), drawObject('Im0'), popGraphicsState())
  const out = await doc.save()
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
}
