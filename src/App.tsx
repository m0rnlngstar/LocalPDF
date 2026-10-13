import { Suspense, lazy } from 'react'
import { MODULES, useAppStore } from './store/appStore'
import { ToastContainer } from './components/ui/Toast'
import { ModuleIcon } from './components/ui/ModuleIcon'
import { moduleComponents } from './modules/registry'
import { IconArrowLeft } from './studio/ui/icons'

// L'éditeur est l'écran principal ; chargé en lazy pour afficher vite le squelette.
const Studio = lazy(() => import('./studio/Studio'))

function Loading() {
  return (
    <div className="studio-loading" role="status" aria-label="Chargement">
      <span className="loading loading-spinner loading-lg text-primary" />
    </div>
  )
}

/** Outil avancé ouvert par-dessus l'éditeur (qui reste monté en dessous). */
function ToolOverlay() {
  const activeTool = useAppStore((s) => s.activeTool)
  const openTool = useAppStore((s) => s.openTool)
  if (!activeTool) return null
  const meta = MODULES.find((m) => m.id === activeTool)!
  const Active = moduleComponents[activeTool]
  return (
    <div className="tool-overlay" role="dialog" aria-modal="true" aria-label={meta.label}>
      <header className="tool-overlay-head">
        <button className="btn btn-sm btn-ghost rounded-full gap-1.5" onClick={() => openTool(null)}>
          <IconArrowLeft /> Retour à l’éditeur
        </button>
        <span className={`nav-icon tone-${meta.tone}`}><ModuleIcon module={meta.id} /></span>
        <h2>{meta.label}</h2>
        {meta.badge && <span className="badge badge-soft badge-primary badge-sm">{meta.badge}</span>}
      </header>
      <main className="tool-overlay-body module-surface">
        <Suspense fallback={<Loading />}>
          <div key={activeTool} className="module-fade-in">
            <Active />
          </div>
        </Suspense>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <>
      <Suspense fallback={<Loading />}>
        <Studio />
      </Suspense>
      <ToolOverlay />
      <ToastContainer />
    </>
  )
}
