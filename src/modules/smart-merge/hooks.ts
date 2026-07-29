/**
 * Vérification de l'enchaînement par LLM local — réutilise le vérificateur de
 * frontières du Splitteur intelligent (voir smart-split/hooks.ts) : la
 * question posée au modèle est la même dans les deux sens, « la page/le
 * fichier B commence-t-il un nouveau document par rapport à A ? », que la
 * frontière évaluée sépare deux pages d'un même PDF (splitteur) ou
 * l'enchaînement entre deux fichiers proposé par la fusion intelligente.
 */

import type { BoundaryPageContext, BoundaryVerdict, VerifySplitBoundary } from '../smart-split/hooks'

export { createLlmVerifier } from '../smart-split/hooks'
export type { BoundaryPageContext, BoundaryVerdict, VerifySplitBoundary }

/** Vérificateur actif (configuré par le module UI). `null` = désactivé. */
let activeVerifier: VerifySplitBoundary | null = null

export function getMergeVerifier(): VerifySplitBoundary | null {
  return activeVerifier
}

export function setMergeVerifier(v: VerifySplitBoundary | null) {
  activeVerifier = v
}
