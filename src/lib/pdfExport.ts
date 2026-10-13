import fontkit from '@pdf-lib/fontkit'
import type { PDFDocument, PDFFont } from 'pdf-lib'
import { FONTS, variantOf, type FontFamily } from './fonts'

/**
 * Chargeur de polices avec cache : les polices standard PDF sont référencées,
 * les TTF locales sont embarquées en sous-ensemble (seuls les glyphes utilisés).
 */
export function makeFontLoader(doc: PDFDocument) {
  doc.registerFontkit(fontkit)
  const cache = new Map<string, Promise<PDFFont>>()
  return (family: FontFamily, bold: boolean, italic: boolean): Promise<PDFFont> => {
    const def = FONTS[family]
    const variant = variantOf(bold && def.hasBold, italic && def.hasItalic)
    const key = `${family}:${variant}`
    let font = cache.get(key)
    if (!font) {
      font = def.standard
        ? doc.embedFont(def.standard[variant])
        : fetch(def.files![variant] ?? def.files!.regular!)
            .then((r) => r.arrayBuffer())
            .then((bytes) => doc.embedFont(bytes, { subset: true }))
      cache.set(key, font)
    }
    return font
  }
}

/** Découpe un texte en lignes selon la largeur de la zone (même logique de wrap que Konva : mots entiers). */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/ +/)
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
        line = candidate
      } else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

/** Déclenche le téléchargement d'un fichier côté navigateur. */
export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/pdf') {
  const blob = new Blob([bytes as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // Laisse le temps au navigateur de démarrer le téléchargement
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
