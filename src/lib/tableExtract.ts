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
}

export interface TableGrid {
  rows: string[][]
  /** Séparations effectivement utilisées (unités de page), triées. */
  separators: number[]
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
  for (const row of rows) row.words.sort((a, b) => a.x0 - b.x0)
  return rows
}

interface Segment {
  x0: number
  x1: number
}

/** Regroupe les mots d'une ligne séparés par une simple espace. */
function rowSegments(row: Row, maxGap: number): Segment[] {
  const segments: Segment[] = []
  let previous = ''
  for (const w of row.words) {
    const last = segments[segments.length - 1]
    // « 1 200,00 » : l'espace des milliers, large sur une couche OCR, ne doit
    // jamais être pris pour une séparation de colonnes.
    const thousands = /^[-+(]?\d{1,3}$/.test(previous) && /^\d{3}(?:[.,]\d+)?[-)%€]*$/.test(w.text)
    if (last && w.x0 - last.x1 < (thousands ? maxGap * 2.2 : maxGap)) last.x1 = Math.max(last.x1, w.x1)
    else segments.push({ x0: w.x0, x1: w.x1 })
    previous = w.text
  }
  return segments
}

/**
 * Séparations de colonnes : milieux des couloirs verticaux qu'aucun texte ne
 * traverse. Quelques lignes « traversantes » (titre, total sur toute la
 * largeur) sont tolérées quand le tableau est assez long ; en revanche un texte
 * isolé qui commence ou finit dans un couloir (colonne peu remplie, comme
 * « Crédit » sur un relevé) est bien conservé comme colonne.
 */
function detectSeparators(rows: Row[], lineHeight: number, gapEm: number): number[] {
  const segs = rows.map((row) => rowSegments(row, gapEm * lineHeight))
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
  const crossers = rows.length < 6 ? 0 : rows.length < 20 ? 1 : rows.length < 50 ? 2 : 3
  const minGap = Math.max(1, lineHeight * 0.25)
  const separators: number[] = []
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
    // part sont ignorés, les autres découpent le couloir.
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
      if (p.x1 - p.x0 >= minGap) separators.push((p.x0 + p.x1) / 2)
    }
    i = j
  }
  return separators.sort((x, y) => x - y)
}

/** Extrait la grille (lignes × colonnes) des mots situés dans `zone`. */
export function extractTable(words: TextBox[], zone: Rect, options: TableOptions = {}): TableGrid {
  const inside = words.filter((w) => {
    const cx = (w.x0 + w.x1) / 2
    const cy = (w.y0 + w.y1) / 2
    return cx >= zone.x0 && cx <= zone.x1 && cy >= zone.y0 && cy <= zone.y1
  })
  if (!inside.length) return { rows: [], separators: [], wordCount: 0 }

  const lineHeight = (median(inside.map((w) => w.y1 - w.y0)) || 10) * (options.tightBoxes ? 1.35 : 1)
  const skew = estimateSkew(inside, lineHeight)
  const rows = groupRows(inside, lineHeight, skew)

  const separators = options.separators
    ? [...options.separators].filter((x) => x > zone.x0 && x < zone.x1).sort((a, b) => a - b)
    : detectSeparators(rows, lineHeight, options.gapEm ?? 0.5)

  let grid = rows.map((row) => {
    const cells: string[][] = Array.from({ length: separators.length + 1 }, () => [])
    for (const w of row.words) {
      const cx = (w.x0 + w.x1) / 2
      let col = 0
      while (col < separators.length && cx > separators[col]) col++
      cells[col].push(w.text)
    }
    return cells.map((parts) => parts.join(' '))
  })

  if (options.mergeContinuations) grid = mergeContinuationRows(grid)
  return { rows: grid, separators, wordCount: inside.length }
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

/**
 * Cellules à vérifier : texte non convertible dans une colonne majoritairement
 * chiffrée (typiquement un « O » lu à la place d'un « 0 » par l'OCR). La
 * première ligne, souvent un en-tête, n'est pas signalée.
 */
export function findSuspectCells(rows: string[][]): boolean[][] {
  const flags = rows.map((row) => row.map(() => false))
  const columns = Math.max(0, ...rows.map((r) => r.length))
  for (let c = 0; c < columns; c++) {
    let filled = 0
    let typed = 0
    for (let r = 1; r < rows.length; r++) {
      const cell = rows[r][c]?.trim()
      if (!cell) continue
      filled++
      if (parseCell(cell).kind !== 'text') typed++
    }
    if (typed < 2 || typed / filled < 0.6) continue
    for (let r = 0; r < rows.length; r++) {
      const cell = rows[r][c]?.trim()
      if (!cell || parseCell(cell).kind !== 'text') continue
      // Première ligne : un en-tête n'a pas de chiffre, une valeur mal lue en a
      if (r > 0 || /\d/.test(cell)) flags[r][c] = true
    }
  }
  return flags
}

/**
 * Texte tabulé à coller dans Excel. Les nombres sont écrits avec une virgule
 * décimale ; un texte qui commence comme une formule est neutralisé (le
 * contenu d'un PDF reçu d'un tiers n'est pas de confiance).
 */
export function toTsv(rows: string[][], convert: boolean): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const clean = cell.replace(/[\t\r\n]+/g, ' ').trim()
          const value = parseCell(clean)
          if (convert && value.kind === 'number' && !value.percent) {
            return String(value.value).replace('.', ',')
          }
          let out = clean
          if (/^[=@]/.test(out) || (/^[+-]/.test(out) && value.kind === 'text')) out = ` ${out}`
          // Un guillemet ouvrirait un champ multi-lignes au collage dans Excel
          return out.includes('"') ? `"${out.replace(/"/g, '""')}"` : out
        })
        .join('\t')
    )
    .join('\r\n')
}
