import { create } from 'zustand'

export type ModuleId = 'create' | 'edit' | 'merge' | 'split' | 'smart-split' | 'ocr'

export const MODULES: { id: ModuleId; label: string; icon: string }[] = [
  { id: 'create', label: 'Créateur PDF', icon: '📄' },
  { id: 'edit', label: 'Éditeur / Annotateur', icon: '✏️' },
  { id: 'merge', label: 'Fusionneur', icon: '🔗' },
  { id: 'split', label: 'Éclateur', icon: '✂️' },
  { id: 'smart-split', label: 'Splitteur intelligent', icon: '🧠' },
  { id: 'ocr', label: 'OCR', icon: '🔍' },
]

const THEME_KEY = 'pdf-toolkit-theme'

interface AppState {
  activeModule: ModuleId
  theme: string
  setActiveModule: (m: ModuleId) => void
  setTheme: (t: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeModule: 'create',
  theme: localStorage.getItem(THEME_KEY) ?? 'light',
  setActiveModule: (m) => set({ activeModule: m }),
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
