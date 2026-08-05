/** Modèle de document du Convertisseur : une liste ordonnée de fichiers source. */

/** Une page déjà rendue en image, prête à être posée sur une page PDF de même taille. */
export interface RenderedPage {
  /** Data URL PNG. */
  dataUrl: string
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
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
