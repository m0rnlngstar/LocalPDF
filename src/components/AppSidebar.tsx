import { useEffect } from 'react'
import { MODULES, useAppStore, type ModuleId } from '../store/appStore'
import { ModuleIcon } from './ui/ModuleIcon'
import { IconFileText } from '../studio/ui/icons'
import { preloadModule } from '../modules/registry'

/**
 * Panneau latéral gauche : retour à l'éditeur et outils avancés. Affiché par
 * défaut, il peut être masqué (préférence mémorisée dans ce navigateur).
 */

const IconPanelClose = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M16 15l-3-3 3-3" />
  </svg>
)
const IconPanelOpen = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M14 9l3 3-3 3" />
  </svg>
)

/** Chargé à la demande : l'export du document n'alourdit pas le démarrage. */
function openWithDocument(id: ModuleId) {
  void import('../studio/actions').then((m) => m.sendDocumentToTool(id))
}

/** Bouton « Outils » à gauche des barres du haut, visible quand le panneau est masqué. */
export function SidebarReopen() {
  const open = useAppStore((s) => s.sidebarOpen)
  const setOpen = useAppStore((s) => s.setSidebarOpen)
  if (open) return null
  return (
    <button className="app-rail-reopen" title="Afficher le panneau des outils" onClick={() => setOpen(true)}>
      <IconPanelOpen /> <span>Outils</span>
    </button>
  )
}

function RailItem({ id }: { id: ModuleId }) {
  const activeTool = useAppStore((s) => s.activeTool)
  const openTool = useAppStore((s) => s.openTool)
  const m = MODULES.find((item) => item.id === id)!
  return (
    <button
      className={`app-rail-item ${activeTool === m.id ? 'is-active' : ''}`}
      title={m.desc}
      onMouseEnter={() => void preloadModule(m.id)}
      onClick={() => {
        if (activeTool === m.id) return
        // Modules rapides : traitement par lot, le document de l'éditeur n'est pas transmis
        if (m.acceptsDocument) openWithDocument(m.id)
        else openTool(m.id)
      }}
    >
      <span className={`nav-icon tone-${m.tone}`}><ModuleIcon module={m.id} /></span>
      <span className="app-rail-label">
        <strong>{m.label}</strong>
        {m.badge && <em>{m.badge}</em>}
      </span>
    </button>
  )
}

export function AppSidebar() {
  const open = useAppStore((s) => s.sidebarOpen)
  const setOpen = useAppStore((s) => s.setSidebarOpen)
  const activeTool = useAppStore((s) => s.activeTool)
  const openTool = useAppStore((s) => s.openTool)

  // Largeur réservée au panneau : l'éditeur et les outils se décalent d'autant
  useEffect(() => {
    document.documentElement.classList.toggle('has-rail', open)
  }, [open])

  if (!open) return null

  return (
    <aside className="app-rail" aria-label="Outils">
      <div className="app-rail-head">
        <span>Outils</span>
        <button className="app-rail-toggle" title="Masquer le panneau" aria-label="Masquer le panneau" onClick={() => setOpen(false)}>
          <IconPanelClose />
        </button>
      </div>

      <nav className="app-rail-nav">
        <button className={`app-rail-item ${activeTool === null ? 'is-active' : ''}`} onClick={() => openTool(null)}>
          <span className="nav-icon tone-violet"><IconFileText /></span>
          <span className="app-rail-label"><strong>Éditeur PDF</strong><small>Lire, annoter, organiser, exporter</small></span>
        </button>

        <p className="app-rail-group">Modules rapides</p>
        {MODULES.filter((m) => m.quick).map((m) => (
          <RailItem key={m.id} id={m.id} />
        ))}

        <p className="app-rail-group">Outils avancés</p>
        {MODULES.filter((m) => !m.quick).map((m) => (
          <RailItem key={m.id} id={m.id} />
        ))}
      </nav>

      <p className="app-rail-note">Outils avancés : le document ouvert dans l’éditeur leur est transmis. Les modules rapides traitent vos fichiers par lot.</p>
    </aside>
  )
}
