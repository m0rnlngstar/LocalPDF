import { create } from 'zustand'
import { clearSession, debouncedSaver, loadSession } from '../../lib/storage'
import { convertFile } from './converters'
import { newId, type ConvertItem } from './types'

interface PersistedState {
  items: ConvertItem[]
}

interface ConvertState extends PersistedState {
  hydrated: boolean
  hydrate: () => Promise<void>
  reset: () => void
  /** Supprime la session sauvegardée (même si elle n'a pas encore été chargée) et recharge. */
  discardSaved: () => Promise<void>
  addFiles: (files: File[]) => Promise<void>
  moveItem: (from: number, to: number) => void
  removeItem: (id: string) => void
}

const SESSION_KEY = 'convert-module'
const save = debouncedSaver(SESSION_KEY)

export const useConvertStore = create<ConvertState>((set, get) => {
  function persist() {
    save({ items: get().items } satisfies PersistedState)
  }

  return {
    items: [],
    hydrated: false,

    hydrate: async () => {
      if (get().hydrated) return
      const saved = await loadSession<PersistedState>(SESSION_KEY)
      // Une conversion interrompue (onglet fermé) ne reprendra jamais : on marque ces cartes en erreur
      const items = saved?.items?.map((it) =>
        it.status === 'converting' ? { ...it, status: 'error' as const, error: 'Conversion interrompue' } : it
      )
      set({ hydrated: true, ...(items?.length ? { items } : {}) })
    },

    reset: () => {
      set({ items: [] })
      persist()
    },

    discardSaved: async () => {
      await clearSession(SESSION_KEY)
      window.location.reload()
    },

    addFiles: async (files) => {
      // Insère tout de suite des cartes "en conversion" pour un retour visuel
      // immédiat, puis les remplace une à une : un DOCX ou un HEIC volumineux
      // peut prendre plusieurs secondes à traiter.
      const placeholders = files.map((f) => ({
        placeholderId: newId(),
        file: f,
      }))
      set({
        items: [
          ...get().items,
          ...placeholders.map(({ placeholderId, file }) => ({
            id: placeholderId,
            name: file.name,
            kind: 'pages' as const,
            status: 'converting' as const,
            pageCount: 0,
          })),
        ],
      })

      for (const { placeholderId, file } of placeholders) {
        const result = await convertFile(file)
        set({
          items: get().items.map((it) => (it.id === placeholderId ? { ...result, id: placeholderId } : it)),
        })
      }
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
