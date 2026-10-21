import type { OpenCvRuntime } from './opencv'

/**
 * Traitements d'image classiques (OpenCV.js, 100 % local) :
 *
 * - amélioration de lisibilité : débruitage, contraste local (CLAHE),
 *   fond blanchi, masque flou (netteté), agrandissement des petites images ;
 * - détection et extraction de tickets posés à plusieurs sur une même page
 *   (scan ou photo), redressés par transformation de perspective.
 *
 * Aucun modèle d'IA : les pixels sont renforcés, jamais inventés — un chiffre
 * illisible reste illisible, il ne devient pas un autre chiffre.
 */

type Mat = InstanceType<OpenCvRuntime['Mat']>

export type EnhanceMode = 'color' | 'document' | 'bw'

export interface EnhanceOptions {
  mode: EnhanceMode
  /** Intensité 0..1. */
  strength: number
  /** Agrandir (×2 max) les images de faible résolution avant traitement. */
  upscale: boolean
}

export const ENHANCE_MODES: Record<EnhanceMode, { label: string; description: string }> = {
  color: { label: 'Couleur', description: 'Photo ou document en couleur : netteté, contraste et débruitage' },
  document: { label: 'Document', description: 'Niveaux de gris, fond blanchi, ombres atténuées : idéal pour les tickets et factures' },
  bw: { label: 'Noir et blanc', description: 'Encre noire sur fond blanc, fichier léger : texte pâle, fax. À éviter sur une image très floue (les chiffres peuvent se déformer)' },
}

/** Côté long visé lors de l'agrandissement. */
const UPSCALE_TARGET = 2200
/** Plafond de pixels traités (mémoire WebAssembly). */
const MAX_PIXELS = 16_000_000

const odd = (n: number) => (Math.round(n) | 1)

/** Masque flou : img + amount × (img − flou). */
function unsharp(cv: OpenCvRuntime, img: Mat, sigma: number, amount: number) {
  const blur = new cv.Mat()
  try {
    cv.GaussianBlur(img, blur, new cv.Size(0, 0), sigma, sigma, cv.BORDER_DEFAULT)
    cv.addWeighted(img, 1 + amount, blur, -amount, 0, img)
  } finally {
    blur.delete()
  }
}

/** Percentile (0..1) d'un histogramme 256 niveaux. */
function percentile(hist: Uint32Array, total: number, p: number) {
  for (let acc = 0, v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= total * p) return v
  }
  return 255
}

/**
 * Niveaux d'une image au fond déjà blanchi (8 bits, 1 canal) : point noir sur
 * les pixels les plus sombres, point blanc juste sous le grain du fond — le
 * grain disparaît, le papier devient blanc franc, l'encre s'assombrit.
 */
function levels(gray: Mat, blackPct: number) {
  const data = gray.data as Uint8Array
  const hist = new Uint32Array(256)
  for (let i = 0; i < data.length; i++) hist[data[i]]++
  const ink = percentile(hist, data.length, blackPct)
  // Le fond domine : sa médiane et son quartile bas mesurent l'amplitude du grain
  const p50 = percentile(hist, data.length, 0.5)
  const p25 = percentile(hist, data.length, 0.25)
  const hi = Math.min(250, p50 - 2 * Math.max(2, p50 - p25))
  // Le cœur de l'encre devient gris très foncé, pas noir : caler le noir sur l'encre
  // noircirait aussi le halo du flou et boucherait les « 8 », « 6 », « 9 »
  const INK = 45
  const lo = Math.round((ink * 255 - INK * hi) / (255 - INK))
  if (hi - lo < 20 || hi <= ink) return
  const lut = new Uint8Array(256)
  for (let v = 0; v < 256; v++) {
    const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
    // Courbe légère : l'encre pâle des tickets thermiques fonce un peu, sans boucher les « 8 » ni les « 6 »
    lut[v] = Math.round(255 * Math.pow(t, 1.1))
  }
  for (let i = 0; i < data.length; i++) data[i] = lut[data[i]]
}

/**
 * Fond blanchi : divise l'image par une estimation de son fond (dilatation
 * puis flou médian, qui effacent le texte). Ombres et éclairage inégal
 * disparaissent, l'encre reste.
 */
function flattenBackground(cv: OpenCvRuntime, gray: Mat) {
  const bg = new cv.Mat()
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7))
  try {
    cv.dilate(gray, bg, kernel, new cv.Point(-1, -1), 2)
    cv.medianBlur(bg, bg, odd(Math.max(gray.cols, gray.rows) / 40))
    cv.divide(gray, bg, gray, 255, -1)
  } finally {
    bg.delete()
    kernel.delete()
  }
}

/** Améliore la lisibilité d'une image. La source n'est jamais modifiée. */
export function enhanceCanvas(cv: OpenCvRuntime, src: HTMLCanvasElement, opts: EnhanceOptions): HTMLCanvasElement {
  const s = Math.max(0, Math.min(1, opts.strength))
  const rgba = cv.imread(src)
  const img = new cv.Mat()
  try {
    cv.cvtColor(rgba, img, cv.COLOR_RGBA2RGB)

    // 1. Agrandissement des petites images : plus de pixels pour l'œil et l'OCR
    const long = Math.max(img.cols, img.rows)
    if (opts.upscale && long < UPSCALE_TARGET) {
      let f = Math.min(2, UPSCALE_TARGET / long)
      if (img.cols * img.rows * f * f > MAX_PIXELS) f = Math.sqrt(MAX_PIXELS / (img.cols * img.rows))
      if (f > 1.1) cv.resize(img, img, new cv.Size(Math.round(img.cols * f), Math.round(img.rows * f)), 0, 0, cv.INTER_CUBIC)
    }
    // Flou du masque proportionnel à la taille : les détails à renforcer grossissent avec la résolution
    const sigma = Math.max(1, Math.max(img.cols, img.rows) / 1400)

    if (opts.mode === 'color') {
      // 2. Débruitage qui préserve les contours (le bruit serait sinon amplifié par la netteté)
      const den = new cv.Mat()
      cv.bilateralFilter(img, den, 5, 20 + 40 * s, 5, cv.BORDER_DEFAULT)
      den.copyTo(img)
      den.delete()
      // 3. Contraste local sur la luminance seule (couleurs conservées)
      const lab = new cv.Mat()
      const channels = new cv.MatVector()
      const clahe = new cv.CLAHE(1.2 + 2 * s, new cv.Size(8, 8))
      try {
        cv.cvtColor(img, lab, cv.COLOR_RGB2Lab)
        cv.split(lab, channels)
        const l = channels.get(0)
        clahe.apply(l, l)
        channels.set(0, l)
        l.delete()
        cv.merge(channels, lab)
        cv.cvtColor(lab, img, cv.COLOR_Lab2RGB)
      } finally {
        lab.delete()
        channels.delete()
        clahe.delete()
      }
      // 4. Netteté
      unsharp(cv, img, sigma, 0.5 + 1.3 * s)
      const out = document.createElement('canvas')
      cv.imshow(out, img)
      return out
    }

    // Modes document / noir et blanc : niveaux de gris, fond blanchi
    const gray = new cv.Mat()
    try {
      cv.cvtColor(img, gray, cv.COLOR_RGB2GRAY)
      cv.bilateralFilter(gray, img, 7, 25 + 35 * s, 7, cv.BORDER_DEFAULT)
      img.copyTo(gray)
      flattenBackground(cv, gray)
      // Encre renforcée, fond franchement blanc
      levels(gray, 0.002 + 0.008 * s)
      if (opts.mode === 'document') {
        unsharp(cv, gray, sigma, 0.3 + 0.9 * s)
      } else {
        // Fond déjà uniforme : un seuil global suit mieux la forme des glyphes flous qu'un
        // seuil local, qui rogne ou soude les traits (un 2 qui devient 3, un 9 qui devient 0)
        unsharp(cv, gray, sigma, 0.3 + 0.5 * s)
        cv.threshold(gray, gray, 115 + 50 * s, 255, cv.THRESH_BINARY)
        cv.medianBlur(gray, gray, 3)
      }
      const out = document.createElement('canvas')
      cv.imshow(out, gray)
      return out
    } finally {
      gray.delete()
    }
  } finally {
    rgba.delete()
    img.delete()
  }
}

/* ------------------------------------------------------------------------- */
/* Tickets                                                                     */
/* ------------------------------------------------------------------------- */

export interface Pt { x: number; y: number }
/** Quadrilatère en coordonnées normalisées 0..1 : haut-gauche, haut-droite, bas-droite, bas-gauche. */
export type Quad = [Pt, Pt, Pt, Pt]

export function rectQuad(x: number, y: number, w: number, h: number): Quad {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
}

export function quadBounds(q: Quad) {
  const xs = q.map((p) => p.x)
  const ys = q.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

function orderQuad(points: Pt[]): Quad {
  const by = (f: (p: Pt) => number, max: boolean) =>
    points.reduce((best, p) => ((max ? f(p) > f(best) : f(p) < f(best)) ? p : best))
  return [
    by((p) => p.x + p.y, false),
    by((p) => p.x - p.y, true),
    by((p) => p.x + p.y, true),
    by((p) => p.x - p.y, false),
  ]
}

/** Côté long de travail pour la détection (rapide, assez fin pour des tickets). */
const DETECT_PX = 1000

/**
 * Repère les tickets (ou petits documents) disposés sur une page.
 * `sensitivity` 0..1 : plus elle est haute, plus les petits éléments sont retenus.
 *
 * Deux cas :
 * - fond sombre ou contrasté (photo sur un bureau) : le papier est séparé du
 *   fond par seuillage d'Otsu ;
 * - fond clair (scan : tickets blancs sur le capot blanc) : le papier se
 *   confond avec le fond, on regroupe alors l'encre et les bords proches —
 *   chaque amas de lignes forme un ticket.
 */
export function detectReceipts(cv: OpenCvRuntime, src: HTMLCanvasElement, sensitivity = 0.5): Quad[] {
  // Bandes noires uniformes (capture d'écran de téléphone, scan rogné) écartées : elles
  // feraient passer un fond blanc pour un fond sombre
  const crop = trimDarkBars(src)
  // Petites images (capture d'écran, photo réduite) agrandies : les noyaux restent assez fins
  const k = Math.min(3, DETECT_PX / Math.max(crop.width, crop.height))
  const small = document.createElement('canvas')
  small.width = Math.max(1, Math.round(crop.width * k))
  small.height = Math.max(1, Math.round(crop.height * k))
  small.getContext('2d')!.drawImage(src, crop.x, crop.y, crop.width, crop.height, 0, 0, small.width, small.height)
  const W = small.width
  const H = small.height

  const rgba = cv.imread(small)
  const gray = new cv.Mat()
  const mask = new cv.Mat()
  const tmp = new cv.Mat()
  const mats: Mat[] = []
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT)

    // Luminance du fond : médiane d'une bande de 2 % le long des bords
    const g = gray.data as Uint8Array
    const band = Math.max(2, Math.round(Math.min(W, H) * 0.02))
    const border: number[] = []
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        if (x < band || y < band || x >= W - band || y >= H - band) border.push(g[y * W + x])
      }
    }
    border.sort((a, b) => a - b)
    const bgLevel = border[Math.floor(border.length / 2)] ?? 255
    const otsu = cv.threshold(gray, tmp, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU)
    // Fond nettement plus sombre que le papier
    const darkBackground = bgLevel < otsu - 15 && bgLevel < 170

    const unit = Math.max(W, H)
    if (darkBackground) {
      tmp.copyTo(mask)
      const open = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))
      const close = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(odd(unit / 80), odd(unit / 80)))
      mats.push(open, close)
      cv.morphologyEx(mask, mask, cv.MORPH_OPEN, open)
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, close)
    } else {
      // Encre (seuil local inversé) + bords du papier (Canny), puis fusion des lignes voisines
      const edges = new cv.Mat()
      mats.push(edges)
      // Seuils relevés selon le bruit (grain de photo, artefacts JPEG) : sinon le grain du fond
      // fusionne en une seule zone couvrant toute la page
      const sigma = noiseLevel(cv, gray)
      cv.adaptiveThreshold(gray, mask, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, odd(unit / 50), Math.max(12, 5 * sigma))
      const low = Math.max(30, 8 * sigma)
      cv.Canny(gray, edges, low, low * 3)
      cv.bitwise_or(mask, edges, mask)
      // Grains isolés retirés avant la fusion
      const speck = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3))
      mats.push(speck)
      cv.morphologyEx(mask, mask, cv.MORPH_OPEN, speck)

      // Lignes de coupe : bords de papier (longs traits verticaux) et grands traits horizontaux
      // (bord de scan, pli). Des tickets qui se touchent restent ainsi séparés après la fusion.
      const cuts = new cv.Mat()
      const horiz = new cv.Mat()
      mats.push(cuts, horiz)
      const vKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, odd(unit / 10)))
      const hKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(odd(unit / 4), 1))
      mats.push(vKernel, hKernel)
      cv.morphologyEx(mask, cuts, cv.MORPH_OPEN, vKernel)
      cv.morphologyEx(mask, horiz, cv.MORPH_OPEN, hKernel)
      // Prolongées verticalement : une annotation manuscrite au-dessus de deux tickets ne les relie pas
      const extend = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(odd(unit / 150), odd(unit / 8)))
      const widen = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(odd(unit / 150), odd(unit / 150)))
      mats.push(extend, widen)
      cv.dilate(cuts, cuts, extend)
      cv.dilate(horiz, horiz, widen)
      cv.bitwise_or(cuts, horiz, cuts)
      cv.subtract(mask, cuts, mask)

      // Écart horizontal entre mots < écart vertical entre tickets : noyau plus large que haut
      const merge = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(odd(unit / 50), odd(unit / 70)))
      mats.push(merge)
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, merge, new cv.Point(-1, -1), 2)
      cv.dilate(mask, mask, speck, new cv.Point(-1, -1), 2)
      // La fusion a pu franchir une coupe : on recoupe
      cv.subtract(mask, cuts, mask)
    }

    // Bord de l'image effacé : un liseré (rognage du scanner, compression JPEG) relierait
    // sinon tous les tickets en une seule zone englobant la page
    const edge = Math.max(2, Math.round(unit * 0.006))
    cv.rectangle(mask, new cv.Point(0, 0), new cv.Point(W - 1, H - 1), new cv.Scalar(0), edge * 2)

    // Surface minimale : de 4 % (sensibilité 0) à 0,5 % (sensibilité 1) de l'image
    const minArea = W * H * (0.04 - 0.035 * Math.max(0, Math.min(1, sensitivity)))
    const found: { quad: Quad; area: number }[] = []
    for (const points of splitRegions(cv, mask, unit)) {
      try {
        const rect = cv.minAreaRect(points)
        const area = rect.size.width * rect.size.height
        if (area < minArea || area > W * H * 0.97) continue
        // Bandes très fines : pli, bord du capot, trait de règle
        if (Math.min(rect.size.width, rect.size.height) < unit * 0.03) continue
        // Fond clair : la zone suit l'encre, on rend une marge pour ne pas rogner le papier
        if (!darkBackground) {
          rect.size.width += unit * 0.025
          rect.size.height += unit * 0.025
        }
        // Repère de l'image d'origine (avant rognage des bandes noires)
        const pts = cv.boxPoints(rect).map((p) => ({
          x: Math.max(0, Math.min(1, (crop.x + (p.x / W) * crop.width) / src.width)),
          y: Math.max(0, Math.min(1, (crop.y + (p.y / H) * crop.height) / src.height)),
        }))
        found.push({ quad: orderQuad(pts), area })
      } finally {
        points.delete()
      }
    }

    // Une zone contenue dans une autre (logo, tampon dans un ticket) est écartée
    const kept = found
      .sort((a, b) => b.area - a.area)
      .filter((f, i, all) => {
        const b = quadBounds(f.quad)
        return !all.slice(0, i).some((o) => {
          const ob = quadBounds(o.quad)
          const ix = Math.max(0, Math.min(b.x + b.width, ob.x + ob.width) - Math.max(b.x, ob.x))
          const iy = Math.max(0, Math.min(b.y + b.height, ob.y + ob.height) - Math.max(b.y, ob.y))
          return ix * iy > b.width * b.height * 0.6
        })
      })
      .map((f) => f.quad)
    return sortReadingOrder(kept)
  } finally {
    for (const m of mats) m.delete()
    rgba.delete()
    gray.delete()
    mask.delete()
    tmp.delete()
  }
}

/**
 * Régions de pixels du masque, une par ticket. Deux tickets reliés par un pont
 * étroit (annotation manuscrite, coin qui se chevauche) sont séparés : une
 * ouverture morphologique isole leurs « cœurs », puis une ligne de partage
 * des eaux redistribue chaque pixel au cœur le plus proche.
 * Retourne, pour chaque région, ses points (Mat CV_32SC2 à libérer).
 */
function splitRegions(cv: OpenCvRuntime, mask: Mat, unit: number): Mat[] {
  const W = mask.cols
  const H = mask.rows
  const cores = new cv.Mat()
  const labels = new cv.Mat()
  const color = new cv.Mat()
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(odd(unit / 60), odd(unit / 60)))
  try {
    cv.morphologyEx(mask, cores, cv.MORPH_OPEN, kernel)
    const n = cv.connectedComponents(cores, labels, 8, cv.CV_32S)
    // Marqueurs : 1 = fond, 2.. = cœurs, 0 = à attribuer
    const m = mask.data as Uint8Array
    const lab = labels.data32S
    for (let i = 0; i < lab.length; i++) lab[i] = m[i] === 0 ? 1 : lab[i] > 0 ? lab[i] + 1 : 0
    cv.cvtColor(mask, color, cv.COLOR_GRAY2RGB)
    cv.watershed(color, labels)

    const buckets: number[][] = Array.from({ length: n + 1 }, () => [])
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const l = lab[y * W + x]
        if (l >= 2 && m[y * W + x]) buckets[l].push(x, y)
      }
    }
    return buckets.filter((b) => b.length >= 8).map((b) => cv.matFromArray(b.length / 2, 1, cv.CV_32SC2, b))
  } finally {
    cores.delete()
    labels.delete()
    color.delete()
    kernel.delete()
  }
}

/** Zone utile d'une image, sans les bandes noires uniformes qui l'encadrent. */
function trimDarkBars(src: HTMLCanvasElement) {
  const k = Math.min(1, 400 / Math.max(src.width, src.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(src.width * k))
  c.height = Math.max(1, Math.round(src.height * k))
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0, c.width, c.height)
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  const lum = (x: number, y: number) => {
    const i = (y * c.width + x) * 4
    return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  }
  // Ligne (ou colonne) quasi noire et uniforme
  const isBar = (n: number, at: (i: number) => number) => {
    let sum = 0
    let max = 0
    for (let i = 0; i < n; i++) {
      const v = at(i)
      sum += v
      max = Math.max(max, v)
    }
    return sum / n < 30 && max < 70
  }
  let top = 0
  let bottom = c.height
  let left = 0
  let right = c.width
  while (top < bottom - 1 && isBar(c.width, (x) => lum(x, top))) top++
  while (bottom - 1 > top && isBar(c.width, (x) => lum(x, bottom - 1))) bottom--
  while (left < right - 1 && isBar(bottom - top, (y) => lum(left, top + y))) left++
  while (right - 1 > left && isBar(bottom - top, (y) => lum(right - 1, top + y))) right--
  // Rien d'exploitable (image entièrement sombre) : on garde tout
  if ((right - left) * (bottom - top) < c.width * c.height * 0.2) {
    return { x: 0, y: 0, width: src.width, height: src.height }
  }
  // Un pixel de marge supplémentaire : la transition bande / page est floue
  const m = 1
  const x = Math.min(src.width - 1, Math.round((left + (left ? m : 0)) / k))
  const y = Math.min(src.height - 1, Math.round((top + (top ? m : 0)) / k))
  return {
    x,
    y,
    width: Math.max(1, Math.round((right - (right < c.width ? m : 0)) / k) - x),
    height: Math.max(1, Math.round((bottom - (bottom < c.height ? m : 0)) / k) - y),
  }
}

/**
 * Écart-type du bruit d'une image en niveaux de gris, estimé par la médiane
 * des écarts à un flou médian (robuste : le texte et les bords pèsent peu).
 */
function noiseLevel(cv: OpenCvRuntime, gray: Mat): number {
  const med = new cv.Mat()
  try {
    cv.medianBlur(gray, med, 5)
    const a = gray.data as Uint8Array
    const m = med.data as Uint8Array
    const hist = new Uint32Array(256)
    for (let i = 0; i < a.length; i += 3) hist[Math.abs(a[i] - m[i])]++
    const half = Math.ceil(a.length / 3) / 2
    let acc = 0
    for (let v = 0; v < 256; v++) {
      acc += hist[v]
      if (acc >= half) return v * 1.4826
    }
    return 0
  } finally {
    med.delete()
  }
}

/** Ordre de lecture : par rangées (chevauchement vertical), puis de gauche à droite. */
export function sortReadingOrder(quads: Quad[]): Quad[] {
  const items = quads.map((q) => ({ q, b: quadBounds(q) })).sort((a, b) => a.b.y - b.b.y)
  const rows: (typeof items)[] = []
  for (const it of items) {
    const row = rows.find((r) => r.some((o) => {
      const overlap = Math.min(o.b.y + o.b.height, it.b.y + it.b.height) - Math.max(o.b.y, it.b.y)
      return overlap > Math.min(o.b.height, it.b.height) * 0.4
    }))
    if (row) row.push(it)
    else rows.push([it])
  }
  return rows.flatMap((r) => r.sort((a, b) => a.b.x - b.b.x).map((it) => it.q))
}

/** Côté long visé pour un ticket découpé dans une image de faible résolution. */
const RECEIPT_TARGET_PX = 2000
/** Au-delà, l'agrandissement n'apporte plus rien : l'information n'existe pas dans la source. */
const RECEIPT_MAX_ZOOM = 6

/** Facteur d'agrandissement d'un ticket de `w` × `h` pixels (1 si sa résolution suffit). */
export function receiptZoom(w: number, h: number): number {
  const long = Math.max(w, h)
  if (long >= RECEIPT_TARGET_PX * 0.9) return 1
  let f = Math.min(RECEIPT_MAX_ZOOM, RECEIPT_TARGET_PX / long)
  if (w * h * f * f > MAX_PIXELS) f = Math.sqrt(MAX_PIXELS / (w * h))
  return Math.max(1, f)
}

/**
 * Découpe et redresse une zone (quadrilatère normalisé) de l'image.
 * `zoom` > 1 : la zone est agrandie dans la même opération (une seule
 * interpolation, Lanczos), puis un masque flou léger rend aux traits la
 * netteté que l'interpolation adoucit.
 */
export function extractQuad(cv: OpenCvRuntime, src: HTMLCanvasElement, quad: Quad, zoom = 1): HTMLCanvasElement {
  const P = quad.map((p) => ({ x: p.x * src.width, y: p.y * src.height }))
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
  const w = Math.max(1, Math.round(((dist(P[0], P[1]) + dist(P[3], P[2])) / 2) * zoom))
  const h = Math.max(1, Math.round(((dist(P[0], P[3]) + dist(P[1], P[2])) / 2) * zoom))
  const rgba = cv.imread(src)
  const out = new cv.Mat()
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, P.flatMap((p) => [p.x, p.y]))
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h])
  const M = cv.getPerspectiveTransform(from, to)
  try {
    const interp = zoom > 1.1 ? cv.INTER_LANCZOS4 : cv.INTER_CUBIC
    cv.warpPerspective(rgba, out, M, new cv.Size(w, h), interp, cv.BORDER_REPLICATE, new cv.Scalar())
    if (zoom > 1.1) {
      cv.cvtColor(out, out, cv.COLOR_RGBA2RGB)
      // Débruitage léger : sans lui, la netteté ferait ressortir les blocs JPEG agrandis
      const den = new cv.Mat()
      cv.bilateralFilter(out, den, 5, 18, Math.max(3, zoom), cv.BORDER_DEFAULT)
      den.copyTo(out)
      den.delete()
      // Flou du masque à l'échelle d'un pixel d'origine : on accentue les traits, pas le grain
      unsharp(cv, out, Math.max(1, zoom * 0.6), 0.8)
    }
    const canvas = document.createElement('canvas')
    cv.imshow(canvas, out)
    return canvas
  } finally {
    rgba.delete()
    out.delete()
    from.delete()
    to.delete()
    M.delete()
  }
}
