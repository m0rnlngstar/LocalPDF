export interface ScanGuidePoint {
  x: number
  y: number
}

export type ScanGuideStatus =
  | 'searching'
  | 'clipped'
  | 'too-far'
  | 'tilted'
  | 'perspective'
  | 'dark'
  | 'blurry'
  | 'ready'

export interface LiveDocumentAnalysis {
  detected: boolean
  corners: [ScanGuidePoint, ScanGuidePoint, ScanGuidePoint, ScanGuidePoint] | null
  status: ScanGuideStatus
  message: string
  ready: boolean
  areaRatio: number
  angle: number
  perspective: number
  brightness: number
  sharpness: number
}

interface Line {
  slope: number
  intercept: number
}

const emptyAnalysis: LiveDocumentAnalysis = {
  detected: false,
  corners: null,
  status: 'searching',
  message: 'Placez le document dans le cadre',
  ready: false,
  areaRatio: 0,
  angle: 0,
  perspective: 1,
  brightness: 0,
  sharpness: 0,
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function distance(a: ScanGuidePoint, b: ScanGuidePoint, width = 1, height = 1) {
  return Math.hypot((a.x - b.x) * width, (a.y - b.y) * height)
}

function polygonArea(points: ScanGuidePoint[]) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const next = points[(i + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }
  return Math.abs(area) / 2
}

function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  sourcePoints: [ScanGuidePoint, ScanGuidePoint, ScanGuidePoint],
  destinationPoints: [ScanGuidePoint, ScanGuidePoint, ScanGuidePoint]
) {
  const [s0, s1, s2] = sourcePoints
  const [d0, d1, d2] = destinationPoints
  const denominator = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y)
  if (Math.abs(denominator) < 0.0001) return
  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denominator
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denominator
  const e = (
    d0.x * (s1.x * s2.y - s2.x * s1.y)
    + d1.x * (s2.x * s0.y - s0.x * s2.y)
    + d2.x * (s0.x * s1.y - s1.x * s0.y)
  ) / denominator
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denominator
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denominator
  const f = (
    d0.y * (s1.x * s2.y - s2.x * s1.y)
    + d1.y * (s2.x * s0.y - s0.x * s2.y)
    + d2.y * (s0.x * s1.y - s1.x * s0.y)
  ) / denominator

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(d0.x, d0.y)
  ctx.lineTo(d1.x, d1.y)
  ctx.lineTo(d2.x, d2.y)
  ctx.closePath()
  ctx.clip()
  ctx.setTransform(a, b, c, d, e, f)
  ctx.drawImage(source, 0, 0)
  ctx.restore()
}

function drawPerspectiveWithWebGl(
  output: HTMLCanvasElement,
  source: HTMLCanvasElement,
  corners: [ScanGuidePoint, ScanGuidePoint, ScanGuidePoint, ScanGuidePoint]
) {
  const gl = output.getContext('webgl', {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  })
  if (!gl) return false
  const compileShader = (type: number, shaderSource: string) => {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, shaderSource)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader)
      return null
    }
    return shader
  }
  const vertexShader = compileShader(gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    attribute vec2 a_uv;
    varying vec2 v_uv;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_uv = a_uv;
    }
  `)
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    uniform sampler2D u_texture;
    uniform vec2 u_top_left;
    uniform vec2 u_top_right;
    uniform vec2 u_bottom_right;
    uniform vec2 u_bottom_left;
    varying vec2 v_uv;
    void main() {
      vec2 top = mix(u_top_left, u_top_right, v_uv.x);
      vec2 bottom = mix(u_bottom_left, u_bottom_right, v_uv.x);
      vec2 source_point = mix(top, bottom, v_uv.y);
      gl_FragColor = texture2D(u_texture, source_point);
    }
  `)
  if (!vertexShader || !fragmentShader) return false
  const program = gl.createProgram()
  if (!program) return false
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false
  gl.useProgram(program)

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 0, 1,
     1, -1, 1, 1,
    -1,  1, 0, 0,
     1,  1, 1, 0,
  ]), gl.STATIC_DRAW)
  const positionLocation = gl.getAttribLocation(program, 'a_position')
  const uvLocation = gl.getAttribLocation(program, 'a_uv')
  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0)
  gl.enableVertexAttribArray(uvLocation)
  gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 16, 8)

  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)

  const [topLeft, topRight, bottomRight, bottomLeft] = corners
  gl.uniform2f(gl.getUniformLocation(program, 'u_top_left'), topLeft.x, topLeft.y)
  gl.uniform2f(gl.getUniformLocation(program, 'u_top_right'), topRight.x, topRight.y)
  gl.uniform2f(gl.getUniformLocation(program, 'u_bottom_right'), bottomRight.x, bottomRight.y)
  gl.uniform2f(gl.getUniformLocation(program, 'u_bottom_left'), bottomLeft.x, bottomLeft.y)
  gl.viewport(0, 0, output.width, output.height)
  gl.clearColor(1, 1, 1, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  gl.finish()
  return gl.getError() === gl.NO_ERROR
}

/**
 * Redresse la feuille détectée vers un rectangle. Un maillage léger reproduit
 * la perspective sans dépendance native et conserve la résolution de la photo.
 */
export function rectifyDocumentPerspective(
  source: HTMLCanvasElement,
  normalizedCorners: [ScanGuidePoint, ScanGuidePoint, ScanGuidePoint, ScanGuidePoint],
  maxEdge = 2800
): HTMLCanvasElement {
  if (polygonArea(normalizedCorners) < 0.1) return source
  const center = normalizedCorners.reduce((value, point) => ({
    x: value.x + point.x / normalizedCorners.length,
    y: value.y + point.y / normalizedCorners.length,
  }), { x: 0, y: 0 })
  const safeNormalizedCorners = normalizedCorners.map((point) => ({
    x: clamp(point.x + (center.x - point.x) * 0.014, 0, 1),
    y: clamp(point.y + (center.y - point.y) * 0.014, 0, 1),
  })) as [ScanGuidePoint, ScanGuidePoint, ScanGuidePoint, ScanGuidePoint]
  const corners = safeNormalizedCorners.map((point) => ({
    x: point.x * source.width,
    y: point.y * source.height,
  })) as [ScanGuidePoint, ScanGuidePoint, ScanGuidePoint, ScanGuidePoint]
  const [topLeft, topRight, bottomRight, bottomLeft] = corners
  const naturalWidth = (distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2
  const naturalHeight = (distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2
  if (naturalWidth < 120 || naturalHeight < 120) return source
  const outputScale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight))
  const output = document.createElement('canvas')
  output.width = Math.max(1, Math.round(naturalWidth * outputScale))
  output.height = Math.max(1, Math.round(naturalHeight * outputScale))
  if (drawPerspectiveWithWebGl(output, source, safeNormalizedCorners)) return output
  const ctx = output.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, output.width, output.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const columns = clamp(Math.round(output.width / 95), 12, 30)
  const rows = clamp(Math.round(output.height / 95), 12, 36)
  const sourceAt = (u: number, v: number): ScanGuidePoint => ({
    x: (1 - v) * ((1 - u) * topLeft.x + u * topRight.x)
      + v * ((1 - u) * bottomLeft.x + u * bottomRight.x),
    y: (1 - v) * ((1 - u) * topLeft.y + u * topRight.y)
      + v * ((1 - u) * bottomLeft.y + u * bottomRight.y),
  })
  const destinationAt = (u: number, v: number): ScanGuidePoint => ({
    x: u * output.width,
    y: v * output.height,
  })

  for (let row = 0; row < rows; row++) {
    const v0 = row / rows
    const v1 = (row + 1) / rows
    for (let column = 0; column < columns; column++) {
      const u0 = column / columns
      const u1 = (column + 1) / columns
      const s00 = sourceAt(u0, v0)
      const s10 = sourceAt(u1, v0)
      const s11 = sourceAt(u1, v1)
      const s01 = sourceAt(u0, v1)
      const d00 = destinationAt(u0, v0)
      const d10 = destinationAt(u1, v0)
      const d11 = destinationAt(u1, v1)
      const d01 = destinationAt(u0, v1)
      drawTexturedTriangle(ctx, source, [s00, s10, s11], [d00, d10, d11])
      drawTexturedTriangle(ctx, source, [s00, s11, s01], [d00, d11, d01])
    }
  }
  return output
}

function fitLine(samples: { independent: number; dependent: number }[]): Line | null {
  if (samples.length < 4) return null
  let sumX = 0
  let sumY = 0
  let sumXX = 0
  let sumXY = 0
  for (const sample of samples) {
    sumX += sample.independent
    sumY += sample.dependent
    sumXX += sample.independent * sample.independent
    sumXY += sample.independent * sample.dependent
  }
  const denominator = samples.length * sumXX - sumX * sumX
  if (Math.abs(denominator) < 0.0001) return null
  return {
    slope: (samples.length * sumXY - sumX * sumY) / denominator,
    intercept: (sumY * sumXX - sumX * sumXY) / denominator,
  }
}

/** Intersection de x = vertical(y) et y = horizontal(x). */
function intersect(vertical: Line, horizontal: Line): ScanGuidePoint | null {
  const denominator = 1 - vertical.slope * horizontal.slope
  if (Math.abs(denominator) < 0.01) return null
  const x = (vertical.slope * horizontal.intercept + vertical.intercept) / denominator
  return { x, y: horizontal.slope * x + horizontal.intercept }
}

/**
 * Détection légère pensée pour fonctionner plusieurs fois par seconde sur un
 * téléphone. Elle segmente le fond à partir du pourtour, garde la plus grande
 * surface contrastée, puis ajuste quatre droites sur les bords de la feuille.
 */
export function analyzeDocumentCanvas(canvas: HTMLCanvasElement): LiveDocumentAnalysis {
  const width = canvas.width
  const height = canvas.height
  if (width < 40 || height < 40) return emptyAnalysis

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return emptyAnalysis
  const { data } = ctx.getImageData(0, 0, width, height)
  const pixelCount = width * height
  const luma = new Uint8Array(pixelCount)
  const borderBand = Math.max(3, Math.round(Math.min(width, height) * 0.045))

  let borderR = 0
  let borderG = 0
  let borderB = 0
  let borderLuma = 0
  let borderLumaSq = 0
  let borderCount = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x
      const offset = pixel * 4
      const value = Math.round(data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114)
      luma[pixel] = value
      if (x >= borderBand && x < width - borderBand && y >= borderBand && y < height - borderBand) continue
      borderR += data[offset]
      borderG += data[offset + 1]
      borderB += data[offset + 2]
      borderLuma += value
      borderLumaSq += value * value
      borderCount++
    }
  }

  borderR /= borderCount
  borderG /= borderCount
  borderB /= borderCount
  const meanBorderLuma = borderLuma / borderCount
  const borderDeviation = Math.sqrt(Math.max(0, borderLumaSq / borderCount - meanBorderLuma ** 2))
  const threshold = clamp(31 + borderDeviation * 0.65, 32, 68)
  const mask = new Uint8Array(pixelCount)

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const offset = pixel * 4
    const dr = data[offset] - borderR
    const dg = data[offset + 1] - borderG
    const db = data[offset + 2] - borderB
    const colorDistance = Math.sqrt(dr * dr + dg * dg + db * db)
    if (colorDistance >= threshold) mask[pixel] = 1
  }

  const labels = new Int32Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let componentId = 0
  let largestId = 0
  let largestSize = 0
  for (let start = 0; start < pixelCount; start++) {
    if (!mask[start] || labels[start]) continue
    componentId++
    let head = 0
    let tail = 0
    queue[tail++] = start
    labels[start] = componentId
    while (head < tail) {
      const pixel = queue[head++]
      const x = pixel % width
      const y = Math.floor(pixel / width)
      let next = pixel - 1
      if (x > 0 && mask[next] && !labels[next]) {
        labels[next] = componentId
        queue[tail++] = next
      }
      next = pixel + 1
      if (x < width - 1 && mask[next] && !labels[next]) {
        labels[next] = componentId
        queue[tail++] = next
      }
      next = pixel - width
      if (y > 0 && mask[next] && !labels[next]) {
        labels[next] = componentId
        queue[tail++] = next
      }
      next = pixel + width
      if (y < height - 1 && mask[next] && !labels[next]) {
        labels[next] = componentId
        queue[tail++] = next
      }
    }
    if (tail > largestSize) {
      largestSize = tail
      largestId = componentId
    }
  }

  if (!largestId || largestSize / pixelCount < 0.105) return emptyAnalysis

  const left = new Int32Array(height).fill(width)
  const right = new Int32Array(height).fill(-1)
  const top = new Int32Array(width).fill(height)
  const bottom = new Int32Array(width).fill(-1)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let documentLuma = 0
  let sumX = 0
  let sumY = 0
  let sumXX = 0
  let sumYY = 0
  let sumXY = 0
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    if (labels[pixel] !== largestId) continue
    const x = pixel % width
    const y = Math.floor(pixel / width)
    left[y] = Math.min(left[y], x)
    right[y] = Math.max(right[y], x)
    top[x] = Math.min(top[x], y)
    bottom[x] = Math.max(bottom[x], y)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    documentLuma += luma[pixel]
    sumX += x
    sumY += y
    sumXX += x * x
    sumYY += y * y
    sumXY += x * y
  }

  const boxWidth = maxX - minX + 1
  const boxHeight = maxY - minY + 1
  if (boxWidth < width * 0.2 || boxHeight < height * 0.2) return emptyAnalysis

  const rowInset = Math.max(2, Math.round(boxHeight * 0.08))
  const colInset = Math.max(2, Math.round(boxWidth * 0.08))
  const leftSamples: { independent: number; dependent: number }[] = []
  const rightSamples: { independent: number; dependent: number }[] = []
  for (let y = minY + rowInset; y <= maxY - rowInset; y++) {
    if (right[y] - left[y] < boxWidth * 0.48) continue
    leftSamples.push({ independent: y, dependent: left[y] })
    rightSamples.push({ independent: y, dependent: right[y] })
  }
  const topSamples: { independent: number; dependent: number }[] = []
  const bottomSamples: { independent: number; dependent: number }[] = []
  for (let x = minX + colInset; x <= maxX - colInset; x++) {
    if (bottom[x] - top[x] < boxHeight * 0.48) continue
    topSamples.push({ independent: x, dependent: top[x] })
    bottomSamples.push({ independent: x, dependent: bottom[x] })
  }

  const leftLine = fitLine(leftSamples)
  const rightLine = fitLine(rightSamples)
  const topLine = fitLine(topSamples)
  const bottomLine = fitLine(bottomSamples)
  if (!leftLine || !rightLine || !topLine || !bottomLine) return emptyAnalysis

  const rawCorners = [
    intersect(leftLine, topLine),
    intersect(rightLine, topLine),
    intersect(rightLine, bottomLine),
    intersect(leftLine, bottomLine),
  ]
  if (rawCorners.some((corner) => !corner)) return emptyAnalysis
  const corners = rawCorners.map((corner) => ({
    x: clamp(corner!.x / width, -0.05, 1.05),
    y: clamp(corner!.y / height, -0.05, 1.05),
  })) as [ScanGuidePoint, ScanGuidePoint, ScanGuidePoint, ScanGuidePoint]

  const [topLeft, topRight, bottomRight, bottomLeft] = corners
  const areaRatio = polygonArea(corners)
  const topLength = distance(topLeft, topRight, width, height)
  const bottomLength = distance(bottomLeft, bottomRight, width, height)
  const leftLength = distance(topLeft, bottomLeft, width, height)
  const rightLength = distance(topRight, bottomRight, width, height)
  const perspective = Math.max(
    Math.abs(topLength - bottomLength) / Math.max(topLength, bottomLength, 0.001),
    Math.abs(leftLength - rightLength) / Math.max(leftLength, rightLength, 0.001)
  )
  const fittedTopAngle = Math.atan2(
    (topRight.y - topLeft.y) * height,
    (topRight.x - topLeft.x) * width
  ) * 180 / Math.PI
  const fittedBottomAngle = Math.atan2(
    (bottomRight.y - bottomLeft.y) * height,
    (bottomRight.x - bottomLeft.x) * width
  ) * 180 / Math.PI
  const meanX = sumX / largestSize
  const meanY = sumY / largestSize
  const covXX = sumXX / largestSize - meanX * meanX
  const covYY = sumYY / largestSize - meanY * meanY
  const covXY = sumXY / largestSize - meanX * meanY
  const axisDegrees = 0.5 * Math.atan2(2 * covXY, covXX - covYY) * 180 / Math.PI
  const nearestAxis = Math.round(axisDegrees / 90) * 90
  const momentAngle = axisDegrees - nearestAxis
  const fittedAngle = (fittedTopAngle + fittedBottomAngle) / 2
  const angle = Math.abs(momentAngle) >= Math.abs(fittedAngle) ? momentAngle : fittedAngle
  const clipped = corners.some((point) => point.x < 0.025 || point.x > 0.975 || point.y < 0.025 || point.y > 0.975)

  let laplacianEnergy = 0
  let laplacianCount = 0
  for (let y = Math.max(1, minY); y < Math.min(height - 1, maxY); y += 2) {
    for (let x = Math.max(1, minX); x < Math.min(width - 1, maxX); x += 2) {
      const pixel = y * width + x
      if (labels[pixel] !== largestId) continue
      const laplacian = Math.abs(
        luma[pixel] * 4 - luma[pixel - 1] - luma[pixel + 1] - luma[pixel - width] - luma[pixel + width]
      )
      laplacianEnergy += laplacian
      laplacianCount++
    }
  }
  const sharpness = clamp(((laplacianEnergy / Math.max(1, laplacianCount)) - 1.5) / 13, 0, 1)
  const brightness = documentLuma / largestSize

  let status: ScanGuideStatus = 'ready'
  let message = 'Document détecté — ne bougez plus'
  if (clipped || areaRatio > 0.9) {
    status = 'clipped'
    message = 'Gardez les quatre coins visibles'
  } else if (areaRatio < 0.22) {
    status = 'too-far'
    message = 'Rapprochez-vous du document'
  } else if (Math.abs(angle) > 7.5) {
    status = 'tilted'
    message = 'Redressez légèrement le téléphone'
  } else if (perspective > 0.38) {
    status = 'perspective'
    message = 'Placez le téléphone face au document'
  } else if (brightness < 48) {
    status = 'dark'
    message = 'Ajoutez un peu de lumière'
  } else if (sharpness < 0.055) {
    status = 'blurry'
    message = 'Stabilisez le téléphone'
  }

  return {
    detected: true,
    corners,
    status,
    message,
    ready: status === 'ready',
    areaRatio,
    angle,
    perspective,
    brightness,
    sharpness,
  }
}
