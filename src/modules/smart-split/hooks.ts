/**
 * Vérification des coupures par LLM local (WebLLM / Gemma, voir lib/llm.ts).
 *
 * Le pipeline appelle le vérificateur retourné par `getSplitVerifier()` sur
 * chaque coupure proposée quand l'utilisateur a activé l'option. Le LLM reçoit
 * la fin du texte OCR de la page précédente et le début de la suivante, et
 * tranche : nouveau document (coupure confirmée) ou continuation (coupure
 * retirée).
 */

import { askLlm, emitLlmActivity, isLowTrustLlm, isMultimodalLlm } from '../../lib/llm'

export interface BoundaryPageContext {
  /** Index 0-based de la page dans le document source. */
  index: number
  /** Texte OCR de la page. */
  text: string
  /** Rendu ~700 px de la page (data URL JPEG) pour les modèles multimodaux. */
  image: string
}

/**
 * Verdict du modèle sur une frontière entre deux pages :
 * - 'new'      → la seconde page commence un nouveau document ;
 * - 'continue' → elle poursuit le même document ;
 * - 'unsure'   → pas de signal exploitable (le pipeline ne change alors rien).
 */
export type BoundaryVerdict = 'new' | 'continue' | 'unsure'

export type VerifySplitBoundary = (
  pageBefore: BoundaryPageContext,
  pageAfter: BoundaryPageContext
) => Promise<BoundaryVerdict>

/** Vérificateur actif (configuré par le module UI). `null` = désactivé. */
let activeVerifier: VerifySplitBoundary | null = null

export function getSplitVerifier(): VerifySplitBoundary | null {
  return activeVerifier
}

export function setSplitVerifier(v: VerifySplitBoundary | null) {
  activeVerifier = v
}

const SYSTEM_PROMPT = `Tu analyses un PDF scanné contenant plusieurs documents mis bout à bout (factures, courriers, contrats…).
On te donne la fin du texte OCR d'une page et le début du texte OCR de la page suivante. Le texte OCR peut contenir des fautes de reconnaissance.
Réponds par un seul mot :
- NOUVEAU si la page suivante commence un nouveau document (autre facture, autre courrier, autre expéditeur, nouvelle en-tête…)
- CONTINUE si elle poursuit le même document (suite du tableau, des conditions, de la même facture…)`

const SYSTEM_PROMPT_VISION = `Tu analyses un PDF scanné contenant plusieurs documents mis bout à bout (factures, courriers, contrats…).
Tu reçois DEUX images : la première est une page, la seconde est la page qui la suit immédiatement. Regarde la mise en page, les en-têtes, logos, numéros de page, signatures et pieds de page. Le texte OCR fourni en appui peut contenir des fautes : les images font foi.
Réponds par un seul mot :
- NOUVEAU si la seconde page commence un nouveau document (autre facture, autre courrier, autre expéditeur, nouvelle en-tête…)
- CONTINUE si elle poursuit le même document (suite du tableau, des conditions, de la même facture…)`

/** Tronque le texte OCR pour tenir confortablement dans le contexte. */
const tail = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(-n)
const head = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n)

/** Interprète la réponse brute du modèle ; ambigu → 'unsure'. */
function parseVerdict(answer: string): BoundaryVerdict {
  const a = answer.toUpperCase()
  if (a.includes('CONTINUE')) return 'continue'
  if (a.includes('NOUVEAU')) return 'new'
  return 'unsure'
}

/**
 * Fabrique un vérificateur adossé au modèle donné. Il rend un verdict brut ;
 * c'est le pipeline qui décide quoi en faire (retirer une coupure proposée,
 * en ajouter une manquée — jamais sur 'unsure'). Les erreurs moteur (modèle
 * indisponible…) remontent au pipeline.
 */
const VERDICT_LABEL: Record<BoundaryVerdict, string> = {
  new: 'NOUVEAU document',
  continue: 'même document',
  unsure: 'incertain',
}

export function createLlmVerifier(modelId: string): VerifySplitBoundary {
  const multimodal = isMultimodalLlm(modelId)
  const lowTrust = isLowTrustLlm(modelId)
  return async (pageBefore, pageAfter) => {
    const t0 = Date.now()
    const label = `p.${pageBefore.index + 1}→${pageAfter.index + 1}`
    const done = (rawVerdict: BoundaryVerdict, mode: string) => {
      // Un petit modèle peu fiable ne retire jamais une coupure heuristique :
      // son « même document » est rétrogradé en « incertain » (sans effet).
      const verdict = lowTrust && rawVerdict === 'continue' ? 'unsure' : rawVerdict
      const dur = ((Date.now() - t0) / 1000).toFixed(1).replace('.', ',')
      const note = verdict !== rawVerdict ? ' — ignoré (modèle peu fiable)' : ''
      emitLlmActivity(`${label} : ${VERDICT_LABEL[rawVerdict]}${note} (${mode}, ${dur} s)`)
      return verdict
    }
    const before = tail(pageBefore.text, multimodal ? 400 : 700)
    const after = head(pageAfter.text, multimodal ? 400 : 700)

    if (multimodal && pageBefore.image && pageAfter.image) {
      // Le modèle voit les deux pages : l'OCR n'est qu'un appui, et un texte
      // trop court n'empêche pas de juger sur l'image.
      emitLlmActivity(`${label} : envoi des 2 pages (images + texte)…`)
      const answer = await askLlm(
        modelId,
        SYSTEM_PROMPT_VISION,
        `Image 1 = page ${pageBefore.index + 1}, image 2 = page ${pageAfter.index + 1}.\n\nFin du texte OCR de la page ${pageBefore.index + 1} :\n« …${before} »\n\nDébut du texte OCR de la page ${pageAfter.index + 1} :\n« ${after}… »\n\nLa page ${pageAfter.index + 1} commence-t-elle un NOUVEAU document ?`,
        [pageBefore.image, pageAfter.image]
      )
      return done(parseVerdict(answer), 'vision')
    }

    // Pas assez de texte pour juger sur le seul OCR
    if (before.length < 40 || after.length < 40) {
      emitLlmActivity(`${label} : texte insuffisant, frontière ignorée`)
      return 'unsure'
    }
    emitLlmActivity(`${label} : envoi des extraits de texte…`)
    const answer = await askLlm(
      modelId,
      SYSTEM_PROMPT,
      `Fin de la page ${pageBefore.index + 1} :\n« …${before} »\n\nDébut de la page ${pageAfter.index + 1} :\n« ${after}… »\n\nLa page ${pageAfter.index + 1} commence-t-elle un NOUVEAU document ?`
    )
    return done(parseVerdict(answer), 'texte')
  }
}
