import { create } from 'zustand'

export type ModuleId =
  | 'home' | 'create' | 'edit' | 'merge' | 'split'
  | 'smart-split' | 'ocr' | 'facturx' | 'docchat'

export const MODULES: { id: ModuleId; label: string; icon: string; desc: string }[] = [
  { id: 'home', label: 'Accueil', icon: '🏠', desc: 'Tableau de bord des outils' },
  {
    id: 'create', label: 'Créateur PDF', icon: '📄',
    desc: 'Créez un PDF de zéro : texte, images, formes, filigrane, multi-pages.',
  },
  {
    id: 'edit', label: 'Éditeur / Annotateur', icon: '✏️',
    desc: 'Réorganisez les pages, surlignez, tamponnez, signez et annotez un PDF existant.',
  },
  {
    id: 'merge', label: 'Fusionneur', icon: '🔗',
    desc: 'Assemblez plusieurs PDF et images en un seul document, dans l’ordre voulu.',
  },
  {
    id: 'split', label: 'Éclateur', icon: '✂️',
    desc: 'Découpez un PDF par plages de pages, ou une page par fichier.',
  },
  {
    id: 'smart-split', label: 'Splitteur intelligent', icon: '🧠',
    desc: 'Retrouvez les documents individuels d’un scan en vrac : OCR, motifs, pages blanches et IA locale.',
  },
  {
    id: 'ocr', label: 'OCR', icon: '🔍',
    desc: 'Extrayez le texte d’un scan ou d’une photo, et exportez un PDF cherchable.',
  },
  {
    id: 'facturx', label: 'Vérificateur Factur-X', icon: '🧾',
    desc: 'Contrôlez la conformité d’une facture électronique et lisez ses données embarquées.',
  },
  {
    id: 'docchat', label: 'Interroger un document', icon: '💬',
    desc: 'Posez vos questions sur un PDF à une IA 100 % locale — rien ne quitte votre machine.',
  },
]

const THEME_KEY = 'pdf-toolkit-theme'

interface AppState {
  activeModule: ModuleId
  theme: string
  setActiveModule: (m: ModuleId) => void
  setTheme: (t: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeModule: 'home',
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
