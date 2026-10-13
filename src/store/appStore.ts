import { create } from 'zustand'

/**
 * Outils avancés : modules autonomes ouverts PAR-DESSUS l'éditeur (Studio).
 * Les fonctions courantes (éditer, annoter, organiser, fusionner, convertir,
 * compresser, OCR) sont intégrées directement à l'éditeur.
 */
export type ModuleId =
  | 'scanner' | 'split' | 'smart-split' | 'smart-merge' | 'facturx' | 'docchat'

export type ModuleTone = 'violet' | 'blue' | 'cyan' | 'emerald' | 'amber' | 'rose'

export interface ModuleMeta {
  id: ModuleId
  label: string
  desc: string
  tone: ModuleTone
  badge?: string
  /** L'outil peut recevoir le document ouvert dans l'éditeur. */
  acceptsDocument: boolean
}

export const MODULES: ModuleMeta[] = [
  {
    id: 'scanner', label: 'Scanner un document', tone: 'emerald', acceptsDocument: false,
    desc: 'Photographiez plusieurs pages, redressez-les et créez un PDF recherchable.',
  },
  {
    id: 'split', label: 'Isoler des tickets', tone: 'emerald', acceptsDocument: true,
    desc: 'Découpez plusieurs tickets ou reçus présents sur une même feuille.',
  },
  {
    id: 'smart-split', label: 'Découpage intelligent', tone: 'violet', badge: 'IA locale', acceptsDocument: true,
    desc: 'Retrouvez les documents individuels d’un scan en vrac (OCR, motifs, IA locale).',
  },
  {
    id: 'smart-merge', label: 'Fusion intelligente', tone: 'cyan', badge: 'IA locale', acceptsDocument: true,
    desc: 'Réassemblez des fichiers scannés dans le bon ordre automatiquement.',
  },
  {
    id: 'facturx', label: 'Vérifier Factur-X', tone: 'rose', badge: 'Conformité', acceptsDocument: true,
    desc: 'Contrôlez une facture électronique et lisez ses données embarquées.',
  },
  {
    id: 'docchat', label: 'Interroger le document', tone: 'blue', badge: 'IA locale', acceptsDocument: true,
    desc: 'Posez vos questions sur le PDF à une IA 100 % locale.',
  },
]

const THEME_KEY = 'pdf-toolkit-theme'
const SIDEBAR_KEY = 'localpdf-sidebar-open'

function readSidebar(): boolean {
  try {
    // Affiché par défaut ; replié d'office sur petit écran
    const saved = localStorage.getItem(SIDEBAR_KEY)
    return saved === null ? window.innerWidth >= 900 : saved === '1'
  } catch {
    return true
  }
}

interface AppState {
  /** Outil avancé ouvert en surimpression (null = éditeur seul). */
  activeTool: ModuleId | null
  theme: string
  /** Panneau latéral des outils avancés affiché. */
  sidebarOpen: boolean
  openTool: (m: ModuleId | null) => void
  setSidebarOpen: (open: boolean) => void
  setTheme: (t: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeTool: null,
  theme: localStorage.getItem(THEME_KEY) ?? 'light',
  sidebarOpen: readSidebar(),
  openTool: (activeTool) => set({ activeTool }),
  setSidebarOpen: (sidebarOpen) => {
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? '1' : '0')
    } catch {
      // préférence non mémorisée
    }
    set({ sidebarOpen })
  },
  setTheme: (t) => {
    localStorage.setItem(THEME_KEY, t)
    document.documentElement.setAttribute('data-theme', t)
    set({ theme: t })
  },
}))

// Applique le thème persisté dès le chargement
document.documentElement.setAttribute(
  'data-theme',
  localStorage.getItem(THEME_KEY) ?? 'light'
)
