import { PDFDocument, PDFName, PDFRawStream, type PDFRef } from 'pdf-lib'

/**
 * Compresseur PDF 100 % local : ré-encode les images JPEG embarquées (les
 * plus gros contributeurs au poids d'un scan ou d'un PDF illustré) à une
 * résolution et une qualité réduites, sans jamais toucher au texte vectoriel
 * ni envoyer le fichier où que ce soit.
 *
 * Limite assumée : seules les images encodées en DCTDecode (JPEG natif d'un
 * flux PDF) sont ré-encodées. Les images déjà en Flate/PNG brut sont
 * laissées telles quelles (les décoder correctement demanderait de
 * réimplémenter la colorimétrie PDF — hors scope ici) : le gain reste réel
 * sur l'immense majorité des scans et photos, qui sont en JPEG.
 */

export type CompressLevel = 'low' | 'medium' | 'high'

interface LevelConfig {
  quality: number
  maxDim: number
  label: string
  desc: string
}

export const COMPRESS_LEVELS: Record<CompressLevel, LevelConfig> = {
  low: {
    quality: 0.85,
    maxDim: 2200,
    label: 'Légère',
    desc: 'Qualité quasi identique, gain modéré',
  },
  medium: {
    quality: 0.72,
    maxDim: 1600,
    label: 'Recommandée',
    desc: 'Bon compromis qualité / poids',
  },
  high: {
    quality: 0.5,
    maxDim: 1200,
    label: 'Forte',
    desc: 'Fichier le plus léger, perte visible possible',
  },
}

export interface CompressStats {
  originalSize: number
  compressedSize: number
  imagesTotal: number
  imagesCompressed: number
}

export interface CompressResult {
  bytes: Uint8Array
  stats: CompressStats
}

function jpegBytesToCanvas(bytes: Uint8Array): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' })
    createImageBitmap(blob).then(
      (bitmap) => {
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
        bitmap.close()
        resolve(canvas)
      },
      (err) => reject(err instanceof Error ? err : new Error(String(err)))
    )
  })
}

function canvasToJpegBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Échec de l’encodage JPEG'))
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject)
      },
      'image/jpeg',
      quality
    )
  })
}

/** Redimensionne un canvas si sa plus grande dimension dépasse `maxDim`. */
function clampCanvas(canvas: HTMLCanvasElement, maxDim: number): HTMLCanvasElement {
  const largest = Math.max(canvas.width, canvas.height)
  if (largest <= maxDim) return canvas
  const ratio = maxDim / largest
  const resized = document.createElement('canvas')
  resized.width = Math.max(1, Math.round(canvas.width * ratio))
  resized.height = Math.max(1, Math.round(canvas.height * ratio))
  resized.getContext('2d')!.drawImage(canvas, 0, 0, resized.width, resized.height)
  return resized
}

/**
 * Compresse un PDF en ré-encodant ses images JPEG embarquées.
 * `onProgress` reçoit (image traitée, total d'images JPEG trouvées).
 */
export async function compressPdf(
  bytes: ArrayBuffer,
  level: CompressLevel,
  onProgress?: (done: number, total: number) => void
): Promise<CompressResult> {
  const cfg = COMPRESS_LEVELS[level]
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const { context } = doc

  const filterName = PDFName.of('Filter')
  const subtypeName = PDFName.of('Subtype')
  const dctDecode = PDFName.of('DCTDecode')
  const imageName = PDFName.of('Image')

  const jpegImages: [PDFRef, PDFRawStream][] = []
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    const subtype = obj.dict.get(subtypeName)
    const filter = obj.dict.get(filterName)
    if (subtype?.toString() === imageName.toString() && filter?.toString() === dctDecode.toString()) {
      jpegImages.push([ref, obj])
    }
  }

  let imagesCompressed = 0
  let done = 0
  for (const [ref, stream] of jpegImages) {
    done++
    onProgress?.(done, jpegImages.length)
    try {
      const original = stream.getContents()
      const rawCanvas = await jpegBytesToCanvas(original)
      const canvas = clampCanvas(rawCanvas, cfg.maxDim)
      const newBytes = await canvasToJpegBytes(canvas, cfg.quality)
      if (newBytes.length >= original.length) continue

      const dict = stream.dict.clone(context)
      dict.set(PDFName.of('Width'), context.obj(canvas.width))
      dict.set(PDFName.of('Height'), context.obj(canvas.height))
      dict.set(PDFName.of('Length'), context.obj(newBytes.length))
      dict.delete(PDFName.of('DecodeParms'))
      dict.delete(PDFName.of('Decode'))

      context.assign(ref, PDFRawStream.of(dict, newBytes))
      imagesCompressed++
    } catch (err) {
      console.error('Compression image ignorée :', err)
    }
  }

  const outBytes = await doc.save({ useObjectStreams: true })
  return {
    bytes: outBytes,
    stats: {
      originalSize: bytes.byteLength,
      compressedSize: outBytes.byteLength,
      imagesTotal: jpegImages.length,
      imagesCompressed,
    },
  }
}
