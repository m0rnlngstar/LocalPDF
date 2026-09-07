import { create } from 'zustand'

export type ModuleId =
  | 'home' | 'scanner' | 'create' | 'convert' | 'edit' | 'merge' | 'split' | 'compress'
  | 'smart-split' | 'smart-merge' | 'ocr' | 'facturx' | 'docchat'

export type ModuleTone = 'violet' | 'blue' | 'cyan' | 'emerald' | 'amber' | 'rose'

export interface ModuleMeta {
  id: ModuleId
  label: string
  desc: string
  category: 'Créer' | 'Organiser' | 'Analyser' | 'IA locale' | 'Général'
  tone: ModuleTone
  badge?: string
}

export const MODULES: ModuleMeta[] = [
  {
    id: 'home', label: 'Accueil', category: 'Général', tone: 'violet',
    desc: 'Retrouvez tous vos outils PDF',
  },
  {
    id: 'scanner', label: 'Scanner un document', category: 'Créer', tone: 'emerald', badge: 'Nouveau',
    desc: 'Photographiez plusieurs pages, améliorez-les et créez un PDF recherchable avec OCR local.',
  },
  {
    id: 'create', label: 'Créateur PDF', category: 'Créer', tone: 'violet',
    desc: 'Créez un PDF de zéro : texte, images, formes, filigrane, multi-pages.',
  },
  {
    id: 'convert', label: 'Convertisseur PDF', category: 'Créer', tone: 'amber', badge: 'Nouveau',
    desc: 'Transformez JPG, PNG, HEIC, DOCX, TXT ou Markdown en un seul PDF, dans l’ordre voulu.',
  },
  {
    id: 'edit', label: 'Éditeur / Annotateur', category: 'Créer', tone: 'blue', badge: 'Populaire',
    desc: 'Réorganisez les pages, surlignez, tamponnez, signez et annotez un PDF existant.',
  },
  {
    id: 'merge', label: 'Fusionner des PDF', category: 'Organiser', tone: 'cyan',
    desc: 'Assemblez plusieurs PDF et images en un seul document, dans l’ordre voulu.',
  },
  {
    id: 'split', label: 'Découper un PDF', category: 'Organiser', tone: 'emerald',
    desc: 'Découpez par pages ou isolez plusieurs tickets dans une même feuille.',
  },
  {
    id: 'compress', label: 'Compresser un PDF', category: 'Organiser', tone: 'rose', badge: 'Nouveau',
    desc: 'Réduisez le poids d’un PDF en ré-encodant ses images, sans rien envoyer sur un serveur.',
  },
  {
    id: 'smart-split', label: 'Découpage intelligent', category: 'IA locale', tone: 'violet', badge: 'IA locale',
    desc: 'Retrouvez les documents individuels d’un scan en vrac : OCR, motifs, pages blanches et IA locale.',
  },
  {
    id: 'smart-merge', label: 'Fusion intelligente', category: 'IA locale', tone: 'cyan', badge: 'IA locale',
    desc: 'Réassemblez des fichiers scannés dans le bon ordre : numéros de page, chaînage visuel et IA locale.',
  },
  {
    id: 'ocr', label: 'Reconnaissance OCR', category: 'Analyser', tone: 'amber',
    desc: 'Extrayez le texte d’un scan ou d’une photo, et exportez un PDF cherchable.',
  },
  {
    id: 'facturx', label: 'Vérifier Factur-X', category: 'Analyser', tone: 'rose', badge: 'Conformité',
    desc: 'Contrôlez la conformité d’une facture électronique et lisez ses données embarquées.',
  },
  {
    id: 'docchat', label: 'Interroger un document', category: 'IA locale', tone: 'blue', badge: 'IA locale',
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
