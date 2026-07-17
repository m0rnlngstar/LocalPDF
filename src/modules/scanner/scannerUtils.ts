import { preprocessForOcr } from '../../lib/preprocess'

export type ScanFilter = 'color' | 'gray' | 'document'

export interface RenderScanOptions {
  rotation: number
  filter: ScanFilter
  autoCrop: boolean
}

export interface RenderedScan {
  blob: Blob
  width: number
  height: number
  cropApplied: boolean
}

const MAX_CAPTURE_EDGE = 2800
const CROP_SAMPLE_EDGE = 480

function newCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

export async function blobToCanvas(
  blob: Blob,
  rotation = 0,
  maxEdge = MAX_CAPTURE_EDGE
): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const sourceWidth = Math.max(1, Math.round(bitmap.width * scale))
    const sourceHeight = Math.max(1, Math.round(bitmap.height * scale))
    const normalizedRotation = ((rotation % 360) + 360) % 360
    const swapsAxes = normalizedRotation === 90 || normalizedRotation === 270
    const canvas = newCanvas(
      swapsAxes ? sourceHeight : sourceWidth,
      swapsAxes ? sourceWidth : sourceHeight
    )
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((normalizedRotation * Math.PI) / 180)
    ctx.drawImage(bitmap, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight)
    return canvas
  } finally {
    bitmap.close()
  }
}

/**
 * Recadrage local volontairement conservateur : on estime la couleur du fond
 * sur le pourtour, puis on cherche une grande zone qui s'en détache. Si le
 * document remplit déjà l'image ou si la détection est ambiguë, on ne coupe
 * rien afin de ne jamais rogner du texte par surprise.
 */
function rotateCanvas(
  source: HTMLCanvasElement,
  degrees: number,
  background: [number, number, number]
): HTMLCanvasElement {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))
  const rotated = newCanvas(
    source.width * cos + source.height * sin,
    source.width * sin + source.height * cos
  )
  const ctx = rotated.getContext('2d')!
  ctx.fillStyle = `rgb(${background[0]} ${background[1]} ${background[2]})`
  ctx.fillRect(0, 0, rotated.width, rotated.height)
  ctx.translate(rotated.width / 2, rotated.height / 2)
  ctx.rotate(radians)
  ctx.drawImage(source, -source.width / 2, -source.height / 2)
  return rotated
}

function autoCropDocument(
  source: HTMLCanvasElement,
  allowDeskew = true
): { canvas: HTMLCanvasElement; applied: boolean } {
  const scale = Math.min(1, CROP_SAMPLE_EDGE / Math.max(source.width, source.height))
  const sample = newCanvas(source.width * scale, source.height * scale)
  const sampleCtx = sample.getContext('2d', { willReadFrequently: true })!
  sampleCtx.drawImage(source, 0, 0, sample.width, sample.height)
  const { data } = sampleCtx.getImageData(0, 0, sample.width, sample.height)
  const w = sample.width
  const h = sample.height
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.025))

  let borderR = 0
  let borderG = 0
  let borderB = 0
  let borderCount = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue
      const i = (y * w + x) * 4
      borderR += data[i]
      borderG += data[i + 1]
      borderB += data[i + 2]
      borderCount++
    }
  }
  borderR /= borderCount
  borderG /= borderCount
  borderB /= borderCount

  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  let foreground = 0
  let sumX = 0
  let sumY = 0
  let sumXX = 0
  let sumYY = 0
  let sumXY = 0
  const threshold = 42
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const dr = data[i] - borderR
      const dg = data[i + 1] - borderG
      const db = data[i + 2] - borderB
      const distance = Math.sqrt(dr * dr + dg * dg + db * db)
      if (distance < threshold) continue
      foreground++
      sumX += x
      sumY += y
      sumXX += x * x
      sumYY += y * y
      sumXY += x * y
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  const foregroundRatio = foreground / (w * h)
  if (maxX < 0 || foregroundRatio < 0.2 || foregroundRatio > 0.94) {
    return { canvas: source, applied: false }
  }

  const detectedWidth = maxX - minX + 1
  const detectedHeight = maxY - minY + 1
  if ((detectedWidth * detectedHeight) / (w * h) < 0.36) {
    return { canvas: source, applied: false }
  }

  // Redresse les petites inclinaisons avant le recadrage. Les moments de la
  // grande zone « feuille » donnent son axe principal sans dépendre du texte.
  if (allowDeskew && foreground > 0) {
    const meanX = sumX / foreground
    const meanY = sumY / foreground
    const covXX = sumXX / foreground - meanX * meanX
    const covYY = sumYY / foreground - meanY * meanY
    const covXY = sumXY / foreground - meanX * meanY
    const axisDegrees = (0.5 * Math.atan2(2 * covXY, covXX - covYY) * 180) / Math.PI
    const nearestAxis = Math.round(axisDegrees / 90) * 90
    const correction = nearestAxis - axisDegrees
    if (Math.abs(correction) >= 0.35 && Math.abs(correction) <= 6) {
      const straightened = rotateCanvas(source, correction, [borderR, borderG, borderB])
      const recropped = autoCropDocument(straightened, false)
      return { canvas: recropped.canvas, applied: true }
    }
  }

  // Rentre très légèrement dans la feuille détectée. Cela élimine le fin liseré
  // du bureau qui peut sinon devenir noir avec le filtre « document ».
  const insetX = Math.max(1, Math.round(w * 0.008))
  const insetY = Math.max(1, Math.round(h * 0.008))
  minX = Math.min(maxX - 1, minX + insetX)
  minY = Math.min(maxY - 1, minY + insetY)
  maxX = Math.max(minX + 1, maxX - insetX)
  maxY = Math.max(minY + 1, maxY - insetY)

  const removesEnough =
    minX > w * 0.025 || minY > h * 0.025 || maxX < w * 0.975 || maxY < h * 0.975
  if (!removesEnough) return { canvas: source, applied: false }

  const sx = Math.round(minX / scale)
  const sy = Math.round(minY / scale)
  const sw = Math.min(source.width - sx, Math.round((maxX - minX + 1) / scale))
  const sh = Math.min(source.height - sy, Math.round((maxY - minY + 1) / scale))
  const cropped = newCanvas(sw, sh)
  cropped.getContext('2d')!.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
  return { canvas: cropped, applied: true }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Impossible d'encoder l'image")),
      type,
      quality
    )
  })
}

export async function renderScan(blob: Blob, options: RenderScanOptions): Promise<RenderedScan> {
  const oriented = await blobToCanvas(blob, options.rotation)
  const cropped = options.autoCrop
    ? autoCropDocument(oriented)
    : { canvas: oriented, applied: false }

  let output = cropped.canvas
  if (options.filter === 'gray') {
    output = preprocessForOcr(output, { binarize: false })
  } else if (options.filter === 'document') {
    output = preprocessForOcr(output, { binarize: true })
    // Le seuillage peut accentuer les derniers pixels anti-crénelés du bord de
    // la feuille. Une bordure blanche minuscule garde le PDF parfaitement net.
    const edgeX = Math.max(1, Math.round(output.width * 0.004))
    const edgeY = Math.max(1, Math.round(output.height * 0.004))
    const ctx = output.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, output.width, edgeY)
    ctx.fillRect(0, output.height - edgeY, output.width, edgeY)
    ctx.fillRect(0, 0, edgeX, output.height)
    ctx.fillRect(output.width - edgeX, 0, edgeX, output.height)
  }

  const type = options.filter === 'document' ? 'image/png' : 'image/jpeg'
  const encoded = await canvasToBlob(output, type, options.filter === 'color' ? 0.92 : 0.9)
  return {
    blob: encoded,
    width: output.width,
    height: output.height,
    cropApplied: cropped.applied,
  }
}
