import { create } from 'zustand'
import { debouncedSaver, loadSession } from '../../lib/storage'
import {
  newId,
  pageSize,
  type Orientation,
  type PageData,
  type PageFormatId,
  type PdfElement,
  type Watermark,
} from './types'

const SESSION_KEY = 'create-module'

interface PersistedState {
  pages: PageData[]
  currentPageIndex: number
  watermark: Watermark | null
}

interface CreateState extends PersistedState {
  selectedElementId: string | null
  hydrated: boolean

  hydrate: () => Promise<void>
  newDocument: (
    format: PageFormatId,
    orientation: Orientation,
    custom?: { width: number; height: number }
  ) => void
  addPage: () => void
  duplicatePage: (index: number) => void
  deletePage: (index: number) => void
  setCurrentPage: (index: number) => void
  /** Réordonne les pages (drag & drop). */
  movePage: (from: number, to: number) => void
  setPageBackground: (color: string) => void
  setWatermark: (w: Watermark | null) => void

  addElement: (el: PdfElement) => void
  updateElement: (id: string, patch: Partial<PdfElement>) => void
  removeElement: (id: string) => void
  selectElement: (id: string | null) => void
  /** Déplace l'élément dans l'ordre des calques (z-index). */
  moveZ: (id: string, dir: 'up' | 'down' | 'front' | 'back') => void
}

const save = debouncedSaver(SESSION_KEY)

function mutatePage(
  pages: PageData[],
  index: number,
  fn: (p: PageData) => PageData
): PageData[] {
  return pages.map((p, i) => (i === index ? fn(p) : p))
}

export const useCreateStore = create<CreateState>((set, get) => {
  /** Sauvegarde l'état courant (post-set) en IndexedDB. */
  function persist() {
    const { pages, currentPageIndex, watermark } = get()
    save({ pages, currentPageIndex, watermark } satisfies PersistedState)
  }

  return {
    pages: [],
    currentPageIndex: 0,
    watermark: null,
    selectedElementId: null,
    hydrated: false,

    hydrate: async () => {
      if (get().hydrated) return
      const saved = await loadSession<PersistedState>(SESSION_KEY)
      set({
        hydrated: true,
        ...(saved?.pages?.length
          ? {
              pages: saved.pages,
              currentPageIndex: Math.min(saved.currentPageIndex, saved.pages.length - 1),
              watermark: saved.watermark ?? null,
            }
          : {}),
      })
    },

    newDocument: (format, orientation, custom) => {
      const size = pageSize(format, orientation, custom)
      set({
        pages: [{ id: newId(), ...size, backgroundColor: '#ffffff', elements: [] }],
        currentPageIndex: 0,
        watermark: null,
        selectedElementId: null,
      })
      persist()
    },

    addPage: () => {
      const { pages, currentPageIndex } = get()
      const ref = pages[currentPageIndex] ?? pages[pages.length - 1]
      const page: PageData = {
        id: newId(),
        width: ref.width,
        height: ref.height,
        backgroundColor: ref.backgroundColor,
        elements: [],
      }
      const next = [...pages]
      next.splice(currentPageIndex + 1, 0, page)
      set({ pages: next, currentPageIndex: currentPageIndex + 1, selectedElementId: null })
      persist()
    },

    duplicatePage: (index) => {
      const { pages } = get()
      const src = pages[index]
      const copy: PageData = {
        ...src,
        id: newId(),
        elements: src.elements.map((el) => ({ ...el, id: newId() })),
      }
      const next = [...pages]
      next.splice(index + 1, 0, copy)
      set({ pages: next, currentPageIndex: index + 1, selectedElementId: null })
      persist()
    },

    deletePage: (index) => {
      const { pages, currentPageIndex } = get()
      if (pages.length <= 1) return
      const next = pages.filter((_, i) => i !== index)
      set({
        pages: next,
        currentPageIndex: Math.min(currentPageIndex, next.length - 1),
        selectedElementId: null,
      })
      persist()
    },

    setCurrentPage: (index) => {
      set({ currentPageIndex: index, selectedElementId: null })
      persist()
    },

    movePage: (from, to) => {
      const { pages, currentPageIndex } = get()
      if (from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return
      const next = [...pages]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      // Garde la même page "courante" après réorganisation
      const currentId = pages[currentPageIndex].id
      set({
        pages: next,
        currentPageIndex: next.findIndex((p) => p.id === currentId),
      })
      persist()
    },

    setPageBackground: (color) => {
      const { pages, currentPageIndex } = get()
      set({
        pages: mutatePage(pages, currentPageIndex, (p) => ({ ...p, backgroundColor: color })),
      })
      persist()
    },

    setWatermark: (w) => {
      set({ watermark: w })
      persist()
    },

    addElement: (el) => {
      const { pages, currentPageIndex } = get()
      set({
        pages: mutatePage(pages, currentPageIndex, (p) => ({
          ...p,
          elements: [...p.elements, el],
        })),
        selectedElementId: el.id,
      })
      persist()
    },

    updateElement: (id, patch) => {
      const { pages, currentPageIndex } = get()
      set({
        pages: mutatePage(pages, currentPageIndex, (p) => ({
          ...p,
          elements: p.elements.map((el) =>
            el.id === id ? ({ ...el, ...patch } as PdfElement) : el
          ),
        })),
      })
      persist()
    },

    removeElement: (id) => {
      const { pages, currentPageIndex, selectedElementId } = get()
      set({
        pages: mutatePage(pages, currentPageIndex, (p) => ({
          ...p,
          elements: p.elements.filter((el) => el.id !== id),
        })),
        selectedElementId: selectedElementId === id ? null : selectedElementId,
      })
      persist()
    },

    selectElement: (id) => set({ selectedElementId: id }),

    moveZ: (id, dir) => {
      const { pages, currentPageIndex } = get()
      set({
        pages: mutatePage(pages, currentPageIndex, (p) => {
          const idx = p.elements.findIndex((el) => el.id === id)
          if (idx < 0) return p
          const els = [...p.elements]
          const [el] = els.splice(idx, 1)
          const target =
            dir === 'front' ? els.length
            : dir === 'back' ? 0
            : dir === 'up' ? Math.min(idx + 1, els.length)
            : Math.max(idx - 1, 0)
          els.splice(target, 0, el)
          return { ...p, elements: els }
        }),
      })
      persist()
    },
  }
})
