/**
 * Extraction de tableaux à partir de la couche texte d'un PDF (texte natif ou
 * couche OCR). 100 % local, sans dépendance : ce fichier ne touche ni au DOM
 * ni à pdf.js, il ne manipule que des mots positionnés.
 *
 * Principe : on ne garde que les mots situés dans la zone tracée, on les
 * regroupe en lignes (avec correction d'une légère inclinaison du scan), puis
 * on cherche les couloirs blancs verticaux communs aux lignes : ce sont les
 * séparations de colonnes. L'utilisateur peut imposer ses propres séparations.
 */

/** Mot positionné, en unités de page (points PDF, origine en haut à gauche). */
export interface TextBox {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Élément de texte tel que le fournit pdf.js (`getTextContent`). */
export interface PdfTextItemLike {
  str: string
  transform: number[]
  width: number
  height: number
}

export interface TableOptions {
  /** Séparations de colonnes imposées (abscisses en unités de page) ; null = détection. */
  separators?: number[] | null
  /** Écart minimal entre deux colonnes, en fraction de la hauteur de caractère. */
  gapEm?: number
  /** Rattache à la ligne précédente les lignes de suite (libellé sur deux lignes). */
  mergeContinuations?: boolean
  /**
   * Boîtes serrées sur l'encre (sortie d'OCR) : leur hauteur vaut environ 0,72
   * fois la taille des caractères, les écarts sont mesurés en conséquence.
   */
  tightBoxes?: boolean
  /**
   * Traits verticaux du tableau repérés dans l'image de la page (unités de page).
   * À partir de deux traits dans la zone, ils définissent les colonnes à la place
   * des espaces entre les textes. Avec des séparations imposées, indique lesquelles
   * suivent un trait (un texte sans montant ne déborde pas par-dessus).
   */
  rulings?: number[] | null
}

export interface TableGrid {
  rows: string[][]
  /** Séparations effectivement utilisées (unités de page), triées. */
  separators: number[]
  /** Parmi les séparations, celles qui suivent un trait vertical du tableau. */
  rulings: number[]
  /** Nombre de mots trouvés dans la zone. */
  wordCount: number
}

// ───────────────────────── Texte pdf.js → mots ─────────────────────────

/** Largeur relative approximative d'un caractère (police proportionnelle). */
function charWeight(ch: string): number {
  if (ch === ' ') return 0.28
  if (/[0-9]/.test(ch)) return 0.55
  if (/[.,;:!'|il1]/.test(ch)) return 0.28
  if (/[mwMW@%]/.test(ch)) return 0.85
  if (/[A-Z]/.test(ch)) return 0.67
  return 0.5
}

function multiply(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

/**
 * Convertit les éléments de texte pdf.js en mots positionnés dans le repère de
 * la page affichée (`viewportTransform` = `page.getViewport({ scale: 1 }).transform`).
 * Un élément peut contenir plusieurs mots : la position de chacun est estimée
 * au prorata de la largeur de ses caractères.
 */
export function itemsToWords(items: PdfTextItemLike[], viewportTransform: number[]): TextBox[] {
  const words: TextBox[] = []
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue
    const tx = multiply(viewportTransform, item.transform)
    const angle = Math.atan2(tx[1], tx[0])
    // Texte vertical ou très incliné : hors sujet pour un tableau
    if (Math.abs(angle) > 0.26) continue
    const height = Math.hypot(tx[2], tx[3]) || item.height || 10
    const scaleX = Math.hypot(viewportTransform[0], viewportTransform[1]) || 1
    const chars = [...item.str]
    let total = 0
    const cumul = [0]
    for (const ch of chars) {
      total += charWeight(ch)
      cumul.push(total)
    }
    const width = item.width > 0 ? item.width * scaleX : total * height
    const baseline = tx[5]
    const x = tx[4]
    let i = 0
    while (i < chars.length) {
      if (/\s/.test(chars[i])) {
        i++
        continue
      }
      let j = i
      while (j < chars.length && !/\s/.test(chars[j])) j++
      words.push({
        text: chars.slice(i, j).join(''),
        x0: x + (cumul[i] / total) * width,
        x1: x + (cumul[j] / total) * width,
        y0: baseline - height * 0.8,
        y1: baseline + height * 0.2,
      })
      i = j
    }
  }
  return words
}

// ───────────────────────── Mots → grille ─────────────────────────

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Inclinaison du texte (tangente de l'angle), estimée en cherchant l'angle qui
 * aligne le mieux les mots sur des lignes horizontales. 0 si le gain est faible.
 */
function estimateSkew(words: TextBox[], lineHeight: number): number {
  if (words.length < 6) return 0
  const bin = Math.max(0.5, lineHeight * 0.5)
  const score = (tan: number) => {
    const counts = new Map<number, number>()
    for (const w of words) {
      const y = (w.y0 + w.y1) / 2 - tan * ((w.x0 + w.x1) / 2)
      const key = Math.round(y / bin)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    let sum = 0
    for (const c of counts.values()) sum += c * c
    return sum
  }
  const flat = score(0)
  let best = 0
  let bestScore = flat
  for (let step = -30; step <= 30; step++) {
    if (step === 0) continue
    const tan = step * 0.003 // ± 5° environ, par pas de 0,17°
    const s = score(tan)
    if (s > bestScore) {
      bestScore = s
      best = tan
    }
  }
  return bestScore > flat * 1.08 ? best : 0
}

interface Row {
  y: number
  words: TextBox[]
}

function groupRows(words: TextBox[], lineHeight: number, skew: number): Row[] {
  const tol = Math.max(1, lineHeight * 0.5)
  const located = words
    .map((w) => ({ w, y: (w.y0 + w.y1) / 2 - skew * ((w.x0 + w.x1) / 2) }))
    .sort((a, b) => a.y - b.y)
  const rows: Row[] = []
  for (const { w, y } of located) {
    const last = rows[rows.length - 1]
    if (last && Math.abs(y - last.y) <= tol) {
      last.y = (last.y * last.words.length + y) / (last.words.length + 1)
      last.words.push(w)
    } else {
      rows.push({ y, words: [w] })
    }
  }
  // Morceau de ligne décalé vers le bas ou le haut (bloc OCR mal cadré, montant
  // centré en face d'un libellé sur deux lignes) : deux rangées très proches
  // dont les textes ne se chevauchent pas horizontalement n'en font qu'une.
  const merged: Row[] = []
  for (const row of rows) {
    const last = merged[merged.length - 1]
    const disjoint =
      !!last && row.words.every((a) => last.words.every((b) => a.x1 <= b.x0 + 1 || a.x0 >= b.x1 - 1))
    if (last && row.y - last.y < lineHeight * 0.8 && disjoint) {
      if (row.words.length > last.words.length) last.y = row.y
      last.words.push(...row.words)
    } else {
      merged.push(row)
    }
  }
  for (const row of merged) row.words.sort((a, b) => a.x0 - b.x0)
  return merged
}

interface Segment {
  x0: number
  x1: number
}

const NUMBER_HEAD = /^[-+(]?\d{1,3}$/
const NUMBER_NEXT = /^\d{3}(?:[.,]\d+)?[-)%€]*$/

/**
 * « 1 200,00 » : deux mots qui forment un seul nombre. L'espace des milliers,
 * large sur une couche OCR, ne doit jamais passer pour une séparation.
 */
function isNumberGroup(previous: TextBox, next: TextBox, numberGap: number): boolean {
  return next.x0 - previous.x1 < numberGap && NUMBER_HEAD.test(previous.text) && NUMBER_NEXT.test(next.text)
}

/** Regroupe les mots d'une ligne séparés par moins de `maxGap`. */
function rowSegments(row: Row, maxGap: number, numberGap: number): Segment[] {
  const segments: Segment[] = []
  let previous: TextBox | null = null
  for (const w of row.words) {
    const last = segments[segments.length - 1]
    if (last && previous && (w.x0 - last.x1 < maxGap || isNumberGroup(previous, w, numberGap))) {
      last.x1 = Math.max(last.x1, w.x1)
    } else {
      segments.push({ x0: w.x0, x1: w.x1 })
    }
    previous = w
  }
  return segments
}

/**
 * Couloirs verticaux libres de texte. Quelques lignes « traversantes » (titre,
 * total sur toute la largeur) sont tolérées quand le tableau est assez long ;
 * en revanche un texte isolé qui commence ou finit dans un couloir (colonne peu
 * remplie, comme « Crédit » sur un relevé) est conservé et découpe le couloir.
 */
function findCorridors(segs: Segment[][], minWidth: number): Segment[] {
  const all = segs.flat()
  if (all.length < 2) return []
  let min = Infinity
  let max = -Infinity
  for (const s of all) {
    if (s.x0 < min) min = s.x0
    if (s.x1 > max) max = s.x1
  }
  const step = 0.5
  const n = Math.max(1, Math.ceil((max - min) / step))
  if (n > 40000) return []
  const cover = new Uint16Array(n)
  for (const rowSegs of segs) {
    for (const s of rowSegs) {
      const a = Math.max(0, Math.floor((s.x0 - min) / step))
      const b = Math.min(n, Math.ceil((s.x1 - min) / step))
      for (let i = a; i < b; i++) cover[i]++
    }
  }
  const crossers = segs.length < 6 ? 0 : segs.length < 20 ? 1 : segs.length < 50 ? 2 : 3
  const corridors: Segment[] = []
  let i = 0
  while (i < n) {
    if (cover[i] > crossers) {
      i++
      continue
    }
    let j = i
    while (j < n && cover[j] <= crossers) j++
    const a = min + i * step
    const b = min + j * step
    // Textes présents dans le couloir : seuls ceux qui le traversent de part en
    // part sont ignorés, les autres le découpent.
    let pieces: Segment[] = [{ x0: a, x1: b }]
    for (const s of all) {
      if (s.x1 <= a || s.x0 >= b) continue
      if (s.x0 < a && s.x1 > b) continue
      const next: Segment[] = []
      for (const p of pieces) {
        if (s.x1 <= p.x0 || s.x0 >= p.x1) {
          next.push(p)
          continue
        }
        if (s.x0 > p.x0) next.push({ x0: p.x0, x1: s.x0 })
        if (s.x1 < p.x1) next.push({ x0: s.x1, x1: p.x1 })
      }
      pieces = next
    }
    for (const p of pieces) {
      // Les marges à gauche et à droite du contenu ne sont pas des colonnes
      if (p.x0 <= min + step || p.x1 >= max - step) continue
      if (p.x1 - p.x0 >= minWidth) corridors.push(p)
    }
    i = j
  }
  return corridors
}

const DATE_TOKEN = /^\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?$/

/**
 * Dates en tête de ligne (« date », puis souvent « date de valeur ») : sur une
 * couche OCR écrite ligne par ligne, la position des mots n'est qu'estimée et
 * les couloirs ne ressortent pas. On s'appuie alors sur le contenu : si une
 * bonne part des lignes commence par une date, puis éventuellement une seconde,
 * chacune forme une colonne.
 */
function leadingDateSeparators(rows: Row[], em: number, existing: number[]): number[] {
  const starts = rows.filter((row) => row.words.length >= 2 && DATE_TOKEN.test(row.words[0].text))
  if (starts.length < Math.max(3, rows.length * 0.25)) return []
  const left = median(starts.map((row) => row.words[0].x0))
  let group = starts.filter((row) => Math.abs(row.words[0].x0 - left) < em)
  const base = group.length
  const found: number[] = []
  for (let k = 0; k < 2; k++) {
    group = group.filter((row) => row.words.length > k + 1 && DATE_TOKEN.test(row.words[k].text))
    if (group.length < Math.max(3, base * 0.6)) break
    const dateCenter = median(group.map((row) => (row.words[k].x0 + row.words[k].x1) / 2))
    const nextStart = median(group.map((row) => row.words[k + 1].x0))
    // Déjà séparée par un couloir : rien à ajouter
    if (existing.some((s) => s > dateCenter && s < nextStart + em * 0.3)) continue
    found.push(median(group.map((row) => (row.words[k].x1 + row.words[k + 1].x0) / 2)))
  }
  return found
}

/**
 * Séparations de colonnes : couloirs laissés libres par le texte (au moins
 * `gapEm` entre deux textes d'une même ligne), complétés par les dates de début
 * de ligne quand la couche texte les colle au libellé.
 */
function detectSeparators(rows: Row[], em: number, gapEm: number): number[] {
  const numberGap = Math.max(2.2 * gapEm, 0.8) * em
  const wide = findCorridors(
    rows.map((row) => rowSegments(row, gapEm * em, numberGap)),
    Math.max(1, em * 0.25)
  )
  const separators = wide.map((p) => (p.x0 + p.x1) / 2)
  separators.push(...leadingDateSeparators(rows, em, separators))
  return separators.sort((x, y) => x - y)
}

/**
 * Glyphes parasites d'une couche OCR : case à cocher de pointage lue « ¨ »,
 * filet de tableau lu « | »… Un mot fait uniquement de ces signes est ignoré.
 */
const NOISE_WORD = /^[¨□☐☑▢▫◻■▪●○·•|¦_~`´^]+$/

/** Extrait la grille (lignes × colonnes) des mots situés dans `zone`. */
export function extractTable(words: TextBox[], zone: Rect, options: TableOptions = {}): TableGrid {
  const inside = words.filter((w) => {
    const cx = (w.x0 + w.x1) / 2
    const cy = (w.y0 + w.y1) / 2
    return cx >= zone.x0 && cx <= zone.x1 && cy >= zone.y0 && cy <= zone.y1 && !NOISE_WORD.test(w.text)
  })
  if (!inside.length) return { rows: [], separators: [], rulings: [], wordCount: 0 }

  const lineHeight = (median(inside.map((w) => w.y1 - w.y0)) || 10) * (options.tightBoxes ? 1.35 : 1)
  const skew = estimateSkew(inside, lineHeight)
  const rows = groupRows(inside, lineHeight, skew)
  const gapEm = options.gapEm ?? 0.5

  const inZone = (list: number[]) => list.filter((x) => x > zone.x0 && x < zone.x1).sort((a, b) => a - b)
  const rulings = inZone(options.rulings ?? [])
  const isRuling = (x: number) => rulings.some((r) => Math.abs(r - x) < 0.05)
  // Tableau à filets : les traits font les colonnes ; seules les dates de début
  // de ligne, souvent séparées par un simple pointillé, sont cherchées dans le texte.
  const ruled = !options.separators && rulings.length >= 2
  const separators = options.separators
    ? inZone(options.separators)
    : ruled
      ? [...rulings, ...leadingDateSeparators(rows, lineHeight, rulings)].sort((a, b) => a - b)
      : detectSeparators(rows, lineHeight, gapEm)

  const numberGap = Math.max(2.2 * gapEm, 0.8) * lineHeight
  const columnOf = (limits: number[], x: number) => {
    let col = 0
    while (col < limits.length && x > limits[col]) col++
    return col
  }
  const build = (limits: number[]) =>
    rows.map((row) => {
      const cells: string[][] = Array.from({ length: limits.length + 1 }, () => [])
      // Unités insécables : un nombre en plusieurs mots (« 1 234,56 ») est placé
      // d'un bloc, une séparation qui le frôle ne doit pas envoyer ses milliers
      // dans la colonne voisine.
      const atoms: { from: number; to: number }[] = []
      for (let index = 0; index < row.words.length; ) {
        let end = index
        while (end + 1 < row.words.length && isNumberGroup(row.words[end], row.words[end + 1], numberGap)) end++
        atoms.push({ from: index, to: end })
        index = end + 1
      }
      const text = (atom: { from: number; to: number }) =>
        row.words.slice(atom.from, atom.to + 1).map((w) => w.text).join(' ')
      for (let i = 0; i < atoms.length; ) {
        // Suite de mots séparés par une simple espace
        let j = i
        while (j + 1 < atoms.length && row.words[atoms[j + 1].from].x0 - row.words[atoms[j].to].x1 < gapEm * lineHeight) j++
        const phrase = atoms.slice(i, j + 1)
        const hasAmount = phrase.some((atom) => {
          const value = parseCell(text(atom))
          return value.kind === 'number' && value.decimals > 0
        })
        // Tableau à filets : un texte sans montant qui déborde par-dessus un trait
        // (« Solde au 30.09.26 » calé à droite) ne franchit pas ce trait, au lieu
        // de laisser un bout de phrase dans la colonne des montants.
        const start = columnOf(limits, row.words[phrase[0].from].x0 + 0.1)
        // Les dates de début de ligne, elles, ont chacune leur colonne
        const startsWithDate = DATE_TOKEN.test(row.words[phrase[0].from].text)
        for (const atom of phrase) {
          let col = columnOf(limits, (row.words[atom.from].x0 + row.words[atom.to].x1) / 2)
          if (rulings.length && !hasAmount && !startsWithDate) {
            for (let k = start; k < col; k++) {
              if (isRuling(limits[k])) {
                col = k
                break
              }
            }
          }
          cells[col].push(text(atom))
        }
        i = j + 1
      }
      return cells.map((parts) => parts.join(' '))
    })

  let grid = build(separators)
  if (ruled) {
    // Bord extérieur du tableau, colonne de cases à cocher : une colonne d'extrémité
    // entièrement vide n'apporte rien.
    const empty = (c: number) => grid.every((row) => !row[c].trim())
    while (separators.length && empty(separators.length)) {
      separators.pop()
      grid = build(separators)
    }
    while (separators.length && empty(0)) {
      separators.shift()
      grid = build(separators)
    }
  }
  if (!options.separators && !ruled) {
    // Colonne de texte presque vide collée à une colonne de texte : ce n'est pas
    // une colonne mais quelques lignes décalées (« Solde au 30.09.26 » d'un
    // relevé). Une colonne de montants peu remplie, elle, est conservée.
    for (let c = separators.length; c >= 1 && rows.length >= 8; c--) {
      const cells = grid.map((row) => row[c]).filter((cell) => cell.trim())
      const left = grid.map((row) => row[c - 1]).filter((cell) => cell.trim())
      const isText = (cell: string) => parseCell(cell).kind === 'text'
      const sparse = cells.length > 0 && cells.length <= Math.max(3, rows.length * 0.15)
      if (sparse && cells.every(isText) && left.filter(isText).length > left.length * 0.6) {
        separators.splice(c - 1, 1)
        grid = build(separators)
      }
    }
  }

  if (options.mergeContinuations) grid = mergeContinuationRows(grid)
  return { rows: grid, separators, rulings: separators.filter(isRuling), wordCount: inside.length }
}

/**
 * Ligne de suite : première colonne vide et aucune valeur chiffrée. Son texte
 * est ajouté aux cellules correspondantes de la ligne précédente.
 */
function mergeContinuationRows(rows: string[][]): string[][] {
  const out: string[][] = []
  for (const row of rows) {
    const prev = out[out.length - 1]
    const filled = row.filter((c) => c.trim())
    // Jamais vers la première ligne (en-tête) ; uniquement du texte placé sous du
    // texte ; au moindre soupçon de montant, même mal lu (« 1 2O0,00 »), la ligne
    // est conservée telle quelle.
    const isContinuation =
      !!prev && out.length > 1 && row.length > 1 && !row[0].trim() && filled.length > 0 &&
      row.every((c, i) => {
        if (!c.trim()) return true
        if (parseCell(c).kind !== 'text' || /\d[.,]\d{2}(?!\d)/.test(c)) return false
        const above = prev[i]?.trim()
        return !!above && parseCell(above).kind === 'text'
      })
    if (isContinuation) {
      row.forEach((c, i) => {
        if (c.trim()) prev[i] = prev[i].trim() ? `${prev[i]} ${c}` : c
      })
    } else {
      out.push([...row])
    }
  }
  return out
}

// ───────────────────────── Typage des cellules ─────────────────────────

export type CellValue =
  | { kind: 'text'; text: string }
  | { kind: 'number'; value: number; decimals: number; percent: boolean }
  | { kind: 'date'; serial: number; text: string }

/** Numéro de série Excel (jours depuis le 30/12/1899) d'une date valide, sinon null. */
function excelSerial(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return null
  const ms = Date.UTC(year, month - 1, day)
  const d = new Date(ms)
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return Math.round((ms - Date.UTC(1899, 11, 30)) / 86400000)
}

/**
 * Interprète le texte d'une cellule : date (JJ/MM/AAAA), nombre au format
 * français (« 1 234,56 », « 1.234,56 », « 12,50- », « (12,50) », « 5 % ») ou
 * anglo-saxon non ambigu (« 1,234.56 »). Dans le doute (« 1.234 », code avec
 * zéros en tête, identifiant long), le texte est conservé tel quel : une
 * conversion fausse et silencieuse serait pire qu'une cellule restée en texte.
 */
export function parseCell(raw: string): CellValue {
  const text = raw.trim()
  const asText: CellValue = { kind: 'text', text }
  if (!text || !/\d/.test(text)) return asText

  // Année sur 2 chiffres : seulement avec des « / » (« 24-03-12 » ou « 01.02.03 »
  // sont trop souvent des références) ; siècle choisi par fenêtre glissante.
  let m = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})$/.exec(text)
  if (m && (m[4].length === 4 || m[2] === '/')) {
    let year = Number(m[4])
    if (m[4].length === 2) {
      year += 2000
      if (year > new Date().getFullYear() + 10) year -= 100
    }
    const serial = excelSerial(year, Number(m[3]), Number(m[1]))
    return serial !== null ? { kind: 'date', serial, text } : asText
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (m) {
    const serial = excelSerial(Number(m[1]), Number(m[2]), Number(m[3]))
    return serial !== null ? { kind: 'date', serial, text } : asText
  }

  let s = text.replace(/[   ]/g, ' ').replace(/[−–—]/g, '-')
  let negative = false
  let percent = false
  /** Négatif noté « (12,50) » ou « 12,50- » : n'est admis que pour un vrai montant. */
  let accountingSign = false
  let trailingMinus = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    accountingSign = true
    s = s.slice(1, -1).trim()
    // « (-12,50) » : double signe, indécidable
    if (/^[-+]|-$/.test(s)) return asText
  }
  s = s.replace(/\s*(€|EUR)$/i, '').replace(/^€\s*/, '')
  if (s.endsWith('%')) {
    percent = true
    s = s.slice(0, -1).trim()
  }
  if (/^[-+]/.test(s)) {
    if (s[0] === '-') negative = !negative
    s = s.slice(1).trim()
  } else if (s.endsWith('-')) {
    negative = !negative
    accountingSign = true
    trailingMinus = true
    s = s.slice(0, -1).trim()
  }

  let integer: string
  let fraction = ''
  if (/^\d+$/.test(s)) {
    // Code ou identifiant : zéros en tête, ou trop long pour un affichage numérique
    if ((s.length > 1 && s[0] === '0') || s.length > 11) return asText
    integer = s
  } else if ((m = /^(\d+),(\d+)$/.exec(s))) {
    integer = m[1]
    fraction = m[2]
  } else if ((m = /^(\d{1,3}(?: \d{3})+)(?:[,.](\d+))?$/.exec(s))) {
    integer = m[1].replace(/ /g, '')
    fraction = m[2] ?? ''
  } else if ((m = /^(\d{1,3}(?:\.\d{3})+),(\d+)$/.exec(s))) {
    integer = m[1].replace(/\./g, '')
    fraction = m[2]
  } else if ((m = /^(\d{1,3}(?:\.\d{3}){2,})$/.exec(s))) {
    integer = m[1].replace(/\./g, '')
  } else if ((m = /^(\d{1,3}(?:,\d{3})+)\.(\d+)$/.exec(s))) {
    integer = m[1].replace(/,/g, '')
    fraction = m[2]
  } else if ((m = /^(\d+)\.(\d+)$/.exec(s))) {
    // « 1.234 » : milliers ou décimales ? Indécidable, on ne convertit pas.
    if (m[1].length <= 3 && m[2].length === 3) return asText
    integer = m[1]
    fraction = m[2]
  } else {
    return asText
  }
  if (integer.length > 15) return asText
  // Zéro en tête (« 0 800 123 456 », « 001 234 ») : numéro ou code, pas un montant
  if (integer.length > 1 && integer[0] === '0') return asText
  // « (1) » est un renvoi de note, « 2024- » une référence : pas des négatifs
  if (accountingSign && !fraction && (trailingMinus || integer.length < 3)) return asText

  // Pourcentage : divisé par 100 dans l'écriture décimale, sans erreur d'arrondi
  let value = Number(`${integer}.${fraction || '0'}${percent ? 'e-2' : ''}`)
  if (!Number.isFinite(value)) return asText
  if (negative) value = -value
  return { kind: 'number', value, decimals: fraction.length, percent }
}

export interface TypeOptions {
  /** Année à appliquer aux dates écrites sans année (« 05.10 », « 05/10 ») ; vide = laissées en texte. */
  year?: number | null
}

/** Cellule typée ; `shortDate` : date sans année reconnue dans une colonne de dates. */
export type TypedCell = CellValue & { shortDate?: boolean }

const SHORT_DATE = /^(\d{2})\.(\d{2})$|^(\d{1,2})\/(\d{1,2})$/

function shortDateParts(text: string): { day: number; month: number } | null {
  const m = SHORT_DATE.exec(text.trim())
  if (!m) return null
  const day = Number(m[1] ?? m[3])
  const month = Number(m[2] ?? m[4])
  return day >= 1 && day <= 31 && month >= 1 && month <= 12 ? { day, month } : null
}

/**
 * Type toutes les cellules d'une grille. Une colonne où la plupart des valeurs
 * ont la forme « JJ.MM » ou « JJ/MM » est une colonne de dates sans année (cas
 * des relevés bancaires) : ses valeurs ne sont surtout pas converties en nombres
 * (« 05.10 » deviendrait 5,1). Elles restent en texte, ou deviennent de vraies
 * dates si une année est fournie.
 */
export function typeGrid(rows: string[][], options: TypeOptions = {}): TypedCell[][] {
  const columns = Math.max(0, ...rows.map((r) => r.length))
  const dateColumn: boolean[] = []
  for (let c = 0; c < columns; c++) {
    let filled = 0
    let short = 0
    for (const row of rows) {
      const cell = row[c]?.trim()
      if (!cell) continue
      filled++
      if (shortDateParts(cell)) short++
    }
    dateColumn[c] = short >= 3 && short / filled >= 0.6
  }
  return rows.map((row) =>
    row.map((cell, c): TypedCell => {
      const parts = dateColumn[c] ? shortDateParts(cell) : null
      if (!parts) return parseCell(cell)
      const text = cell.trim()
      const serial = options.year ? excelSerial(options.year, parts.month, parts.day) : null
      return serial !== null ? { kind: 'date', serial, text, shortDate: true } : { kind: 'text', text, shortDate: true }
    })
  )
}

/**
 * Cellules à vérifier : texte non convertible dans une colonne majoritairement
 * chiffrée ou datée (typiquement un « O » lu à la place d'un « 0 » par l'OCR).
 * La première ligne, souvent un en-tête, n'est signalée que si elle contient un
 * chiffre.
 */
export function findSuspectCells(rows: string[][], typed: TypedCell[][] = typeGrid(rows)): boolean[][] {
  const flags = rows.map((row) => row.map(() => false))
  const columns = Math.max(0, ...rows.map((r) => r.length))
  const recognised = (r: number, c: number) => {
    const cell = typed[r]?.[c]
    return !!cell && (cell.kind !== 'text' || !!cell.shortDate)
  }
  for (let c = 0; c < columns; c++) {
    let filled = 0
    let ok = 0
    for (let r = 1; r < rows.length; r++) {
      if (!rows[r][c]?.trim()) continue
      filled++
      if (recognised(r, c)) ok++
    }
    if (ok < 2 || ok / filled < 0.6) continue
    for (let r = 0; r < rows.length; r++) {
      const cell = rows[r][c]?.trim()
      if (!cell || recognised(r, c)) continue
      // Première ligne : un en-tête n'a pas de chiffre, une valeur mal lue en a
      if (r > 0 || /\d/.test(cell)) flags[r][c] = true
    }
  }
  return flags
}

/** Date Excel (numéro de série) au format JJ/MM/AAAA. */
function formatSerial(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

/**
 * Texte tabulé à coller dans Excel. Les nombres sont écrits avec une virgule
 * décimale ; un texte qui commence comme une formule est neutralisé (le
 * contenu d'un PDF reçu d'un tiers n'est pas de confiance).
 */
export function toTsv(rows: string[][], convert: boolean, options: TypeOptions = {}): string {
  const typed = typeGrid(rows, options)
  return rows
    .map((row, r) =>
      row
        .map((cell, c) => {
          const clean = cell.replace(/[\t\r\n]+/g, ' ').trim()
          const value = typed[r][c]
          if (convert && value.kind === 'number' && !value.percent) {
            return String(value.value).replace('.', ',')
          }
          if (convert && value.kind === 'date' && value.shortDate) return formatSerial(value.serial)
          let out = clean
          if (/^[=@]/.test(out) || (/^[+-]/.test(out) && value.kind === 'text')) out = ` ${out}`
          // Un guillemet ouvrirait un champ multi-lignes au collage dans Excel
          return out.includes('"') ? `"${out.replace(/"/g, '""')}"` : out
        })
        .join('\t')
    )
    .join('\r\n')
}
