import { create } from 'zustand'
import { toast } from '../components/ui/Toast'
import { useAppStore, type ModuleId } from '../store/appStore'
import { useStudio } from './store'
import { ACCEPT, baseName, importFiles } from './importFiles'
import { buildStudioPdf } from './exportPdf'
import { sendToTool } from './handoff'

/** Tâche longue en cours (import, export, OCR…) : affichée en surimpression. */
interface BusyState {
  label: string | null
  progress: number | null
  set: (label: string | null, progress?: number | null) => void
}

export const useBusy = create<BusyState>((set) => ({
  label: null,
  progress: null,
  set: (label, progress = null) => set({ label, progress }),
}))

/** Ouvre le sélecteur de fichiers du système. */
export function pickFiles(multiple = true, accept = ACCEPT): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => resolve(Array.from(input.files ?? []))
    // Annulation : certains navigateurs émettent « cancel »
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

/**
 * Ajoute des fichiers au document : `replace` ouvre un nouveau document,
 * sinon les pages sont insérées à la position donnée (fin par défaut).
 */
export async function addFiles(files: File[], mode: 'replace' | 'insert', at?: number) {
  if (!files.length) return
  const busy = useBusy.getState()
  busy.set('Préparation des fichiers…', 0)
  try {
    const result = await importFiles(files, (done, total, name) => {
      useBusy.getState().set(name ? `Lecture de ${name}…` : 'Finalisation…', total ? done / total : null)
    })
    for (const err of result.errors) toast.error(err)
    if (!result.pages.length) return
    const studio = useStudio.getState()
    const name = files.length === 1 ? baseName(files[0].name) : 'document-fusionne'
    if (mode === 'replace' || !studio.pages.length) {
      studio.closeDocument()
      useStudio.getState().insertPages(result.pages, result.docs, 0, name)
    } else {
      studio.insertPages(result.pages, result.docs, at)
      toast.success(`${result.pages.length} page(s) ajoutée(s)`)
    }
  } finally {
    useBusy.getState().set(null)
  }
}

/** Position d'insertion : après la sélection, sinon après la page courante. */
export function insertionIndex(): number {
  const { pages, selectedPageIds, currentPageId } = useStudio.getState()
  const idx = selectedPageIds.length
    ? Math.max(...selectedPageIds.map((id) => pages.findIndex((p) => p.id === id)))
    : pages.findIndex((p) => p.id === currentPageId)
  return idx < 0 ? pages.length : idx + 1
}

/** Exporte le document courant et l'ouvre dans un outil avancé. */
export async function sendDocumentToTool(id: ModuleId) {
  const { pages, docs, name, watermark } = useStudio.getState()
  if (!pages.length) {
    useAppStore.getState().openTool(id)
    return
  }
  useBusy.getState().set('Préparation du document…', 0)
  try {
    const bytes = await buildStudioPdf(pages, docs, {
      watermark, title: name,
      onProgress: (d, t) => useBusy.getState().set('Préparation du document…', t ? d / t : null),
    })
    sendToTool(id, [new File([bytes as BlobPart], `${name}.pdf`, { type: 'application/pdf' })])
  } catch (err) {
    console.error(err)
    toast.error('Impossible de préparer le document')
  } finally {
    useBusy.getState().set(null)
  }
}

/** Boîtes de dialogue de l'éditeur (ouvrables depuis le menu ou un raccourci). */
interface DialogState {
  dialog: 'export' | 'new' | 'shortcuts' | 'add-pages' | 'enhance' | 'receipts' | null
  /** Position d'insertion proposée par défaut dans « Ajouter des pages ». */
  addAt: number | null
  open: (d: DialogState['dialog']) => void
  /** Ouvre « Ajouter des pages » (après une page donnée, sinon après la sélection). */
  openAddPages: (at?: number) => void
}

export const useDialogs = create<DialogState>((set) => ({
  dialog: null,
  addAt: null,
  open: (dialog) => set({ dialog }),
  openAddPages: (at) => set({ dialog: 'add-pages', addAt: at ?? null }),
}))
