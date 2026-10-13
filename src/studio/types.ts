import type { FontFamily } from '../lib/fonts'

/**
 * Modèle de l'espace de travail (Studio).
 *
 * Un document est une LISTE DE PAGES hétérogènes : pages issues d'un ou
 * plusieurs PDF importés, pages vierges, ou images (photos, HEIC, DOCX rendus…).
 * Les annotations et la couche OCR sont stockées dans le repère d'AFFICHAGE
 * de la page (points PDF, origine haut-gauche, rotation déjà appliquée) ;
 * la conversion vers le repère PDF se fait uniquement à l'export.
 */

export type UserRotation = 0 | 90 | 180 | 270

export type PageSource =
  | {
      kind: 'pdf'
      /** Référence vers les octets du PDF dans le store (docs[docId]). */
      docId: string
      pageIndex: number
      /** Dimensions du contenu NON tourné (MediaBox). */
      width: number
      height: number
      /** Rotation propre de la page dans le PDF source (/Rotate). */
      inherentRotation: number
      /** PDF chiffré (mot de passe ou restrictions) : pdf-lib ne sait pas le copier, la page est aplatie à l'export. */
      encrypted?: boolean
      /** Mot de passe d'ouverture saisi par l'utilisateur (reste dans ce navigateur). */
      password?: string
    }
  | { kind: 'blank'; width: number; height: number; background?: string }
  | { kind: 'image'; dataUrl: string; width: number; height: number }

export interface BaseAnn {
  id: string
  x: number
  y: number
  /** Commentaire associé (surlignage, forme…) — affiché dans le panneau Commentaires. */
  comment?: string
  createdAt?: number
}

export interface HighlightAnn extends BaseAnn {
  type: 'highlight'
  width: number
  height: number
  color: string
  /** Rectangles par ligne (surlignage « texte ») relatifs à (x, y). Absent = rectangle plein. */
  rects?: { x: number; y: number; width: number; height: number }[]
  /** Texte surligné (si détecté) — utile dans la liste des commentaires. */
  quote?: string
}

export interface TextAnn extends BaseAnn {
  type: 'text'
  width: number
  text: string
  fontSize: number
  color: string
  fontFamily?: FontFamily
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  /** Fond opaque (texte de correction posé sur un ancien texte). */
  background?: string
}

/** Note / commentaire épinglé. */
export interface NoteAnn extends BaseAnn {
  type: 'note'
  width: number
  height: number
  text: string
  color: string
}

export interface ShapeAnn extends BaseAnn {
  type: 'rect' | 'ellipse'
  width: number
  height: number
  stroke: string
  strokeWidth: number
  fill?: string
}

/** Masquage (caviardage visuel) : rectangle opaque. */
export interface RedactAnn extends BaseAnn {
  type: 'redact'
  width: number
  height: number
  color: string
}

/** Ligne / flèche : de (x, y) à (x + dx, y + dy). */
export interface LineAnn extends BaseAnn {
  type: 'line' | 'arrow'
  dx: number
  dy: number
  stroke: string
  strokeWidth: number
}

/** Tracé à main levée (signature) : points relatifs à (x, y). */
export interface InkAnn extends BaseAnn {
  type: 'ink'
  points: number[]
  stroke: string
  strokeWidth: number
}

/** Tampon : texte encadré (APPROUVÉ, REFUSÉ…). */
export interface StampAnn extends BaseAnn {
  type: 'stamp'
  text: string
  color: string
  fontSize: number
}

export interface ImageAnn extends BaseAnn {
  type: 'image'
  width: number
  height: number
  dataUrl: string
}

export type Annotation =
  | HighlightAnn | TextAnn | NoteAnn | ShapeAnn | RedactAnn | LineAnn
  | InkAnn | StampAnn | ImageAnn

export type AnnotationType = Annotation['type']

/** Mot reconnu par OCR, en points d'affichage. */
export interface OcrWordPt {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export interface StudioPage {
  id: string
  source: PageSource
  rotation: UserRotation
  annotations: Annotation[]
  /** Couche texte OCR (rend la page cherchable à l'export). */
  ocr?: { words: OcrWordPt[]; text: string }
}

export interface Watermark {
  text: string
  fontSize: number
  color: string
  /** 0..1 */
  opacity: number
  diagonal: boolean
}

/** Rotation totale à l'affichage (rotation source + rotation utilisateur). */
export function totalRotation(page: StudioPage): number {
  const inherent = page.source.kind === 'pdf' ? page.source.inherentRotation : 0
  return (((inherent + page.rotation) % 360) + 360) % 360
}

/** Dimensions de la page telle qu'affichée (après rotation). */
export function displaySize(page: StudioPage): { width: number; height: number } {
  const { width, height } = page.source
  return totalRotation(page) % 180 === 0 ? { width, height } : { width: height, height: width }
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export type Tool =
  | 'select' | 'text-select' | 'hand' | 'highlight' | 'edit-text' | 'text' | 'note'
  | 'rect' | 'ellipse' | 'line' | 'arrow' | 'ink' | 'stamp' | 'image' | 'redact'

export const PAGE_FORMATS = {
  A4: { label: 'A4', width: 595.28, height: 841.89 },
  A5: { label: 'A5', width: 419.53, height: 595.28 },
  Letter: { label: 'Letter', width: 612, height: 792 },
} as const

export type PageFormatId = keyof typeof PAGE_FORMATS

/** Libellé lisible d'une annotation (panneau Commentaires). */
export const ANN_LABELS: Record<AnnotationType, string> = {
  highlight: 'Surlignage',
  text: 'Texte',
  note: 'Commentaire',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  redact: 'Masquage',
  line: 'Ligne',
  arrow: 'Flèche',
  ink: 'Dessin',
  stamp: 'Tampon',
  image: 'Image',
}

/** Boîte englobante d'une annotation (repère d'affichage). */
export function annBounds(ann: Annotation): { x: number; y: number; width: number; height: number } {
  switch (ann.type) {
    case 'line':
    case 'arrow':
      return {
        x: Math.min(ann.x, ann.x + ann.dx),
        y: Math.min(ann.y, ann.y + ann.dy),
        width: Math.abs(ann.dx),
        height: Math.abs(ann.dy),
      }
    case 'ink': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (let i = 0; i < ann.points.length; i += 2) {
        x0 = Math.min(x0, ann.points[i]); x1 = Math.max(x1, ann.points[i])
        y0 = Math.min(y0, ann.points[i + 1]); y1 = Math.max(y1, ann.points[i + 1])
      }
      return { x: ann.x + x0, y: ann.y + y0, width: x1 - x0, height: y1 - y0 }
    }
    case 'text':
      return { x: ann.x, y: ann.y, width: ann.width, height: ann.fontSize * 1.2 }
    case 'stamp':
      return { x: ann.x, y: ann.y, width: ann.text.length * ann.fontSize * 0.7 + 16, height: ann.fontSize + 16 }
    default:
      return { x: ann.x, y: ann.y, width: ann.width, height: ann.height }
  }
}

/**
 * Applique une rotation de +90° (sens horaire) à une annotation, pour une
 * page dont la hauteur d'affichage AVANT rotation vaut H.
 * Un point (x, y) devient (H − y, x).
 */
export function rotateAnnotation90(ann: Annotation, H: number): Annotation {
  const P = (x: number, y: number) => ({ x: H - y, y: x })
  switch (ann.type) {
    case 'line':
    case 'arrow': {
      const a = P(ann.x, ann.y)
      const b = P(ann.x + ann.dx, ann.y + ann.dy)
      return { ...ann, x: a.x, y: a.y, dx: b.x - a.x, dy: b.y - a.y }
    }
    case 'ink': {
      const pts: number[] = []
      for (let i = 0; i < ann.points.length; i += 2) {
        const p = P(ann.x + ann.points[i], ann.y + ann.points[i + 1])
        pts.push(p.x, p.y)
      }
      return { ...ann, x: 0, y: 0, points: pts }
    }
    case 'text':
    case 'stamp': {
      const b = annBounds(ann)
      return { ...ann, x: H - (b.y + b.height), y: b.x }
    }
    case 'highlight': {
      const rects = ann.rects?.map((r) => ({ x: ann.height - (r.y + r.height), y: r.x, width: r.height, height: r.width }))
      return { ...ann, x: H - (ann.y + ann.height), y: ann.x, width: ann.height, height: ann.width, rects }
    }
    default:
      return { ...ann, x: H - (ann.y + ann.height), y: ann.x, width: ann.height, height: ann.width }
  }
}

export function rotateWords90(words: OcrWordPt[], H: number): OcrWordPt[] {
  return words.map((w) => ({ ...w, x: H - (w.y + w.height), y: w.x, width: w.height, height: w.width }))
}
