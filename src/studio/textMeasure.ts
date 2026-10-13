import { CANVAS_FONTS, type FontFamily } from '../lib/fonts'
import { CALLOUT_PAD, type CalloutAnn } from './types'

/**
 * Mesure du texte à l'écran (canvas), avec la même règle de retour à la ligne
 * que l'export (mots entiers) : la hauteur d'une bulle et l'ajustement
 * automatique des zones de texte restent cohérents entre l'aperçu et le PDF.
 */

let ctx: CanvasRenderingContext2D | null = null

function context(): CanvasRenderingContext2D | null {
  ctx ??= document.createElement('canvas').getContext('2d')
  return ctx
}

export function cssFont(size: number, family: FontFamily = 'Helvetica', bold = false, italic = false): string {
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${CANVAS_FONTS[family]}`
}

export function measureWidth(text: string, font: string): number {
  const c = context()
  if (!c) return text.length * 6
  c.font = font
  return c.measureText(text).width
}

/** Découpe en lignes (mots entiers) pour une largeur donnée. */
export function wrapLines(text: string, font: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word
      if (!line || measureWidth(candidate, font) <= maxWidth) line = candidate
      else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

/** Largeur de la plus longue ligne (retours à la ligne saisis conservés). */
export function longestLine(text: string, font: string): number {
  return Math.max(0, ...text.split('\n').map((l) => measureWidth(l, font)))
}

/** Hauteur de la zone d'une bulle (texte + marges). */
export function calloutHeight(ann: CalloutAnn): number {
  const font = cssFont(ann.fontSize)
  const lines = wrapLines(ann.text || ' ', font, Math.max(10, ann.width - CALLOUT_PAD * 2)).length
  return lines * ann.fontSize * 1.15 + CALLOUT_PAD * 2
}

/**
 * Point d'attache de la flèche : point du cadre le plus proche de la cible.
 * Null si la cible est dans la zone (pas de flèche).
 */
export function calloutAnchor(
  box: { x: number; y: number; width: number; height: number },
  tx: number,
  ty: number
): { x: number; y: number } | null {
  const inside = tx > box.x && tx < box.x + box.width && ty > box.y && ty < box.y + box.height
  if (inside) return null
  return {
    x: Math.min(Math.max(tx, box.x), box.x + box.width),
    y: Math.min(Math.max(ty, box.y), box.y + box.height),
  }
}
