import { PDFArray, PDFDict, PDFName, type PDFPage } from 'pdf-lib'

/**
 * Nettoyage des pages PDF copiées telles quelles à l'export.
 *
 * Une page importée peut porter des actions actives (JavaScript, lancement de
 * programme, envoi de formulaire vers un serveur…) que LocalPDF n'exécute
 * pas, mais qu'un lecteur comme Acrobat déclencherait chez le destinataire.
 * Seules les actions inoffensives sont conservées : aller à une page (GoTo),
 * ouvrir une adresse web (URI), actions nommées (page suivante, imprimer…).
 */

const SAFE_ACTIONS = new Set(['GoTo', 'URI', 'Named'])

/** Annotations porteuses de contenu actif ou de fichiers embarqués : supprimées. */
const UNSAFE_SUBTYPES = new Set(['FileAttachment', 'RichMedia', 'Screen', 'Movie', 'Sound', '3D'])

const A = PDFName.of('A')
const AA = PDFName.of('AA')
const S = PDFName.of('S')
const NEXT = PDFName.of('Next')
const ANNOTS = PDFName.of('Annots')
const SUBTYPE = PDFName.of('Subtype')
const PARENT = PDFName.of('Parent')

function nameOf(v: unknown): string | null {
  return v instanceof PDFName ? v.decodeText() : null
}

/** Vrai si l'action, ou une action enchaînée (/Next), n'est pas sûre. */
function isUnsafeAction(action: PDFDict | undefined, depth = 0): boolean {
  if (!action || depth > 20) return false
  const type = nameOf(action.lookup(S))
  if (!type || !SAFE_ACTIONS.has(type)) return true
  const next = action.lookup(NEXT)
  if (next instanceof PDFDict) return isUnsafeAction(next, depth + 1)
  if (next instanceof PDFArray) {
    for (let i = 0; i < next.size(); i++) {
      const n = next.lookup(i)
      if (n instanceof PDFDict && isUnsafeAction(n, depth + 1)) return true
    }
  }
  return false
}

/** Retire les actions dangereuses d'une page ; renvoie le nombre d'éléments neutralisés. */
export function sanitizePageActions(page: PDFPage): number {
  let removed = 0
  // Actions automatiques de la page (ouverture / fermeture)
  if (page.node.has(AA)) {
    page.node.delete(AA)
    removed++
  }
  const annots = page.node.lookup(ANNOTS)
  if (!(annots instanceof PDFArray)) return removed

  const kept = []
  for (let i = 0; i < annots.size(); i++) {
    const raw = annots.get(i)
    const annot = annots.lookup(i)
    if (!(annot instanceof PDFDict)) continue
    if (UNSAFE_SUBTYPES.has(nameOf(annot.lookup(SUBTYPE)) ?? '')) {
      removed++
      continue
    }
    // Actions déclenchées par la souris, le focus, la saisie, le calcul (champs de
    // formulaire) : sur le widget et sur la hiérarchie de champs parents
    let node: PDFDict | undefined = annot
    for (let depth = 0; node && depth < 20; depth++) {
      if (node.has(AA)) {
        node.delete(AA)
        removed++
      }
      const parent: unknown = node.lookup(PARENT)
      node = parent instanceof PDFDict ? parent : undefined
    }
    const action = annot.lookup(A)
    if (action instanceof PDFDict && isUnsafeAction(action)) {
      annot.delete(A)
      removed++
    }
    kept.push(raw)
  }
  if (kept.length !== annots.size()) {
    page.node.set(ANNOTS, page.doc.context.obj(kept))
  }
  return removed
}
