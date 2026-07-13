/**
 * Modèle du module Éditeur/Annotateur.
 *
 * Un document de travail est une LISTE DE PAGES hétérogènes : pages issues d'un
 * ou plusieurs PDF importés, pages vierges, ou images converties en page.
 * Les annotations sont stockées dans le repère d'AFFICHAGE de la page
 * (origine haut-gauche, rotation utilisateur déjà appliquée) ; la conversion
 * vers le repère PDF se fait à l'export.
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
    }
  | { kind: 'blank'; width: number; height: number }
  | { kind: 'image'; dataUrl: string; width: number; height: number }

export interface BaseAnn {
  id: string
  x: number
  y: number
}

export interface HighlightAnn extends BaseAnn {
  type: 'highlight'
  width: number
  height: number
  color: string
}

export interface TextAnn extends BaseAnn {
  type: 'text'
  width: number
  text: string
  fontSize: number
  color: string
}

/** Note collante : taille fixe, fond jaune, texte. */
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
}

/** Tracé à main levée (signature) : points absolus [x0,y0,x1,y1,…]. */
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

export type EditAnnotation =
  | HighlightAnn | TextAnn | NoteAnn | ShapeAnn | InkAnn | StampAnn

export interface EditPage {
  id: string
  source: PageSource
  rotation: UserRotation
  annotations: EditAnnotation[]
}

/** Rotation totale à l'affichage (rotation source + rotation utilisateur). */
export function totalRotation(page: EditPage): number {
  const inherent = page.source.kind === 'pdf' ? page.source.inherentRotation : 0
  return (((inherent + page.rotation) % 360) + 360) % 360
}

/** Dimensions de la page telle qu'affichée (après rotation). */
export function displaySize(page: EditPage): { width: number; height: number } {
  const { width, height } = page.source
  return totalRotation(page) % 180 === 0 ? { width, height } : { width: height, height: width }
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export type EditTool =
  | 'select' | 'highlight' | 'text' | 'note'
  | 'rect' | 'ellipse' | 'ink' | 'stamp'
