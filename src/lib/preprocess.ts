/**
 * Prétraitement d'image pour l'OCR.
 *
 * Tesseract est entraîné sur du texte net, noir sur blanc, d'au moins
 * ~20 px de hauteur. Les photos et scans réels (contraste faible, éclairage
 * inégal, petite résolution) le mettent en échec. Pipeline appliqué :
 *
 *   1. agrandissement si l'image est petite (le LSTM lit mal le texte < 20 px) ;
 *   2. niveaux de gris + étirement de contraste (percentiles 1-99) ;
 *   3. binarisation adaptative (méthode de Bradley : seuil = moyenne locale
 *      via image intégrale), qui neutralise ombres et éclairage inégal —
 *      là où un seuil global (Otsu, utilisé en interne par tesseract)
 *      transforme la moitié d'une photo ombrée en aplat noir.
 */

export interface PreprocessOptions {
  /** Appliquer la binarisation adaptative (recommandé pour photos/scans). */
  binarize?: boolean
}

/** Largeur minimale visée : en dessous, le texte est trop petit pour le LSTM. */
const TARGET_WIDTH = 1500
/** Plafond de pixels après agrandissement (mémoire + temps de calcul). */
const MAX_PIXELS = 12_000_000

export function preprocessForOcr(
  src: HTMLCanvasElement,
  { binarize = true }: PreprocessOptions = {}
): HTMLCanvasElement {
  // 1. Copie (jamais de mutation de la source), agrandie si nécessaire
  let scale = 1
  if (src.width < TARGET_WIDTH) {
    scale = Math.min(3, TARGET_WIDTH / src.width)
    if (src.width * scale * (src.height * scale) > MAX_PIXELS) scale = 1
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(src.width * scale)
  canvas.height = Math.round(src.height * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height)

  const w = canvas.width
  const h = canvas.height
  const imageData = ctx.getImageData(0, 0, w, h)
  const px = imageData.data

  // 2. Niveaux de gris
  const gray = new Uint8Array(w * h)
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    gray[j] = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) | 0
  }

  // Polarité : si l'image est majoritairement sombre (texte clair sur fond
  // sombre), on inverse pour retrouver du texte sombre sur fond clair.
  let sum = 0
  for (let j = 0; j < gray.length; j++) sum += gray[j]
  if (sum / gray.length < 110) {
    for (let j = 0; j < gray.length; j++) gray[j] = 255 - gray[j]
  }

  // Étirement de contraste sur les percentiles 1-99
  const hist = new Uint32Array(256)
  for (let j = 0; j < gray.length; j++) hist[gray[j]]++
  const total = gray.length
  let lo = 0
  let hi = 255
  for (let acc = 0, v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= total * 0.01) { lo = v; break }
  }
  for (let acc = 0, v = 255; v >= 0; v--) {
    acc += hist[v]
    if (acc >= total * 0.01) { hi = v; break }
  }
  if (hi - lo > 10 && (lo > 5 || hi < 250)) {
    const range = hi - lo
    for (let j = 0; j < gray.length; j++) {
      const v = ((gray[j] - lo) * 255) / range
      gray[j] = v < 0 ? 0 : v > 255 ? 255 : v | 0
    }
  }

  // 3. Binarisation adaptative de Bradley
  if (binarize) {
    // Image intégrale : integral[(y+1)*(w+1)+(x+1)] = somme du rectangle (0,0)-(x,y)
    const iw = w + 1
    const integral = new Float64Array(iw * (h + 1))
    for (let y = 0; y < h; y++) {
      let rowSum = 0
      for (let x = 0; x < w; x++) {
        rowSum += gray[y * w + x]
        integral[(y + 1) * iw + (x + 1)] = integral[y * iw + (x + 1)] + rowSum
      }
    }
    // Fenêtre locale : ~1/16 de la petite dimension (assez large pour
    // englober du texte ET du fond), seuil à 85% de la moyenne locale.
    const half = Math.max(15, Math.round(Math.min(w, h) / 32))
    const k = 0.85
    const out = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - half)
      const y1 = Math.min(h - 1, y + half)
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - half)
        const x1 = Math.min(w - 1, x + half)
        const area = (x1 - x0 + 1) * (y1 - y0 + 1)
        const s =
          integral[(y1 + 1) * iw + (x1 + 1)] -
          integral[y0 * iw + (x1 + 1)] -
          integral[(y1 + 1) * iw + x0] +
          integral[y0 * iw + x0]
        out[y * w + x] = gray[y * w + x] * area < s * k ? 0 : 255
      }
    }

    // Anti-mouchetures : un pixel noir quasi isolé (≤ 2 voisins noirs) est du
    // bruit amplifié par la binarisation, pas du texte — on le blanchit.
    // Deux itérations pour éroder aussi les petites chaînes de grains ; les
    // glyphes (même les points des « i ») ont des amas bien plus denses.
    let cur = out
    for (let pass = 0; pass < 2; pass++) {
      const clean = new Uint8Array(cur)
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x
          if (cur[i] !== 0) continue
          let neighbors = 0
          if (cur[i - w - 1] === 0) neighbors++
          if (cur[i - w] === 0) neighbors++
          if (cur[i - w + 1] === 0) neighbors++
          if (cur[i - 1] === 0) neighbors++
          if (cur[i + 1] === 0) neighbors++
          if (cur[i + w - 1] === 0) neighbors++
          if (cur[i + w] === 0) neighbors++
          if (cur[i + w + 1] === 0) neighbors++
          if (neighbors <= 2) clean[i] = 255
        }
      }
      cur = clean
    }
    gray.set(cur)
  }

  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    px[i] = px[i + 1] = px[i + 2] = gray[j]
    px[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  return canvas
}
