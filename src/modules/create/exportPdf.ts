import { PDFDocument, degrees, rgb, type PDFDocument as PDFDoc, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { FONTS, hexToRgb01, variantOf, type FontFamily } from '../../lib/fonts'
import type { LineElement, PageData, TextElement, Watermark } from './types'

/**
 * Chargeur de polices avec cache : les polices standard PDF sont référencées,
 * les TTF locales sont embarquées en sous-ensemble (seuls les glyphes utilisés).
 */
export function makeFontLoader(doc: PDFDoc) {
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

/**
 * Export du modèle interne vers un vrai PDF via pdf-lib.
 *
 * Conversion de repère : le modèle utilise l'origine HAUT-gauche avec rotation
 * horaire (convention Konva/écran) ; le PDF utilise l'origine BAS-gauche avec
 * rotation anti-horaire, appliquée autour du coin bas-gauche de l'objet dessiné.
 * Pour un objet (x, y, w, h, θ horaire autour du coin haut-gauche), le coin
 * bas-gauche à l'écran vaut (x − h·sinθ, y + h·cosθ) ; en PDF on dessine donc à
 * (x − h·sinθ, pageH − (y + h·cosθ)) avec rotate = −θ.
 */

function rad(deg: number): number {
  return (deg * Math.PI) / 180
}

function bottomLeftInPdf(
  pageH: number,
  x: number,
  y: number,
  h: number,
  rotationDeg: number
): { x: number; y: number } {
  const t = rad(rotationDeg)
  return {
    x: x - h * Math.sin(t),
    y: pageH - (y + h * Math.cos(t)),
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

function drawTextElement(page: PDFPage, pageH: number, el: TextElement, font: PDFFont) {
  const color = hexToRgb01(el.color)
  const lines = wrapText(el.text, font, el.fontSize, el.width)
  // Baseline de la première ligne ≈ ascent (~0.8 em pour les polices standard),
  // interligne = fontSize (lineHeight 1, comme l'aperçu Konva).
  const ascent = el.fontSize * 0.8
  lines.forEach((line, i) => {
    const lineWidth = font.widthOfTextAtSize(line, el.fontSize)
    const offsetX =
      el.align === 'center' ? (el.width - lineWidth) / 2
      : el.align === 'right' ? el.width - lineWidth
      : 0
    page.drawText(line, {
      x: el.x + offsetX,
      y: pageH - (el.y + ascent + i * el.fontSize),
      size: el.fontSize,
      font,
      color: rgb(color.r, color.g, color.b),
    })
  })
}

function drawLineElement(page: PDFPage, pageH: number, el: LineElement) {
  const t = rad(el.rotation)
  const p1 = { x: el.x, y: el.y }
  const p2 = { x: el.x + el.length * Math.cos(t), y: el.y + el.length * Math.sin(t) }
  const c = hexToRgb01(el.stroke)
  const color = rgb(c.r, c.g, c.b)

  page.drawLine({
    start: { x: p1.x, y: pageH - p1.y },
    end: { x: p2.x, y: pageH - p2.y },
    thickness: el.strokeWidth,
    color,
  })

  if (el.type === 'arrow') {
    // Tête de flèche : triangle plein au bout du segment (comme Konva.Arrow)
    const headLen = Math.max(10, el.strokeWidth * 4)
    const headHalf = headLen / 2
    const dx = Math.cos(t)
    const dy = Math.sin(t)
    const base = { x: p2.x - headLen * dx, y: p2.y - headLen * dy }
    const perp = { x: -dy, y: dx }
    const a = { x: base.x + headHalf * perp.x, y: base.y + headHalf * perp.y }
    const b = { x: base.x - headHalf * perp.x, y: base.y - headHalf * perp.y }
    // drawSvgPath interprète les coordonnées en repère écran (y vers le bas)
    // à partir de l'origine fournie : on passe le haut de page comme origine.
    page.drawSvgPath(
      `M ${p2.x} ${p2.y} L ${a.x} ${a.y} L ${b.x} ${b.y} Z`,
      { x: 0, y: pageH, color }
    )
  }
}

/**
 * Filigrane centré, éventuellement en diagonale (45° montant, comme l'aperçu).
 * On place le point de départ de la ligne de base pour que le CENTRE du texte
 * tombe au centre de la page, quelle que soit la rotation.
 */
function drawWatermark(page: PDFPage, w: number, h: number, wm: Watermark, font: PDFFont) {
  const theta = wm.diagonal ? Math.PI / 4 : 0
  const textWidth = font.widthOfTextAtSize(wm.text, wm.fontSize)
  const u = { x: Math.cos(theta), y: Math.sin(theta) } // direction de la ligne de base
  const v = { x: -Math.sin(theta), y: Math.cos(theta) } // perpendiculaire (vers le haut du texte)
  const capCenter = wm.fontSize * 0.35 // demi-hauteur optique des capitales
  const c = hexToRgb01(wm.color)
  page.drawText(wm.text, {
    x: w / 2 - (textWidth / 2) * u.x - capCenter * v.x,
    y: h / 2 - (textWidth / 2) * u.y - capCenter * v.y,
    size: wm.fontSize,
    font,
    color: rgb(c.r, c.g, c.b),
    opacity: wm.opacity,
    rotate: degrees(wm.diagonal ? 45 : 0),
  })
}

export async function buildPdf(pages: PageData[], watermark?: Watermark | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const loadFont = makeFontLoader(doc)
  const getFont = (el: TextElement) => loadFont(el.fontFamily, el.bold, el.italic)

  for (const pageData of pages) {
    const page = doc.addPage([pageData.width, pageData.height])
    const pageH = pageData.height

    // Fond de page (inutile de peindre du blanc sur du blanc)
    const bg = pageData.backgroundColor
    if (bg && bg.toLowerCase() !== '#ffffff') {
      const c = hexToRgb01(bg)
      page.drawRectangle({
        x: 0, y: 0,
        width: pageData.width, height: pageData.height,
        color: rgb(c.r, c.g, c.b),
      })
    }

    for (const el of pageData.elements) {
      switch (el.type) {
        case 'text': {
          drawTextElement(page, pageH, el, await getFont(el))
          break
        }
        case 'image': {
          const bytes = await fetch(el.dataUrl).then((r) => r.arrayBuffer())
          const image = el.dataUrl.startsWith('data:image/png')
            ? await doc.embedPng(bytes)
            : await doc.embedJpg(bytes)
          const bl = bottomLeftInPdf(pageH, el.x, el.y, el.height, el.rotation)
          page.drawImage(image, {
            x: bl.x,
            y: bl.y,
            width: el.width,
            height: el.height,
            rotate: degrees(-el.rotation),
          })
          break
        }
        case 'rect': {
          const bl = bottomLeftInPdf(pageH, el.x, el.y, el.height, el.rotation)
          const fill = hexToRgb01(el.fill)
          const stroke = hexToRgb01(el.stroke)
          page.drawRectangle({
            x: bl.x,
            y: bl.y,
            width: el.width,
            height: el.height,
            rotate: degrees(-el.rotation),
            color: rgb(fill.r, fill.g, fill.b),
            borderColor: rgb(stroke.r, stroke.g, stroke.b),
            borderWidth: el.strokeWidth,
          })
          break
        }
        case 'ellipse': {
          const fill = hexToRgb01(el.fill)
          const stroke = hexToRgb01(el.stroke)
          page.drawEllipse({
            x: el.x + el.width / 2,
            y: pageH - (el.y + el.height / 2),
            xScale: el.width / 2,
            yScale: el.height / 2,
            color: rgb(fill.r, fill.g, fill.b),
            borderColor: rgb(stroke.r, stroke.g, stroke.b),
            borderWidth: el.strokeWidth,
          })
          break
        }
        case 'line':
        case 'arrow':
          drawLineElement(page, pageH, el)
          break
      }
    }

    // Filigrane par-dessus le contenu, sur toutes les pages
    if (watermark?.text) {
      drawWatermark(page, pageData.width, pageH, watermark, await loadFont('Helvetica', false, false))
    }
  }

  return doc.save()
}

/** Déclenche le téléchargement d'un fichier côté navigateur. */
export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/pdf') {
  const blob = new Blob([bytes as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
