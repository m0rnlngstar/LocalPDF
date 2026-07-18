import {
  assessDocumentCorners,
  type LiveDocumentAnalysis,
  type ScanGuidePoint,
} from './liveDocumentDetection'

type OpenCvRuntime = typeof import('@techstark/opencv-js')

interface OpenCvModuleShape {
  default?: unknown
  Mat?: unknown
  onRuntimeInitialized?: () => void
}

let runtimePromise: Promise<OpenCvRuntime> | null = null

function hasOpenCvRuntime(value: unknown): value is OpenCvRuntime {
  return Boolean(value && typeof value === 'object' && 'Mat' in value && 'findContours' in value)
}

async function initializeOpenCv(): Promise<OpenCvRuntime> {
  const imported = await import('@techstark/opencv-js')
  const moduleShape = imported as OpenCvModuleShape
  const candidate = await Promise.resolve(moduleShape.default ?? imported)
  if (hasOpenCvRuntime(candidate)) return candidate

  const pending = candidate as OpenCvModuleShape
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("OpenCV n'a pas pu démarrer")), 20_000)
    const previous = pending.onRuntimeInitialized
    pending.onRuntimeInitialized = () => {
      previous?.()
      window.clearTimeout(timeout)
      if (hasOpenCvRuntime(pending)) resolve(pending)
      else reject(new Error('Runtime OpenCV incomplet'))
    }
  })
}

function getOpenCvRuntime() {
  runtimePromise ??= initializeOpenCv()
  return runtimePromise
}

function orderCorners(points: ScanGuidePoint[]) {
  if (points.length !== 4) return null
  const topLeft = points.reduce((best, point) => point.x + point.y < best.x + best.y ? point : best)
  const bottomRight = points.reduce((best, point) => point.x + point.y > best.x + best.y ? point : best)
  const topRight = points.reduce((best, point) => point.x - point.y > best.x - best.y ? point : best)
  const bottomLeft = points.reduce((best, point) => point.x - point.y < best.x - best.y ? point : best)
  const ordered = [topLeft, topRight, bottomRight, bottomLeft]
  if (new Set(ordered).size !== 4) return null
  return ordered as [ScanGuidePoint, ScanGuidePoint, ScanGuidePoint, ScanGuidePoint]
}

function polygonArea(points: ScanGuidePoint[]) {
  let sum = 0
  for (let index = 0; index < points.length; index++) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    sum += current.x * next.y - next.x * current.y
  }
  return Math.abs(sum) / 2
}

function contourPoints(contour: { data32S: Int32Array }) {
  const points: ScanGuidePoint[] = []
  for (let index = 0; index < contour.data32S.length; index += 2) {
    points.push({ x: contour.data32S[index], y: contour.data32S[index + 1] })
  }
  return points
}

function farthestQuadrantCorners(points: ScanGuidePoint[], center: ScanGuidePoint) {
  const corners: Array<ScanGuidePoint | null> = [null, null, null, null]
  const distances = [0, 0, 0, 0]
  for (const point of points) {
    const quadrant = point.x < center.x
      ? point.y < center.y ? 0 : 3
      : point.y < center.y ? 1 : 2
    const pointDistance = Math.hypot(point.x - center.x, point.y - center.y)
    if (pointDistance > distances[quadrant]) {
      distances[quadrant] = pointDistance
      corners[quadrant] = point
    }
  }
  return corners.every(Boolean)
    ? corners as [ScanGuidePoint, ScanGuidePoint, ScanGuidePoint, ScanGuidePoint]
    : null
}

/**
 * Détecteur local OpenCV, chargé uniquement lors de l'ouverture de la caméra.
 * La recherche de quadrilatères reprend l'approche éprouvée par jscanify, mais
 * filtre explicitement les contours collés au cadre qui causaient les faux coins.
 */
export class OpenCvDocumentDetector {
  private readonly cv: OpenCvRuntime

  constructor(cv: OpenCvRuntime) {
    this.cv = cv
  }

  analyze(canvas: HTMLCanvasElement): LiveDocumentAnalysis | null {
    const cv = this.cv
    const source = cv.imread(canvas)
    const gray = new cv.Mat()
    const blurred = new cv.Mat()
    const edges = new cv.Mat()
    const closed = new cv.Mat()
    const thresholded = new cv.Mat()
    const thresholdClosed = new cv.Mat()
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))

    try {
      cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY)
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT)

      const frameArea = canvas.width * canvas.height
      let bestCorners: [ScanGuidePoint, ScanGuidePoint, ScanGuidePoint, ScanGuidePoint] | null = null
      let bestScore = 0

      const scanMask = (mask: typeof edges, methodBonus: number) => {
        const contours = new cv.MatVector()
        const hierarchy = new cv.Mat()
        try {
          cv.findContours(mask, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
          for (let index = 0; index < contours.size(); index++) {
            const contour = contours.get(index)
            const approx = new cv.Mat()
            try {
              const contourArea = Math.abs(cv.contourArea(contour))
              const areaRatio = contourArea / frameArea
              if (areaRatio < 0.08 || areaRatio > 0.97) continue

              const perimeter = cv.arcLength(contour, true)
              cv.approxPolyDP(contour, approx, perimeter * 0.03, true)
              const points = contourPoints(approx)
              const isExactQuadrilateral = points.length === 4 && cv.isContourConvex(approx)
              const orderedPixels = isExactQuadrilateral
                ? orderCorners(points)
                : farthestQuadrantCorners(contourPoints(contour), cv.minAreaRect(contour).center)
              if (!orderedPixels) continue
              const normalized = orderedPixels.map((point) => ({
                x: point.x / canvas.width,
                y: point.y / canvas.height,
              })) as [ScanGuidePoint, ScanGuidePoint, ScanGuidePoint, ScanGuidePoint]
              const quadArea = polygonArea(normalized)
              if (quadArea < 0.08) continue

              const nearestEdge = Math.min(...normalized.flatMap((point) => [
                point.x,
                point.y,
                1 - point.x,
                1 - point.y,
              ]))
              const touchesFrame = nearestEdge < 0.006
              const contourFill = Math.min(1, areaRatio / quadArea)
              const score = quadArea * 1.7
                + contourFill * 0.15
                + Math.min(0.08, nearestEdge)
                + methodBonus
                - (touchesFrame ? 0.45 : 0)
                - (isExactQuadrilateral ? 0 : 0.06)
              if (score > bestScore) {
                bestScore = score
                bestCorners = normalized
              }
            } finally {
              contour.delete()
              approx.delete()
            }
          }
        } finally {
          contours.delete()
          hierarchy.delete()
        }
      }

      // Les contours Canny fonctionnent bien sur un bureau contrasté.
      cv.Canny(blurred, edges, 35, 125)
      cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2)
      scanMask(closed, 0)

      // Otsu récupère la feuille quand un bord est peu contrasté ou éclairé de façon inégale.
      cv.threshold(blurred, thresholded, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU)
      cv.morphologyEx(thresholded, thresholdClosed, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 1)
      scanMask(thresholdClosed, 0.04)

      return bestCorners ? assessDocumentCorners(canvas, bestCorners) : null
    } finally {
      source.delete()
      gray.delete()
      blurred.delete()
      edges.delete()
      closed.delete()
      thresholded.delete()
      thresholdClosed.delete()
      kernel.delete()
    }
  }
}

export async function loadOpenCvDocumentDetector() {
  return new OpenCvDocumentDetector(await getOpenCvRuntime())
}
