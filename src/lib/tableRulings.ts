/**
 * Détection des traits verticaux d'un tableau (filets de colonnes) dans l'image
 * d'une page. Sur un scan, c'est l'indice le plus fiable : les traits donnent
 * les colonnes même quand le texte déborde ou que les espaces sont irréguliers.
 * Fichier sans dépendance : il travaille sur une image déjà binarisée.
 */

/** Image binarisée d'une page : 1 = pixel sombre. */
export interface DarkImage {
  data: Uint8Array
  width: number
  height: number
}

/** Binarise des pixels RGBA (`ImageData.data`). */
export function toDarkImage(rgba: Uint8ClampedArray, width: number, height: number): DarkImage {
  const data = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    // Luminance approchée ; les filets gris clair des relevés restent sous le seuil
    const lum = (rgba[p] * 3 + rgba[p + 1] * 6 + rgba[p + 2]) / 10
    data[i] = lum < 170 ? 1 : 0
  }
  return { data, width, height }
}

/**
 * Abscisses (en pixels) des traits verticaux continus qui traversent la zone.
 *
 * La zone est découpée en bandes horizontales ; dans chaque bande on relève les
 * colonnes de pixels presque entièrement sombres (un trait plein — une pile de
 * caractères alignés n'atteint jamais ce taux à cause des interlignes). Un trait
 * est retenu s'il se retrouve dans la majorité des bandes, en tolérant la légère
 * dérive d'un scan incliné. Les aplats (logo, zone noircie) sont écartés par
 * leur largeur.
 */
export function findVerticalRulings(
  image: DarkImage,
  zone: { x0: number; y0: number; x1: number; y1: number }
): number[] {
  const x0 = Math.max(0, Math.floor(zone.x0))
  const x1 = Math.min(image.width, Math.ceil(zone.x1))
  const y0 = Math.max(0, Math.floor(zone.y0))
  const y1 = Math.min(image.height, Math.ceil(zone.y1))
  const width = x1 - x0
  const height = y1 - y0
  if (width < 20 || height < 40) return []

  const bandCount = Math.min(24, Math.max(4, Math.round(height / 60)))
  const maxLineWidth = Math.max(4, Math.round(image.width * 0.005))
  const tolerance = Math.max(3, Math.round(image.width * 0.004))
  const hits: { band: number; x: number }[] = []
  const counts = new Uint16Array(width)

  for (let band = 0; band < bandCount; band++) {
    const top = y0 + Math.floor((band * height) / bandCount)
    const bottom = y0 + Math.floor(((band + 1) * height) / bandCount)
    const rows = bottom - top
    if (rows < 8) continue
    counts.fill(0)
    for (let y = top; y < bottom; y++) {
      const offset = y * image.width + x0
      for (let x = 0; x < width; x++) counts[x] += image.data[offset + x]
    }
    const needed = rows * 0.7
    let x = 0
    while (x < width) {
      if (counts[x] < needed) {
        x++
        continue
      }
      let end = x
      while (end + 1 < width && counts[end + 1] >= needed) end++
      if (end - x + 1 <= maxLineWidth) hits.push({ band, x: x0 + (x + end) / 2 })
      x = end + 1
    }
  }

  hits.sort((a, b) => a.x - b.x)
  const lines: number[] = []
  let group: { band: number; x: number }[] = []
  const flush = () => {
    if (new Set(group.map((h) => h.band)).size >= bandCount * 0.5) {
      const xs = group.map((h) => h.x).sort((a, b) => a - b)
      lines.push(xs[xs.length >> 1])
    }
    group = []
  }
  for (const hit of hits) {
    if (group.length && hit.x - group[group.length - 1].x > tolerance) flush()
    group.push(hit)
  }
  if (group.length) flush()

  // Les bords du cadre tracé ne séparent rien
  const margin = Math.max(4, width * 0.01)
  return lines.filter((x) => x > x0 + margin && x < x1 - margin)
}
