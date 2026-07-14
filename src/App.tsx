import { lazy, Suspense, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MODULES, useAppStore, type ModuleId } from './store/appStore'
import { ThemeController } from './components/ui/ThemeController'
import { ToastContainer } from './components/ui/Toast'
import { BrandMark, ModuleIcon } from './components/ui/ModuleIcon'

// Chaque module est chargé en lazy : on ne paie pdf.js/tesseract qu'à l'usage.
const moduleComponents: Record<ModuleId, React.LazyExoticComponent<React.ComponentType>> = {
  home: lazy(() => import('./modules/home/Dashboard')),
  docchat: lazy(() => import('./modules/docchat/DocChatModule')),
  create: lazy(() => import('./modules/create/CreateModule')),
  edit: lazy(() => import('./modules/edit/EditModule')),
  merge: lazy(() => import('./modules/merge/MergeModule')),
  split: lazy(() => import('./modules/split/SplitModule')),
  'smart-split': lazy(() => import('./modules/smart-split/SmartSplitModule')),
  ocr: lazy(() => import('./modules/ocr/OcrModule')),
  facturx: lazy(() => import('./modules/facturx/FacturXModule')),
}

function LocalBadge() {
  return (
    <div
      className="local-badge"
      title="Aucun fichier n'est jamais envoyé sur un serveur : tout le traitement se fait dans votre navigateur."
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
        <rect x="5" y="10" width="14" height="10" rx="3" />
        <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
        <path d="m10 15 1.5 1.5L14.5 13" />
      </svg>
      <span><strong>Privé</strong> · 100 % local</span>
    </div>
  )
}

const NAV_GROUPS: { label: string; modules: ModuleId[] }[] = [
  { label: 'Espace de travail', modules: ['home'] },
  { label: 'Créer et organiser', modules: ['create', 'edit', 'merge', 'split'] },
  { label: 'Comprendre et contrôler', modules: ['ocr', 'smart-split', 'docchat', 'facturx'] },
]

function LoadingModule() {
  return (
    <div className="module-loading" role="status" aria-label="Chargement de l’outil">
      <div className="skeleton h-8 w-52" />
      <div className="skeleton h-4 w-80 max-w-full" />
      <div className="skeleton h-52 w-full mt-5" />
    </div>
  )
}

export default function App() {
  const { activeModule, setActiveModule } = useAppStore()
  const Active = moduleComponents[activeModule]
  const activeMeta = MODULES.find((m) => m.id === activeModule)!

  useEffect(() => {
    document.title = activeModule === 'home'
      ? 'LocalPDF — vos PDF restent privés'
      : `${activeMeta.label} · LocalPDF`
  }, [activeMeta.label, activeModule])

  return (
    <div className="drawer lg:drawer-open min-h-screen app-shell">
      <input id="nav-drawer" type="checkbox" className="drawer-toggle" />

      <a href="#main-content" className="skip-link">Aller au contenu</a>

      <div className="drawer-content flex flex-col min-h-screen">
        <header className="app-header sticky top-0 z-40">
          <div className="flex-none lg:hidden">
            <label htmlFor="nav-drawer" aria-label="Ouvrir le menu" className="btn btn-square btn-ghost btn-sm app-menu-button">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
              </svg>
            </label>
          </div>
          <div className="flex-1 flex items-center gap-3 min-w-0">
            <BrandMark className="lg:hidden" />
            <div className="min-w-0">
              <div className="app-breadcrumb hidden sm:flex">
                <span>LocalPDF</span>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
                <span>{activeMeta.category}</span>
              </div>
              <h2 className="app-page-title truncate">{activeMeta.label}</h2>
            </div>
          </div>
          <div className="flex-none flex items-center gap-2 sm:gap-3">
            <div className="hidden md:block"><LocalBadge /></div>
            <ThemeController />
          </div>
        </header>

        <main id="main-content" className="flex-1 overflow-x-hidden app-main-surface">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeModule}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.18 }}
              className="h-full module-surface"
            >
              <Suspense fallback={<LoadingModule />}>
                <Active />
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <div className="drawer-side z-50">
        <label htmlFor="nav-drawer" aria-label="Fermer le menu" className="drawer-overlay" />
        <aside className="app-sidebar min-h-full w-[17.5rem] flex flex-col">
          <div className="brand-lockup">
            <BrandMark />
            <div>
              <h1>LocalPDF</h1>
              <p>L’atelier PDF privé</p>
            </div>
          </div>

          <nav aria-label="Navigation principale" className="app-nav">
            {NAV_GROUPS.map((group) => (
              <div className="nav-group" key={group.label}>
                <p className="nav-group-label">{group.label}</p>
                <ul>
                  {group.modules.map((id) => {
                    const m = MODULES.find((item) => item.id === id)!
                    const isActive = activeModule === m.id
                    return (
                      <li key={m.id}>
                        <button
                          className={`nav-item ${isActive ? 'is-active' : ''}`}
                          aria-current={isActive ? 'page' : undefined}
                          onClick={() => {
                            setActiveModule(m.id)
                            const drawer = document.getElementById('nav-drawer') as HTMLInputElement | null
                            if (drawer) drawer.checked = false
                          }}
                        >
                          <span className={`nav-icon tone-${m.tone}`}><ModuleIcon module={m.id} /></span>
                          <span>{m.label}</span>
                          {m.badge === 'IA locale' && <span className="nav-ai-dot" title="Fonction IA locale" />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <div className="sidebar-privacy">
            <div className="privacy-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6Z" />
                <path d="m8.5 12 2.2 2.2 4.8-5" />
              </svg>
            </div>
            <div>
              <strong>Vos fichiers restent ici</strong>
              <p>Aucun transfert vers un serveur.</p>
            </div>
          </div>
        </aside>
      </div>

      <ToastContainer />
    </div>
  )
}
