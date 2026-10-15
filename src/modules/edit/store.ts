import { create } from 'zustand'
import { debouncedSaver, loadSession } from '../../lib/storage'
import { openPdf } from '../../lib/pdfjs'
import {
  newId,
  type EditAnnotation,
  type EditPage,
  type EditTool,
  type UserRotation,
} from './types'

const SESSION_KEY = 'edit-module'

interface PersistedState {
  /** Octets des PDF sources, par identifiant. */
  docs: Record<string, ArrayBuffer>
  pages: EditPage[]
  currentPageId: string | null
}

interface EditState extends PersistedState {
  view: 'grid' | 'annotate'
  tool: EditTool
  selectedAnnotationId: string | null
  hydrated: boolean

  hydrate: () => Promise<void>
  reset: () => void
  /** Charge un PDF et insère ses pages à `insertAt` (fin par défaut). */
  loadPdf: (file: File, insertAt?: number) => Promise<number>
  addBlankPage: (insertAt?: number) => void
  addImagePage: (dataUrl: string, width: number, height: number, insertAt?: number) => void
  movePage: (from: number, to: number) => void
  deletePage: (id: string) => void
  rotatePage: (id: string) => void
  setCurrentPage: (id: string | null) => void
  setView: (v: 'grid' | 'annotate') => void
  setTool: (t: EditTool) => void

  addAnnotation: (pageId: string, ann: EditAnnotation) => void
  updateAnnotation: (pageId: string, id: string, patch: Partial<EditAnnotation>) => void
  removeAnnotation: (pageId: string, id: string) => void
  selectAnnotation: (id: string | null) => void
}

const save = debouncedSaver(SESSION_KEY)

export const useEditStore = create<EditState>((set, get) => {
  function persist() {
    const { docs, pages, currentPageId } = get()
    save({ docs, pages, currentPageId } satisfies PersistedState)
  }

  function mutatePageById(pages: EditPage[], id: string, fn: (p: EditPage) => EditPage) {
    return pages.map((p) => (p.id === id ? fn(p) : p))
  }

  return {
    docs: {},
    pages: [],
    currentPageId: null,
    view: 'grid',
    tool: 'select',
    selectedAnnotationId: null,
    hydrated: false,

    hydrate: async () => {
      if (get().hydrated) return
      const saved = await loadSession<PersistedState>(SESSION_KEY)
      set({
        hydrated: true,
        ...(saved?.pages?.length
          ? { docs: saved.docs, pages: saved.pages, currentPageId: saved.currentPageId }
          : {}),
      })
    },

    reset: () => {
      set({
        docs: {},
        pages: [],
        currentPageId: null,
        view: 'grid',
        tool: 'select',
        selectedAnnotationId: null,
      })
      persist()
    },

    loadPdf: async (file, insertAt) => {
      const bytes = await file.arrayBuffer()
      const docId = newId()
      // On ouvre le document pour connaître le nombre de pages, les dimensions
      // non tournées et la rotation propre de chaque page.
      const doc = await openPdf(bytes)
      const newPages: EditPage[] = []
      for (let i = 0; i < doc.numPages; i++) {
        const page = await doc.getPage(i + 1)
        const vp = page.getViewport({ scale: 1, rotation: 0 })
        newPages.push({
          id: newId(),
          source: {
            kind: 'pdf',
            docId,
            pageIndex: i,
            width: vp.width,
            height: vp.height,
            inherentRotation: page.rotate,
          },
          rotation: 0,
          annotations: [],
        })
      }
      const { pages, docs } = get()
      const at = insertAt ?? pages.length
      const next = [...pages]
      next.splice(at, 0, ...newPages)
      set({
        docs: { ...docs, [docId]: bytes },
        pages: next,
        currentPageId: get().currentPageId ?? newPages[0]?.id ?? null,
      })
      persist()
      return newPages.length
    },

    addBlankPage: (insertAt) => {
      const { pages } = get()
      const at = insertAt ?? pages.length
      // Reprend le format de la page précédente, sinon A4
      const ref = pages[Math.max(0, at - 1)]
      const size = ref
        ? { width: ref.source.width, height: ref.source.height }
        : { width: 595.28, height: 841.89 }
      const page: EditPage = {
        id: newId(),
        source: { kind: 'blank', ...size },
        rotation: 0,
        annotations: [],
      }
      const next = [...pages]
      next.splice(at, 0, page)
      set({ pages: next, currentPageId: page.id })
      persist()
    },

    addImagePage: (dataUrl, width, height, insertAt) => {
      const { pages } = get()
      const at = insertAt ?? pages.length
      const page: EditPage = {
        id: newId(),
        source: { kind: 'image', dataUrl, width, height },
        rotation: 0,
        annotations: [],
      }
      const next = [...pages]
      next.splice(at, 0, page)
      set({ pages: next, currentPageId: page.id })
      persist()
    },

    movePage: (from, to) => {
      const { pages } = get()
      if (from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return
      const next = [...pages]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      set({ pages: next })
      persist()
    },

    deletePage: (id) => {
      const { pages, currentPageId } = get()
      const next = pages.filter((p) => p.id !== id)
      set({
        pages: next,
        currentPageId:
          currentPageId === id ? (next[0]?.id ?? null) : currentPageId,
      })
      persist()
    },

    rotatePage: (id) => {
      set({
        pages: mutatePageById(get().pages, id, (p) => ({
          ...p,
          rotation: ((p.rotation + 90) % 360) as UserRotation,
        })),
      })
      persist()
    },

    setCurrentPage: (id) => set({ currentPageId: id, selectedAnnotationId: null }),
    setView: (view) => set({ view, selectedAnnotationId: null }),
    setTool: (tool) => set({ tool, selectedAnnotationId: null }),

    addAnnotation: (pageId, ann) => {
      set({
        pages: mutatePageById(get().pages, pageId, (p) => ({
          ...p,
          annotations: [...p.annotations, ann],
        })),
        selectedAnnotationId: ann.id,
      })
      persist()
    },

    updateAnnotation: (pageId, id, patch) => {
      set({
        pages: mutatePageById(get().pages, pageId, (p) => ({
          ...p,
          annotations: p.annotations.map((a) =>
            a.id === id ? ({ ...a, ...patch } as EditAnnotation) : a
          ),
        })),
      })
      persist()
    },

    removeAnnotation: (pageId, id) => {
      const { selectedAnnotationId } = get()
      set({
        pages: mutatePageById(get().pages, pageId, (p) => ({
          ...p,
          annotations: p.annotations.filter((a) => a.id !== id),
        })),
        selectedAnnotationId: selectedAnnotationId === id ? null : selectedAnnotationId,
      })
      persist()
    },

    selectAnnotation: (id) => set({ selectedAnnotationId: id }),
  }
})
