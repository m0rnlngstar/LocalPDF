import { useEffect, useState } from 'react'
import { useStudio } from '../store'
import { addFiles, pickFiles, sendDocumentToTool, useDialogs } from '../actions'
import { MODULES } from '../../store/appStore'
import { BrandMark, ModuleIcon } from '../../components/ui/ModuleIcon'
import { ThemeController } from '../../components/ui/ThemeController'
import { IconDownload, IconFilePlus, IconGrid, IconPlus, IconX } from '../../components/ui/icons'
import { clearCacheAndReload } from '../../lib/storage'
import {
  IconBook, IconComments, IconFolderOpen, IconMaximize, IconRedo, IconScanText, IconSearch, IconSidebar,
  IconUndo, IconWand, IconZoomIn, IconZoomOut,
} from './icons'
import { PT_TO_PX } from './Viewer'

function closeMenus() {
  ;(document.activeElement as HTMLElement | null)?.blur()
}

function MenuItem({ onClick, children, kbd, disabled }: { onClick: () => void; children: React.ReactNode; kbd?: string; disabled?: boolean }) {
  return (
    <li>
      <button
        disabled={disabled}
        className={disabled ? 'opacity-40 pointer-events-none' : ''}
        onClick={() => {
          closeMenus()
          onClick()
        }}
      >
        <span className="flex-1 text-left">{children}</span>
        {kbd && <kbd className="studio-kbd">{kbd}</kbd>}
      </button>
    </li>
  )
}

export function FileMenu() {
  const hasPages = useStudio((s) => s.pages.length > 0)
  const closeDocument = useStudio((s) => s.closeDocument)
  const openDialog = useDialogs((s) => s.open)
  const openAddPages = useDialogs((s) => s.openAddPages)

  return (
    <div className="dropdown">
      <button tabIndex={0} className="studio-menu-trigger">Fichier</button>
      <ul tabIndex={0} className="dropdown-content menu studio-menu z-50">
        <MenuItem kbd="Ctrl+O" onClick={() => void pickFiles().then((f) => addFiles(f, 'replace'))}>
          <IconFolderOpen /> Ouvrir…
        </MenuItem>
        <MenuItem onClick={() => openDialog('new')}><IconPlus /> Nouveau document vierge…</MenuItem>
        <li className="menu-title">Ajouter au document</li>
        <MenuItem disabled={!hasPages} onClick={() => openAddPages()}>
          <IconFilePlus /> Ajouter des pages (vierges ou fichiers)…
        </MenuItem>
        <li className="menu-title">Enregistrer</li>
        <MenuItem kbd="Ctrl+S" disabled={!hasPages} onClick={() => openDialog('export')}>
          <IconDownload /> Exporter / découper / compresser…
        </MenuItem>
        <li className="menu-title">Session</li>
        <MenuItem disabled={!hasPages} onClick={() => window.confirm('Fermer le document ? Les modifications non exportées seront perdues.') && closeDocument()}>
          <IconX /> Fermer le document
        </MenuItem>
        <MenuItem onClick={() => window.confirm('Vider le cache ? Tous les fichiers et travaux en cours seront supprimés de ce navigateur.') && void clearCacheAndReload()}>
          Vider le cache local
        </MenuItem>
        <MenuItem onClick={() => openDialog('shortcuts')}>Raccourcis clavier</MenuItem>
      </ul>
    </div>
  )
}

export function ToolsMenu() {
  return (
    <div className="dropdown dropdown-end">
      <button tabIndex={0} className="studio-menu-trigger"><IconWand /> <span className="hidden md:inline">Outils avancés</span></button>
      <ul tabIndex={0} className="dropdown-content studio-menu studio-tools-menu z-50">
        {MODULES.map((m) => (
          <li key={m.id}>
            <button
              onClick={() => {
                closeMenus()
                void sendDocumentToTool(m.id)
              }}
            >
              <span className={`nav-icon tone-${m.tone}`}><ModuleIcon module={m.id} /></span>
              <span className="flex-1 text-left">
                <strong>{m.label}</strong>
                {m.badge && <em className="studio-badge">{m.badge}</em>}
                <small>{m.desc}</small>
              </span>
            </button>
          </li>
        ))}
        <li className="studio-tools-note">Le document ouvert est transmis à l’outil choisi.</li>
      </ul>
    </div>
  )
}

function PageNav() {
  const pages = useStudio((s) => s.pages)
  const currentPageId = useStudio((s) => s.currentPageId)
  const scrollToPage = useStudio((s) => s.scrollToPage)
  const index = Math.max(0, pages.findIndex((p) => p.id === currentPageId))
  const [draft, setDraft] = useState(String(index + 1))
  useEffect(() => setDraft(String(index + 1)), [index])
  return (
    <form
      className="studio-pagenav"
      onSubmit={(e) => {
        e.preventDefault()
        const n = Math.min(pages.length, Math.max(1, Number(draft) || 1))
        scrollToPage(pages[n - 1].id)
      }}
    >
      <input aria-label="Page" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => setDraft(String(index + 1))} />
      <span>/ {pages.length}</span>
    </form>
  )
}

function ZoomControl() {
  const zoom = useStudio((s) => s.zoom)
  const viewScale = useStudio((s) => s.viewScale)
  const setZoom = useStudio((s) => s.setZoom)
  const pct = Math.round((viewScale / PT_TO_PX) * 100)
  const step = (dir: 1 | -1) => {
    const cur = viewScale / PT_TO_PX
    const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]
    const next = dir > 0 ? steps.find((s) => s > cur + 0.01) ?? 4 : [...steps].reverse().find((s) => s < cur - 0.01) ?? 0.25
    setZoom(next)
  }
  return (
    <div className="studio-zoom">
      <button title="Zoom arrière (Ctrl -)" onClick={() => step(-1)}><IconZoomOut /></button>
      <div className="dropdown dropdown-center">
        <button tabIndex={0} className="studio-zoom-value" title="Niveau de zoom">{pct} %</button>
        <ul tabIndex={0} className="dropdown-content menu studio-menu z-50 w-44">
          <MenuItem onClick={() => setZoom('fit-width')}>{zoom === 'fit-width' ? '✓ ' : ''}Pleine largeur</MenuItem>
          <MenuItem onClick={() => setZoom('fit-page')}>{zoom === 'fit-page' ? '✓ ' : ''}Page entière</MenuItem>
          {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((z) => (
            <MenuItem key={z} onClick={() => setZoom(z)}>{zoom === z ? '✓ ' : ''}{Math.round(z * 100)} %</MenuItem>
          ))}
        </ul>
      </div>
      <button title="Zoom avant (Ctrl +)" onClick={() => step(1)}><IconZoomIn /></button>
      <button title="Ajuster à la largeur" onClick={() => setZoom(zoom === 'fit-width' ? 'fit-page' : 'fit-width')}><IconMaximize /></button>
    </div>
  )
}

export function TopBar() {
  const name = useStudio((s) => s.name)
  const setName = useStudio((s) => s.setName)
  const view = useStudio((s) => s.view)
  const setView = useStudio((s) => s.setView)
  const canUndo = useStudio((s) => s.past.length > 0)
  const canRedo = useStudio((s) => s.future.length > 0)
  const undo = useStudio((s) => s.undo)
  const redo = useStudio((s) => s.redo)
  const rightPanel = useStudio((s) => s.rightPanel)
  const setRightPanel = useStudio((s) => s.setRightPanel)
  const showThumbnails = useStudio((s) => s.showThumbnails)
  const toggleThumbnails = useStudio((s) => s.toggleThumbnails)
  const openDialog = useDialogs((s) => s.open)

  const togglePanel = (p: Exclude<typeof rightPanel, null>) => setRightPanel(rightPanel === p ? null : p)

  return (
    <header className="studio-topbar">
      <div className="studio-topbar-left">
        <BrandMark />
        <div className="studio-docname">
          <input value={name} aria-label="Nom du document" onChange={(e) => setName(e.target.value)} spellCheck={false} />
          <nav className="studio-menubar">
            <FileMenu />
          </nav>
        </div>
      </div>

      <div className="studio-topbar-center">
        <div className="studio-segmented" role="tablist" aria-label="Vue">
          <button role="tab" aria-selected={view === 'read'} className={view === 'read' ? 'is-active' : ''} onClick={() => setView('read')}>
            <IconBook /> <span>Lecture</span>
          </button>
          <button role="tab" aria-selected={view === 'organize'} className={view === 'organize' ? 'is-active' : ''} onClick={() => setView('organize')}>
            <IconGrid /> <span>Pages</span>
          </button>
        </div>
        {view === 'read' && (
          <>
            <button className={`studio-icon-btn ${showThumbnails ? 'is-active' : ''}`} title="Miniatures" onClick={toggleThumbnails}><IconSidebar /></button>
            <PageNav />
            <ZoomControl />
          </>
        )}
      </div>

      <div className="studio-topbar-right">
        <button className="studio-icon-btn" title="Annuler (Ctrl+Z)" disabled={!canUndo} onClick={undo}><IconUndo /></button>
        <button className="studio-icon-btn" title="Rétablir (Ctrl+Y)" disabled={!canRedo} onClick={redo}><IconRedo /></button>
        <span className="studio-sep" />
        <button className={`studio-icon-btn ${rightPanel === 'search' ? 'is-active' : ''}`} title="Rechercher (Ctrl+F)" onClick={() => togglePanel('search')}><IconSearch /></button>
        <button className={`studio-icon-btn ${rightPanel === 'comments' ? 'is-active' : ''}`} title="Commentaires" onClick={() => togglePanel('comments')}><IconComments /></button>
        <button className={`studio-icon-btn ${rightPanel === 'ocr' ? 'is-active' : ''}`} title="OCR (reconnaissance de texte)" onClick={() => togglePanel('ocr')}><IconScanText /></button>
        <ToolsMenu />
        <button className="btn btn-primary btn-sm rounded-full gap-1.5" onClick={() => openDialog('export')}>
          <IconDownload /> <span className="hidden sm:inline">Exporter</span>
        </button>
        <ThemeController />
      </div>
    </header>
  )
}
