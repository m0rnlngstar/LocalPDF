import { create } from 'zustand'
import { clearSession, debouncedSaver, loadSession } from '../../lib/storage'
import { convertFile } from './converters'
import { newId, type ConvertItem } from './types'

interface PersistedState {
  items: ConvertItem[]
}

interface ConvertState extends PersistedState {
  hydrated: boolean
  /** Avancement de la file de conversion (null quand elle est vide). */
  progress: { done: number; total: number } | null
  hydrate: () => Promise<void>
  reset: () => void
  /** Supprime la session sauvegardée (même si elle n'a pas encore été chargée) et recharge. */
  discardSaved: () => Promise<void>
  addFiles: (files: File[]) => Promise<void>
  moveItem: (from: number, to: number) => void
  removeItem: (id: string) => void
}

// v2 : pages stockées en Blob JPEG. L'ancienne clé (data URL PNG, très lourde) est purgée.
const SESSION_KEY = 'convert-module-v2'
const LEGACY_SESSION_KEY = 'convert-module'
const save = debouncedSaver(SESSION_KEY)

/**
 * File de conversion : un seul fichier traité à la fois, quel que soit le
 * nombre d'ajouts, avec une pause entre deux fichiers pour laisser l'interface
 * respirer. Évite de saturer la RAM avec des dizaines de rendus simultanés.
 */
let queue: { placeholderId: string; file: File }[] = []
let worker: Promise<void> | null = null

const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0))

export const useConvertStore = create<ConvertState>((set, get) => {
  function persist() {
    save({ items: get().items } satisfies PersistedState)
  }

  return {
    items: [],
    hydrated: false,
    progress: null,

    hydrate: async () => {
      if (get().hydrated) return
      void clearSession(LEGACY_SESSION_KEY)
      const saved = await loadSession<PersistedState>(SESSION_KEY)
      // Une conversion interrompue (onglet fermé) ne reprendra jamais : on marque ces cartes en erreur
      const items = saved?.items?.map((it) =>
        it.status === 'converting' ? { ...it, status: 'error' as const, error: 'Conversion interrompue' } : it
      )
      set({ hydrated: true, ...(items?.length ? { items } : {}) })
    },

    reset: () => {
      queue = []
      set({ items: [], progress: null })
      persist()
    },

    discardSaved: async () => {
      await clearSession(SESSION_KEY)
      window.location.reload()
    },

    addFiles: async (files) => {
      // Cartes "en attente" tout de suite pour un retour visuel immédiat,
      // remplacées une à une par la file de conversion.
      const placeholders = files.map((file) => ({ placeholderId: newId(), file }))
      const progress = get().progress ?? { done: 0, total: 0 }
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
        progress: { done: progress.done, total: progress.total + files.length },
      })
      queue.push(...placeholders)

      worker ??= (async () => {
        while (queue.length > 0) {
          const { placeholderId, file } = queue.shift()!
          // Carte retirée entre-temps : inutile de la convertir
          if (get().items.some((it) => it.id === placeholderId)) {
            const result = await convertFile(file)
            set({
              items: get().items.map((it) => (it.id === placeholderId ? { ...result, id: placeholderId } : it)),
            })
            persist()
          }
          const p = get().progress
          if (p) set({ progress: { ...p, done: p.done + 1 } })
          await yieldToBrowser()
        }
        set({ progress: null })
      })().finally(() => {
        worker = null
      })
      await worker
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
