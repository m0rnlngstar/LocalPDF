import { create } from 'zustand'
import { debouncedSaver, loadSession } from '../lib/storage'
import { rememberPassword } from './passwords'
import {
  displaySize, newId, rotateAnnotation90, rotateWords90,
  type Annotation, type StudioPage, type Tool, type UserRotation, type Watermark,
} from './types'

const SESSION_KEY = 'studio'
const HISTORY_LIMIT = 80

interface PersistedState {
  docs: Record<string, ArrayBuffer>
  pages: StudioPage[]
  name: string
  watermark: Watermark | null
  currentPageId: string | null
}

export type RightPanel = 'properties' | 'comments' | 'search' | 'ocr' | 'document' | null

export interface ToolOptions {
  highlightColor: string
  strokeColor: string
  strokeWidth: number
  textColor: string
  fontSize: number
  noteColor: string
  stampText: string
  stampColor: string
  inkColor: string
  /** Bordure des nouvelles zones de texte (null = sans bordure). */
  textBorder: string | null
  /** Surlignage : s'aligner sur le texte détecté (sinon rectangle libre). */
  snapToText: boolean
}

/** Pages « collées » en mémoire (copier / coller entre positions). */
interface ClipboardAnn {
  ann: Annotation
}

interface StudioState extends PersistedState {
  hydrated: boolean
  tool: Tool
  toolOptions: ToolOptions
  /** Pages sélectionnées dans la barre de miniatures / l'organiseur. */
  selectedPageIds: string[]
  selectedAnn: { pageId: string; id: string } | null
  /** Annotation dont le texte est en cours d'édition (zone de saisie ouverte). */
  editingAnn: { pageId: string; id: string } | null
  zoom: number | 'fit-width' | 'fit-page'
  /** Échelle effective du lecteur (pixels CSS par point), calculée par le Viewer. */
  viewScale: number
  view: 'read' | 'organize'
  rightPanel: RightPanel
  showThumbnails: boolean
  /** Demande de défilement vers une page (consommée par le lecteur). */
  scrollRequest: { pageId: string; y?: number; nonce: number } | null
  /** Zones à faire clignoter (résultat de recherche). */
  flash: { pageId: string; rects: { x: number; y: number; width: number; height: number }[]; nonce: number } | null
  past: StudioPage[][]
  future: StudioPage[][]
  clipboard: ClipboardAnn | null

  hydrate: () => Promise<void>
  /** Remplace (ou complète) le document courant par des pages préparées. */
  insertPages: (pages: StudioPage[], docs: Record<string, ArrayBuffer>, at?: number, name?: string) => void
  newDocument: (size: { width: number; height: number }, count: number, name?: string) => void
  closeDocument: () => void
  setName: (name: string) => void
  setWatermark: (w: Watermark | null) => void

  addBlankPage: (at?: number) => void
  movePages: (ids: string[], toIndex: number) => void
  deletePages: (ids: string[]) => void
  rotatePages: (ids: string[], dir: 1 | -1) => void
  duplicatePages: (ids: string[]) => void
  setPageBackground: (id: string, color: string) => void
  setPageOcr: (id: string, ocr: StudioPage['ocr']) => void

  addAnnotation: (pageId: string, ann: Annotation) => void
  updateAnnotation: (pageId: string, id: string, patch: Partial<Annotation>) => void
  removeAnnotation: (pageId: string, id: string) => void
  reorderAnnotation: (pageId: string, id: string, where: 'front' | 'back') => void
  copyAnnotation: () => void
  pasteAnnotation: (pageId: string) => void

  setTool: (t: Tool) => void
  setToolOptions: (o: Partial<ToolOptions>) => void
  selectAnnotation: (sel: { pageId: string; id: string } | null) => void
  setEditingAnn: (sel: { pageId: string; id: string } | null) => void
  setCurrentPage: (id: string | null) => void
  setSelectedPages: (ids: string[]) => void
  setZoom: (z: StudioState['zoom']) => void
  setView: (v: StudioState['view']) => void
  setRightPanel: (p: RightPanel) => void
  toggleThumbnails: () => void
  scrollToPage: (pageId: string, y?: number) => void
  flashRects: (pageId: string, rects: { x: number; y: number; width: number; height: number }[]) => void

  undo: () => void
  redo: () => void
}

const save = debouncedSaver(SESSION_KEY)

function withoutPassword(p: StudioPage): StudioPage {
  if (p.source.kind !== 'pdf' || !p.source.password) return p
  const { password: _omit, ...source } = p.source
  void _omit
  return { ...p, source }
}

const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  highlightColor: '#fde047',
  strokeColor: '#dc2626',
  strokeWidth: 2,
  textColor: '#111111',
  fontSize: 14,
  noteColor: '#fef08a',
  stampText: 'APPROUVÉ',
  stampColor: '#dc2626',
  inkColor: '#1d4ed8',
  textBorder: null,
  snapToText: true,
}

const OPTIONS_KEY = 'studio-tool-options'

function loadToolOptions(): ToolOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY)
    return raw ? { ...DEFAULT_TOOL_OPTIONS, ...JSON.parse(raw) } : DEFAULT_TOOL_OPTIONS
  } catch {
    return DEFAULT_TOOL_OPTIONS
  }
}

export const useStudio = create<StudioState>((set, get) => {
  function persist() {
    const { docs, pages, name, watermark, currentPageId } = get()
    save({ docs, pages: pages.map(withoutPassword), name, watermark, currentPageId } satisfies PersistedState)
  }

  /** Dernière modification « fusionnable » (saisie continue sur un même élément). */
  let lastMerge: { key: string; at: number } | null = null

  /**
   * Applique une modification des pages en l'inscrivant dans l'historique.
   * Avec `mergeKey`, les modifications rapprochées d'un même élément (frappe
   * au clavier, réglage d'un curseur) forment une seule étape d'annulation.
   */
  function commit(pages: StudioPage[], extra: Partial<StudioState> = {}, mergeKey?: string) {
    const now = Date.now()
    const merge = !!mergeKey && lastMerge?.key === mergeKey && now - lastMerge.at < 1200 && get().past.length > 0
    lastMerge = mergeKey ? { key: mergeKey, at: now } : null
    const past = merge ? get().past : [...get().past, get().pages].slice(-HISTORY_LIMIT)
    set({ ...extra, pages, past, future: [] })
    persist()
  }

  function mapPage(id: string, fn: (p: StudioPage) => StudioPage) {
    return get().pages.map((p) => (p.id === id ? fn(p) : p))
  }

  return {
    docs: {},
    pages: [],
    name: 'document',
    watermark: null,
    currentPageId: null,
    hydrated: false,
    tool: 'select',
    toolOptions: loadToolOptions(),
    selectedPageIds: [],
    selectedAnn: null,
    editingAnn: null,
    zoom: 1,
    viewScale: 1,
    view: 'read',
    rightPanel: null,
    showThumbnails: true,
    scrollRequest: null,
    flash: null,
    past: [],
    future: [],
    clipboard: null,

    hydrate: async () => {
      if (get().hydrated) return
      // Stockage indisponible (navigation privée stricte, stratégie d'entreprise…) :
      // l'éditeur démarre quand même, simplement sans reprise de session
      const saved = await loadSession<PersistedState>(SESSION_KEY).catch((err) => {
        console.warn('Session locale illisible :', err)
        return undefined
      })
      set({
        hydrated: true,
        ...(saved?.pages?.length
          ? {
              docs: saved.docs,
              // Anciennes sessions : mot de passe retiré du stockage, gardé en mémoire
              pages: saved.pages.map((p) => {
                if (p.source.kind === 'pdf' && p.source.password) rememberPassword(p.source.docId, p.source.password)
                return withoutPassword(p)
              }),
              name: saved.name ?? 'document',
              watermark: saved.watermark ?? null,
              currentPageId: saved.currentPageId,
            }
          : {}),
      })
    },

    insertPages: (newPages, newDocs, at, name) => {
      const { pages, docs } = get()
      const pos = at ?? pages.length
      const next = [...pages]
      next.splice(pos, 0, ...newPages)
      commit(next, {
        docs: { ...docs, ...newDocs },
        currentPageId: pages.length === 0 ? (newPages[0]?.id ?? null) : get().currentPageId,
        ...(pages.length === 0 && name ? { name } : {}),
      })
      if (pages.length > 0 && newPages[0]) get().scrollToPage(newPages[0].id)
    },

    newDocument: (size, count, name = 'nouveau-document') => {
      const pages: StudioPage[] = Array.from({ length: Math.max(1, count) }, () => ({
        id: newId(),
        source: { kind: 'blank', ...size },
        rotation: 0,
        annotations: [],
      }))
      set({
        docs: {}, pages, name, watermark: null, currentPageId: pages[0].id,
        selectedPageIds: [], selectedAnn: null, past: [], future: [], view: 'read', tool: 'text',
      })
      persist()
    },

    closeDocument: () => {
      set({
        docs: {}, pages: [], name: 'document', watermark: null, currentPageId: null,
        selectedPageIds: [], selectedAnn: null, past: [], future: [], view: 'read',
        rightPanel: null, tool: 'select', flash: null,
      })
      persist()
    },

    setName: (name) => {
      set({ name })
      persist()
    },

    setWatermark: (watermark) => {
      set({ watermark })
      persist()
    },

    addBlankPage: (at) => {
      const { pages, currentPageId } = get()
      const cur = pages.findIndex((p) => p.id === currentPageId)
      const pos = at ?? (cur >= 0 ? cur + 1 : pages.length)
      const ref = pages[Math.max(0, pos - 1)]
      const size = ref ? displaySize(ref) : { width: 595.28, height: 841.89 }
      const page: StudioPage = { id: newId(), source: { kind: 'blank', ...size }, rotation: 0, annotations: [] }
      const next = [...pages]
      next.splice(pos, 0, page)
      commit(next, { currentPageId: page.id })
      get().scrollToPage(page.id)
    },

    movePages: (ids, toIndex) => {
      const { pages } = get()
      const moving = pages.filter((p) => ids.includes(p.id))
      if (!moving.length) return
      // Position cible exprimée dans la liste SANS les pages déplacées
      const before = pages.slice(0, toIndex).filter((p) => !ids.includes(p.id)).length
      const rest = pages.filter((p) => !ids.includes(p.id))
      rest.splice(before, 0, ...moving)
      if (rest.every((p, i) => p.id === pages[i].id)) return
      commit(rest)
    },

    deletePages: (ids) => {
      const { pages, currentPageId, selectedAnn } = get()
      const next = pages.filter((p) => !ids.includes(p.id))
      const curIdx = pages.findIndex((p) => p.id === currentPageId)
      commit(next, {
        selectedPageIds: [],
        selectedAnn: selectedAnn && ids.includes(selectedAnn.pageId) ? null : selectedAnn,
        currentPageId: currentPageId && ids.includes(currentPageId)
          ? (next[Math.min(curIdx, next.length - 1)]?.id ?? null)
          : currentPageId,
      })
    },

    rotatePages: (ids, dir) => {
      const next = get().pages.map((p) => {
        if (!ids.includes(p.id)) return p
        // Une rotation de −90° = trois rotations de +90° pour les annotations
        let page = p
        const turns = dir === 1 ? 1 : 3
        for (let t = 0; t < turns; t++) {
          const H = displaySize(page).height
          page = {
            ...page,
            rotation: ((page.rotation + 90) % 360) as UserRotation,
            annotations: page.annotations.map((a) => rotateAnnotation90(a, H)),
            ocr: page.ocr ? { ...page.ocr, words: rotateWords90(page.ocr.words, H) } : undefined,
          }
        }
        return page
      })
      commit(next)
    },

    duplicatePages: (ids) => {
      const next: StudioPage[] = []
      let lastCopy: string | null = null
      for (const p of get().pages) {
        next.push(p)
        if (ids.includes(p.id)) {
          const copy: StudioPage = {
            ...structuredClone(p),
            id: newId(),
          }
          copy.annotations = copy.annotations.map((a) => ({ ...a, id: newId() }))
          next.push(copy)
          lastCopy = copy.id
        }
      }
      commit(next, lastCopy ? { currentPageId: lastCopy } : {})
    },

    setPageBackground: (id, color) => {
      commit(mapPage(id, (p) => (p.source.kind === 'blank' ? { ...p, source: { ...p.source, background: color } } : p)))
    },

    setPageOcr: (id, ocr) => {
      // L'OCR n'est pas une action « annulable » : on ne l'inscrit pas dans l'historique
      set({ pages: mapPage(id, (p) => ({ ...p, ocr })) })
      persist()
    },

    addAnnotation: (pageId, ann) => {
      commit(
        mapPage(pageId, (p) => ({ ...p, annotations: [...p.annotations, { createdAt: Date.now(), ...ann }] })),
        { selectedAnn: { pageId, id: ann.id }, currentPageId: pageId }
      )
    },

    updateAnnotation: (pageId, id, patch) => {
      commit(
        mapPage(pageId, (p) => ({
          ...p,
          annotations: p.annotations.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)),
        })),
        {},
        `${id}:${Object.keys(patch).sort().join(',')}`
      )
    },

    removeAnnotation: (pageId, id) => {
      const { selectedAnn } = get()
      commit(
        mapPage(pageId, (p) => ({ ...p, annotations: p.annotations.filter((a) => a.id !== id) })),
        { selectedAnn: selectedAnn?.id === id ? null : selectedAnn }
      )
    },

    reorderAnnotation: (pageId, id, where) => {
      commit(
        mapPage(pageId, (p) => {
          const ann = p.annotations.find((a) => a.id === id)
          if (!ann) return p
          const rest = p.annotations.filter((a) => a.id !== id)
          return { ...p, annotations: where === 'front' ? [...rest, ann] : [ann, ...rest] }
        })
      )
    },

    copyAnnotation: () => {
      const { selectedAnn, pages } = get()
      if (!selectedAnn) return
      const ann = pages.find((p) => p.id === selectedAnn.pageId)?.annotations.find((a) => a.id === selectedAnn.id)
      if (ann) set({ clipboard: { ann: structuredClone(ann) } })
    },

    pasteAnnotation: (pageId) => {
      const clip = get().clipboard
      if (!clip) return
      const ann = { ...structuredClone(clip.ann), id: newId(), x: clip.ann.x + 12, y: clip.ann.y + 12 } as Annotation
      set({ clipboard: { ann } })
      get().addAnnotation(pageId, ann)
    },

    setTool: (tool) => set({ tool, selectedAnn: null, editingAnn: null }),
    setToolOptions: (o) => {
      const toolOptions = { ...get().toolOptions, ...o }
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(toolOptions))
      set({ toolOptions })
    },
    selectAnnotation: (selectedAnn) => {
      set({ selectedAnn, ...(selectedAnn ? { currentPageId: selectedAnn.pageId } : {}) })
      if (selectedAnn && !get().rightPanel) set({ rightPanel: 'properties' })
    },
    setEditingAnn: (editingAnn) => set({ editingAnn }),
    setCurrentPage: (currentPageId) => {
      if (currentPageId !== get().currentPageId) set({ currentPageId })
    },
    setSelectedPages: (selectedPageIds) => set({ selectedPageIds }),
    setZoom: (zoom) => set({ zoom }),
    setView: (view) => set({ view, selectedAnn: null }),
    setRightPanel: (rightPanel) => set({ rightPanel }),
    toggleThumbnails: () => set({ showThumbnails: !get().showThumbnails }),
    scrollToPage: (pageId, y) =>
      set({ currentPageId: pageId, scrollRequest: { pageId, y, nonce: Date.now() + Math.random() } }),
    flashRects: (pageId, rects) => set({ flash: { pageId, rects, nonce: Date.now() + Math.random() } }),

    undo: () => {
      const { past, pages, future } = get()
      if (!past.length) return
      const prev = past[past.length - 1]
      set({ pages: prev, past: past.slice(0, -1), future: [pages, ...future], selectedAnn: null })
      persist()
    },

    redo: () => {
      const { past, pages, future } = get()
      if (!future.length) return
      const [next, ...rest] = future
      set({ pages: next, past: [...past, pages], future: rest, selectedAnn: null })
      persist()
    },
  }
})

/** Page courante (ou première page). */
export function useCurrentPage(): StudioPage | undefined {
  return useStudio((s) => s.pages.find((p) => p.id === s.currentPageId) ?? s.pages[0])
}

// Accès au store depuis la console en développement (tests manuels/automatisés)
if (import.meta.env.DEV) (window as unknown as { __studio: typeof useStudio }).__studio = useStudio
