import type { FontFamily } from '../../lib/fonts'

/**
 * Modèle de document du Créateur.
 * Toutes les coordonnées sont en points PDF (1/72 de pouce), origine en HAUT
 * à gauche (convention écran). La conversion vers l'origine bas-gauche du PDF
 * se fait uniquement à l'export.
 */

export interface BaseElement {
  id: string
  x: number
  y: number
  /** Rotation horaire en degrés, autour du coin haut-gauche (convention Konva). */
  rotation: number
}

export interface TextElement extends BaseElement {
  type: 'text'
  text: string
  width: number
  fontFamily: FontFamily
  fontSize: number
  color: string
  align: 'left' | 'center' | 'right'
  bold: boolean
  italic: boolean
}

export interface ImageElement extends BaseElement {
  type: 'image'
  width: number
  height: number
  /** Data URL (png/jpeg) — conservée telle quelle en IndexedDB. */
  dataUrl: string
}

export interface ShapeElement extends BaseElement {
  type: 'rect' | 'ellipse'
  width: number
  height: number
  fill: string
  stroke: string
  strokeWidth: number
}

/** Ligne/flèche : segment horizontal de longueur `length`, orienté par `rotation`. */
export interface LineElement extends BaseElement {
  type: 'line' | 'arrow'
  length: number
  stroke: string
  strokeWidth: number
}

export type PdfElement = TextElement | ImageElement | ShapeElement | LineElement

export interface PageData {
  id: string
  width: number
  height: number
  /** Couleur de fond de la page (hex). Blanc par défaut. */
  backgroundColor?: string
  elements: PdfElement[]
}

/** Filigrane appliqué à toutes les pages du document (aperçu + export). */
export interface Watermark {
  text: string
  fontSize: number
  color: string
  /** 0..1 */
  opacity: number
  diagonal: boolean
}

export type Orientation = 'portrait' | 'landscape'

export const PAGE_FORMATS = {
  A4: { label: 'A4', width: 595.28, height: 841.89 },
  Letter: { label: 'Letter', width: 612, height: 792 },
} as const

export type PageFormatId = keyof typeof PAGE_FORMATS | 'custom'

export function pageSize(
  format: PageFormatId,
  orientation: Orientation,
  custom?: { width: number; height: number }
): { width: number; height: number } {
  const base =
    format === 'custom'
      ? (custom ?? { width: 595.28, height: 841.89 })
      : PAGE_FORMATS[format]
  return orientation === 'portrait'
    ? { width: base.width, height: base.height }
    : { width: base.height, height: base.width }
}

export function newId(): string {
  // crypto.randomUUID n'existe qu'en contexte sécurisé (HTTPS/localhost) :
  // fallback pour l'accès via IP locale (Tailscale, LAN…)
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
