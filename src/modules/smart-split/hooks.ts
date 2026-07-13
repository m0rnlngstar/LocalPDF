/**
 * Point d'extension pour la vérification des coupures par LLM (ex. Gemma).
 *
 * NON IMPLÉMENTÉ à ce stade — prévu par l'architecture : le pipeline appelle
 * `verifySplitBoundary` sur chaque coupure proposée SI un vérificateur est
 * branché ici. Pour l'activer plus tard, il suffira de remplacer `null` par
 * une implémentation (appel à un modèle local WebGPU/WASM, par exemple) sans
 * toucher au reste du code.
 */

export interface BoundaryPageContext {
  /** Index 0-based de la page dans le document source. */
  index: number
  /** Texte OCR de la page. */
  text: string
  /** Miniature (data URL) pour un éventuel modèle multimodal. */
  thumb: string
}

export type VerifySplitBoundary = (
  pageBefore: BoundaryPageContext,
  pageAfter: BoundaryPageContext
) => Promise<boolean>

/** Brancher ici le vérificateur LLM. `null` = vérification désactivée. */
export const verifySplitBoundary: VerifySplitBoundary | null = null
