import { lazy, Suspense } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MODULES, useAppStore, type ModuleId } from './store/appStore'
import { ThemeController } from './components/ui/ThemeController'
import { ToastContainer } from './components/ui/Toast'

// Chaque module est chargé en lazy : on ne paie pdf.js/tesseract qu'à l'usage.
const moduleComponents: Record<ModuleId, React.LazyExoticComponent<React.ComponentType>> = {
  create: lazy(() => import('./modules/create/CreateModule')),
  edit: lazy(() => import('./modules/edit/EditModule')),
  merge: lazy(() => import('./modules/merge/MergeModule')),
  split: lazy(() => import('./modules/split/SplitModule')),
  'smart-split': lazy(() => import('./modules/smart-split/SmartSplitModule')),
  ocr: lazy(() => import('./modules/ocr/OcrModule')),
}

function LocalBadge() {
  return (
    <div
      className="badge badge-success badge-soft gap-1 whitespace-nowrap rounded-full shrink-0"
      title="Aucun fichier n'est jamais envoyé sur un serveur : tout le traitement se fait dans votre navigateur."
    >
      🔒 100% local
    </div>
  )
}

export default function App() {
  const { activeModule, setActiveModule } = useAppStore()
  const Active = moduleComponents[activeModule]
  const activeMeta = MODULES.find((m) => m.id === activeModule)!

  return (
    <div className="drawer lg:drawer-open min-h-screen">
      <input id="nav-drawer" type="checkbox" className="drawer-toggle" />

      <div className="drawer-content flex flex-col min-h-screen">
        {/* Barre supérieure */}
        <header className="navbar bg-base-100/80 backdrop-blur border-b border-base-300/50 sticky top-0 z-40 min-h-12">
          <div className="flex-none lg:hidden">
            <label htmlFor="nav-drawer" aria-label="Ouvrir le menu" className="btn btn-square btn-ghost btn-sm">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
              </svg>
            </label>
          </div>
          <div className="flex-1 flex items-center gap-3 px-2 min-w-0">
            <span className="text-lg font-semibold truncate">
              {activeMeta.icon} {activeMeta.label}
            </span>
            <LocalBadge />
          </div>
          <div className="flex-none">
            <ThemeController />
          </div>
        </header>

        {/* Contenu du module actif, avec transition animée */}
        <main className="flex-1 p-3 sm:p-5 overflow-x-hidden bg-base-200/40">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeModule}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.18 }}
              className="h-full"
            >
              <Suspense
                fallback={
                  <div className="flex justify-center items-center h-64">
                    <span className="loading loading-spinner loading-lg text-primary" />
                  </div>
                }
              >
                <Active />
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Menu latéral */}
      <div className="drawer-side z-50">
        <label htmlFor="nav-drawer" aria-label="Fermer le menu" className="drawer-overlay" />
        <aside className="bg-base-200 min-h-full w-64 flex flex-col">
          <div className="p-4 pb-2">
            <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              PDF Toolkit
            </h1>
            <p className="text-xs text-base-content/60 mt-1">
              Vos fichiers ne quittent jamais votre navigateur.
            </p>
          </div>
          <ul className="menu w-full flex-1 gap-1 px-3">
            {MODULES.map((m) => (
              <li key={m.id}>
                <button
                  className={`rounded-xl transition-colors ${activeModule === m.id ? 'menu-active' : ''}`}
                  onClick={() => {
                    setActiveModule(m.id)
                    const drawer = document.getElementById('nav-drawer') as HTMLInputElement | null
                    if (drawer) drawer.checked = false
                  }}
                >
                  <span className="text-base">{m.icon}</span> {m.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="p-4">
            <LocalBadge />
          </div>
        </aside>
      </div>

      <ToastContainer />
    </div>
  )
}
