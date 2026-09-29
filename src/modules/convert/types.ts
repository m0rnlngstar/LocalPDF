/** Modèle de document du Convertisseur : une liste ordonnée de fichiers source. */

/** Une page déjà rendue en image, prête à être posée sur une page PDF de même taille. */
export interface RenderedPage {
  /** Image JPEG de la page (Blob : pas de data URL géante en mémoire ni dans IndexedDB). */
  blob: Blob
  /** Miniature JPEG légère (data URL) pour les cartes et l'aperçu. */
  thumb: string
  /** Dimensions de la page en points PDF (1/72"). */
  width: number
  height: number
}

export type ConvertStatus = 'converting' | 'ready' | 'error'

export interface ConvertItem {
  id: string
  name: string
  /** 'pdf' : octets copiés tels quels. 'pages' : images rendues (une par page finale). */
  kind: 'pdf' | 'pages'
  status: ConvertStatus
  error?: string
  bytes?: ArrayBuffer
  pages?: RenderedPage[]
  pageCount: number
  /** Miniature de la première page (data URL légère). */
  thumb?: string
  /** true si les pages proviennent d'une image/photo source (candidates à l'OCR). */
  isImage?: boolean
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
