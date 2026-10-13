import { useAppStore, type ModuleId } from '../store/appStore'
import { toast } from '../components/ui/Toast'
import { useStudio } from './store'
import { importFiles } from './importFiles'

/**
 * Passage de fichiers entre l'éditeur et les outils avancés.
 * - éditeur → outil : le document courant est exporté en PDF puis déposé ici ;
 *   l'outil le consomme à son montage (takeHandoff).
 * - outil → éditeur : openInStudio ajoute/remplace les pages de l'éditeur.
 */

const pending = new Map<ModuleId, File[]>()

export function sendToTool(id: ModuleId, files: File[]) {
  pending.set(id, files)
  useAppStore.getState().openTool(id)
}

/** Récupère (une seule fois) les fichiers transmis à un outil. */
export function takeHandoff(id: ModuleId): File[] | null {
  const files = pending.get(id)
  pending.delete(id)
  return files ?? null
}

/** Ouvre un PDF produit par un outil avancé dans l'éditeur. */
export async function openInStudio(bytes: Uint8Array, name: string) {
  const file = new File([bytes as BlobPart], `${name}.pdf`, { type: 'application/pdf' })
  const result = await importFiles([file])
  if (!result.pages.length) {
    toast.error('Impossible d’ouvrir ce PDF dans l’éditeur')
    return
  }
  const studio = useStudio.getState()
  if (studio.pages.length) {
    const replace = window.confirm(
      'Un document est déjà ouvert dans l’éditeur.\n\nOK : le remplacer\nAnnuler : ajouter ces pages à la fin'
    )
    if (replace) studio.closeDocument()
  }
  useStudio.getState().insertPages(result.pages, result.docs, undefined, name)
  useAppStore.getState().openTool(null)
  toast.success('Document ouvert dans l’éditeur')
}
