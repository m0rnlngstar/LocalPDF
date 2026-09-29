import type { RenderedPage } from './types'

/**
 * Encodage des pages rendues : JPEG plutôt que PNG (encodage bien plus rapide,
 * fichiers 5 à 10 fois plus légers, et pdf-lib l'intègre sans le décoder),
 * résolution plafonnée et miniature séparée pour l'affichage.
 */

/** Plus grand côté d'une photo, en pixels (≈ A4 à 240 dpi : net à l'impression, bien plus léger). */
export const MAX_PAGE_PX = 2000
const THUMB_PX = 260
/** Photos : les artefacts JPEG y sont invisibles à ce niveau. */
export const PHOTO_QUALITY = 0.8
/** Pages de texte (DOCX, TXT, Markdown) : un peu plus haut pour garder des contours nets. */
export const TEXT_QUALITY = 0.85

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Échec de l'encodage de l'image"))), 'image/jpeg', quality)
  })
}

/** Libère immédiatement la mémoire d'un canvas (sans attendre le ramasse-miettes). */
export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}

/** Miniature JPEG d'une source dessinable, largeur THUMB_PX. */
export function makeThumb(src: CanvasImageSource & { width: number; height: number }): string {
  const ratio = Math.min(1, THUMB_PX / src.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(src.width * ratio))
  canvas.height = Math.max(1, Math.round(src.height * ratio))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
  const url = canvas.toDataURL('image/jpeg', 0.75)
  releaseCanvas(canvas)
  return url
}

/** Encode un canvas (fond déjà opaque) en page JPEG + miniature, puis libère le canvas. */
export async function canvasToPage(
  canvas: HTMLCanvasElement,
  widthPt: number,
  heightPt: number,
  quality = TEXT_QUALITY
): Promise<RenderedPage> {
  const thumb = makeThumb(canvas)
  const blob = await canvasToBlob(canvas, quality)
  releaseCanvas(canvas)
  return { blob, thumb, width: widthPt, height: heightPt }
}

/** Décode une image ; repli sur <img> pour les formats refusés par createImageBitmap (SVG). */
async function decodeImage(blob: Blob): Promise<{ width: number; height: number; close: () => void } & CanvasImageSource> {
  try {
    return await createImageBitmap(blob)
  } catch {
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight, close: () => {} })
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

/**
 * Rasterise une image (fichier, blob HEIC converti…) en page, réduite à MAX_PAGE_PX.
 * createImageBitmap décode hors du thread principal et applique l'orientation EXIF.
 */
export async function blobToPage(blob: Blob, maxWidthPt: number): Promise<RenderedPage> {
  const bitmap = await decodeImage(blob)
  try {
    const scale = Math.min(1, MAX_PAGE_PX / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')!
    // Fond blanc : les images transparentes (PNG) sont posées sur une page blanche.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const ratio = Math.min(1, maxWidthPt / bitmap.width)
    return await canvasToPage(canvas, bitmap.width * ratio, bitmap.height * ratio, PHOTO_QUALITY)
  } finally {
    bitmap.close()
  }
}

/** Charge une page en canvas pleine résolution (pour l'OCR). */
export async function pageToCanvas(page: RenderedPage): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(page.blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas
}
