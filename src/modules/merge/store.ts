import { create } from 'zustand'
import { debouncedSaver, loadSession } from '../../lib/storage'
import { openPdf } from '../../lib/pdfjs'
import { newId } from '../edit/types'

/**
 * Fusionneur : une liste ordonnée de fichiers (PDF ou images).
 * L'ordre de la liste est l'ordre final dans le document fusionné.
 */

export interface MergeItem {
  id: string
  name: string
  kind: 'pdf' | 'image'
  /** Octets du PDF (kind='pdf'). */
  bytes?: ArrayBuffer
  /** Data URL de l'image (kind='image'). */
  dataUrl?: string
  /** Dimensions de l'image en points (kind='image'). */
  width?: number
  height?: number
  pageCount: number
}

interface PersistedState {
  items: MergeItem[]
}

interface MergeState extends PersistedState {
  hydrated: boolean
  hydrate: () => Promise<void>
  reset: () => void
  addFiles: (files: File[]) => Promise<void>
  moveItem: (from: number, to: number) => void
  removeItem: (id: string) => void
}

const SESSION_KEY = 'merge-module'
const save = debouncedSaver(SESSION_KEY)

function loadImageDims(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      // Plafonné à la largeur A4, comme dans l'éditeur
      const ratio = Math.min(1, 595.28 / img.width)
      resolve({ width: img.width * ratio, height: img.height * ratio })
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export const useMergeStore = create<MergeState>((set, get) => {
  function persist() {
    save({ items: get().items } satisfies PersistedState)
  }

  return {
    items: [],
    hydrated: false,

    hydrate: async () => {
      if (get().hydrated) return
      const saved = await loadSession<PersistedState>(SESSION_KEY)
      set({ hydrated: true, ...(saved?.items?.length ? { items: saved.items } : {}) })
    },

    reset: () => {
      set({ items: [] })
      persist()
    },

    addFiles: async (files) => {
      const newItems: MergeItem[] = []
      for (const file of files) {
        if (file.type === 'application/pdf') {
          const bytes = await file.arrayBuffer()
          const doc = await openPdf(bytes)
          newItems.push({
            id: newId(),
            name: file.name,
            kind: 'pdf',
            bytes,
            pageCount: doc.numPages,
          })
        } else if (file.type.startsWith('image/')) {
          const dataUrl = await readAsDataUrl(file)
          const dims = await loadImageDims(dataUrl)
          newItems.push({
            id: newId(),
            name: file.name,
            kind: 'image',
            dataUrl,
            ...dims,
            pageCount: 1,
          })
        }
      }
      set({ items: [...get().items, ...newItems] })
      persist()
    },

    moveItem: (from, to) => {
      const { items } = get()
      if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return
      const next = [...items]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      set({ items: next })
      persist()
    },

    removeItem: (id) => {
      set({ items: get().items.filter((i) => i.id !== id) })
      persist()
    },
  }
})

/** Fusionne tous les éléments dans l'ordre de la liste. */
export async function buildMergedPdf(items: MergeItem[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const out = await PDFDocument.create()
  for (const item of items) {
    if (item.kind === 'pdf' && item.bytes) {
      const src = await PDFDocument.load(item.bytes)
      const copied = await out.copyPages(src, src.getPageIndices())
      for (const p of copied) out.addPage(p)
    } else if (item.kind === 'image' && item.dataUrl) {
      const bytes = await fetch(item.dataUrl).then((r) => r.arrayBuffer())
      const image = item.dataUrl.startsWith('data:image/png')
        ? await out.embedPng(bytes)
        : await out.embedJpg(bytes)
      const w = item.width ?? image.width
      const h = item.height ?? image.height
      const page = out.addPage([w, h])
      page.drawImage(image, { x: 0, y: 0, width: w, height: h })
    }
  }
  return out.save()
}
