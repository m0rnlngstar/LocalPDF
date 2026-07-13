import {
  BlendMode,
  LineCapStyle,
  PDFDocument,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import { hexToRgb01 } from '../../lib/fonts'
import { makeFontLoader, wrapText } from '../create/exportPdf'
import { displaySize, totalRotation, type EditAnnotation, type EditPage } from './types'

/**
 * Export du document de travail.
 *
 * Pour chaque page :
 * - page PDF sans rotation utilisateur ni annotation → copie directe (préserve
 *   liens et métadonnées) ;
 * - sinon → le contenu source est EMBARQUÉ en vectoriel (embedPage) puis
 *   dessiné avec la rotation d'affichage, et les annotations sont dessinées
 *   par-dessus dans le repère d'affichage. Aucune rastérisation.
 *
 * Conversion de repère : les annotations sont stockées en coordonnées
 * d'affichage (origine haut-gauche). Sur la page exportée (dimensions
 * d'affichage W'×H', origine bas-gauche), un point (x', y') devient
 * (x', H' − y').
 */

/**
 * Dessine un contenu embarqué (page PDF ou image) de dimensions natives w×h
 * sur une page de dimensions d'affichage W'×H', tourné de `rot` degrés
 * (sens horaire à l'écran). Retourne position + rotation pdf-lib.
 */
function placementFor(rot: number, W2: number, H2: number) {
  switch (((rot % 360) + 360) % 360) {
    case 90:
      return { x: 0, y: H2, rotate: degrees(-90) }
    case 180:
      return { x: W2, y: H2, rotate: degrees(180) }
    case 270:
      return { x: W2, y: 0, rotate: degrees(90) }
    default:
      return { x: 0, y: 0, rotate: degrees(0) }
  }
}

async function drawAnnotations(
  page: PDFPage,
  H2: number,
  annotations: EditAnnotation[],
  getFont: () => Promise<PDFFont>
) {
  for (const ann of annotations) {
    switch (ann.type) {
      case 'highlight': {
        const c = hexToRgb01(ann.color)
        page.drawRectangle({
          x: ann.x,
          y: H2 - ann.y - ann.height,
          width: ann.width,
          height: ann.height,
          color: rgb(c.r, c.g, c.b),
          opacity: 0.45,
          blendMode: BlendMode.Multiply,
        })
        break
      }
      case 'rect':
      case 'ellipse': {
        const c = hexToRgb01(ann.stroke)
        if (ann.type === 'rect') {
          page.drawRectangle({
            x: ann.x,
            y: H2 - ann.y - ann.height,
            width: ann.width,
            height: ann.height,
            borderColor: rgb(c.r, c.g, c.b),
            borderWidth: ann.strokeWidth,
          })
        } else {
          page.drawEllipse({
            x: ann.x + ann.width / 2,
            y: H2 - (ann.y + ann.height / 2),
            xScale: ann.width / 2,
            yScale: ann.height / 2,
            borderColor: rgb(c.r, c.g, c.b),
            borderWidth: ann.strokeWidth,
          })
        }
        break
      }
      case 'ink': {
        if (ann.points.length < 4) break
        const c = hexToRgb01(ann.stroke)
        const [x0, y0] = [ann.points[0] + ann.x, ann.points[1] + ann.y]
        let path = `M ${x0} ${y0}`
        for (let i = 2; i < ann.points.length; i += 2) {
          path += ` L ${ann.points[i] + ann.x} ${ann.points[i + 1] + ann.y}`
        }
        // drawSvgPath : coordonnées écran (y vers le bas) depuis l'origine donnée
        page.drawSvgPath(path, {
          x: 0,
          y: H2,
          borderColor: rgb(c.r, c.g, c.b),
          borderWidth: ann.strokeWidth,
          borderLineCap: LineCapStyle.Round,
        })
        break
      }
      case 'text': {
        const font = await getFont()
        const c = hexToRgb01(ann.color)
        const lines = wrapText(ann.text, font, ann.fontSize, ann.width)
        lines.forEach((line, i) => {
          page.drawText(line, {
            x: ann.x,
            y: H2 - (ann.y + ann.fontSize * 0.8 + i * ann.fontSize),
            size: ann.fontSize,
            font,
            color: rgb(c.r, c.g, c.b),
          })
        })
        break
      }
      case 'note': {
        const font = await getFont()
        const bg = hexToRgb01(ann.color)
        page.drawRectangle({
          x: ann.x,
          y: H2 - ann.y - ann.height,
          width: ann.width,
          height: ann.height,
          color: rgb(bg.r, bg.g, bg.b),
          borderColor: rgb(bg.r * 0.75, bg.g * 0.75, bg.b * 0.5),
          borderWidth: 1,
        })
        const pad = 8
        const fontSize = 12
        const lines = wrapText(ann.text, font, fontSize, ann.width - pad * 2)
        const maxLines = Math.floor((ann.height - pad * 2) / fontSize)
        lines.slice(0, maxLines).forEach((line, i) => {
          page.drawText(line, {
            x: ann.x + pad,
            y: H2 - (ann.y + pad + fontSize * 0.8 + i * fontSize),
            size: fontSize,
            font,
            color: rgb(0.2, 0.2, 0.2),
          })
        })
        break
      }
      case 'stamp': {
        const font = await getFont()
        const c = hexToRgb01(ann.color)
        const padX = 10
        const padY = 6
        const textWidth = font.widthOfTextAtSize(ann.text, ann.fontSize)
        const h = ann.fontSize + padY * 2
        page.drawRectangle({
          x: ann.x,
          y: H2 - ann.y - h,
          width: textWidth + padX * 2,
          height: h,
          borderColor: rgb(c.r, c.g, c.b),
          borderWidth: 2,
        })
        page.drawText(ann.text, {
          x: ann.x + padX,
          y: H2 - (ann.y + padY + ann.fontSize * 0.8),
          size: ann.fontSize,
          font,
          color: rgb(c.r, c.g, c.b),
        })
        break
      }
    }
  }
}

export async function buildEditedPdf(
  pages: EditPage[],
  docs: Record<string, ArrayBuffer>
): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const loadFont = makeFontLoader(out)
  const getFont = () => loadFont('Helvetica', false, false)

  // Documents sources pdf-lib, chargés une seule fois chacun
  const srcCache = new Map<string, Promise<PDFDocument>>()
  function getSrc(docId: string): Promise<PDFDocument> {
    let p = srcCache.get(docId)
    if (!p) {
      p = PDFDocument.load(docs[docId])
      srcCache.set(docId, p)
    }
    return p
  }

  for (const pageData of pages) {
    const { width: W2, height: H2 } = displaySize(pageData)
    const src = pageData.source

    if (src.kind === 'pdf') {
      const srcDoc = await getSrc(src.docId)
      const [copied] = await out.copyPages(srcDoc, [src.pageIndex])

      // Cas simple : rien à dessiner, pas de rotation ajoutée → copie fidèle
      if (pageData.rotation === 0 && pageData.annotations.length === 0) {
        out.addPage(copied)
        continue
      }

      // Cas général : contenu embarqué en vectoriel + rotation + annotations.
      // embedPage ignore le /Rotate de la page : on applique la rotation TOTALE.
      const embedded = await out.embedPage(copied)
      const page = out.addPage([W2, H2])
      page.drawPage(embedded, {
        ...placementFor(totalRotation(pageData), W2, H2),
        width: src.width,
        height: src.height,
      })
      await drawAnnotations(page, H2, pageData.annotations, getFont)
      continue
    }

    const page = out.addPage([W2, H2])
    if (src.kind === 'image') {
      const bytes = await fetch(src.dataUrl).then((r) => r.arrayBuffer())
      const image = src.dataUrl.startsWith('data:image/png')
        ? await out.embedPng(bytes)
        : await out.embedJpg(bytes)
      page.drawImage(image, {
        ...placementFor(totalRotation(pageData), W2, H2),
        width: src.width,
        height: src.height,
      })
    }
    await drawAnnotations(page, H2, pageData.annotations, getFont)
  }

  return out.save()
}
