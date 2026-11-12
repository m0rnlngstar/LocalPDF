import JSZip from 'jszip'

/**
 * Écriture d'un classeur Excel (.xlsx) minimal, sans dépendance supplémentaire :
 * un .xlsx est une archive zip de fichiers XML, jszip est déjà embarqué.
 * Les textes sont écrits en chaînes littérales : un contenu commençant par
 * « = » reste du texte, jamais une formule.
 */

export type XlsxStyle = 'general' | 'amount' | 'date' | 'percent' | 'warn'

export type XlsxCell = null | undefined | string | number | { v: string | number; s?: XlsxStyle }

export interface XlsxSheet {
  name: string
  rows: XlsxCell[][]
}

const STYLE_INDEX: Record<XlsxStyle, number> = { general: 0, amount: 1, date: 2, percent: 3, warn: 4 }

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

function escapeXml(text: string): string {
  return text
    // Caractères interdits en XML 1.0 (contrôles, substituts isolés)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    // « _x0041_ » serait décodé par Excel comme un caractère
    .replace(/_x(?=[0-9A-Fa-f]{4}_)/g, '_x005F_x')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function columnName(index: number): string {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  }
  return name
}

/** Noms de feuilles valides pour Excel : 31 caractères, sans []:*?/\ et uniques. */
function sheetNames(sheets: XlsxSheet[]): string[] {
  const used = new Set<string>()
  return sheets.map((sheet, index) => {
    // Ni espace ni apostrophe en début ou en fin, y compris après troncature
    const strip = (name: string) => name.replace(/^[\s']+|[\s']+$/g, '')
    const base = strip(strip(sheet.name.replace(/[[\]:*?/\\]/g, ' ')).slice(0, 31)) || `Feuille ${index + 1}`
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`
      name = strip(base.slice(0, 31 - suffix.length)) + suffix
    }
    used.add(name.toLowerCase())
    return name
  })
}

function sheetXml(sheet: XlsxSheet): string {
  const widths: number[] = []
  const rowsXml = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          if (cell === null || cell === undefined || cell === '') return ''
          const raw = typeof cell === 'object' ? cell.v : cell
          // Excel refuse une cellule de plus de 32 767 caractères
          const value = typeof raw === 'number' ? raw : String(raw).slice(0, 32767)
          const style = typeof cell === 'object' && cell.s ? STYLE_INDEX[cell.s] : 0
          const ref = `${columnName(c)}${r + 1}`
          const s = style ? ` s="${style}"` : ''
          const length = typeof value === 'number' ? 12 : value.length
          widths[c] = Math.max(widths[c] ?? 0, length)
          if (typeof value === 'number') {
            return Number.isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : ''
          }
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
        })
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')
  const cols = widths.length
    ? `<cols>${Array.from(widths, (w, c) => {
        const width = Math.min(60, Math.max(8, (w ?? 0) + 2))
        return `<col min="${c + 1}" max="${c + 1}" width="${width}" customWidth="1"/>`
      }).join('')}</cols>`
    : ''
  return (
    XML_HEAD +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `${cols}<sheetData>${rowsXml}</sheetData></worksheet>`
  )
}

const STYLES_XML =
  XML_HEAD +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFD966"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

/** Construit le classeur et retourne ses octets. */
export async function buildXlsx(input: XlsxSheet[]): Promise<Uint8Array> {
  // Un classeur sans feuille est illisible
  const sheets = input.length ? input : [{ name: 'Feuille 1', rows: [] }]
  const names = sheetNames(sheets)
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    XML_HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join('') +
      '</Types>'
  )
  zip.file(
    '_rels/.rels',
    XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'
  )
  zip.file(
    'xl/workbook.xml',
    XML_HEAD +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets>${names
        .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets>` +
      '</workbook>'
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
        )
        .join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>'
  )
  zip.file('xl/styles.xml', STYLES_XML)
  sheets.forEach((sheet, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet)))
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
