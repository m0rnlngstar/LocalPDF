import { useEffect, useState } from 'react'
import { useStudio } from './store'
import { addFiles, insertionIndex, pickFiles, useBusy, useDialogs } from './actions'
import { TopBar } from './ui/TopBar'
import { Toolbar, ALL_TOOLS } from './ui/Toolbar'
import { Viewer } from './ui/Viewer'
import { Organizer, ThumbnailsSidebar } from './ui/Organizer'
import { RightPanel } from './ui/RightPanel'
import { StartScreen } from './ui/StartScreen'
import { ExportDialog, Modal, NewDocDialog } from './ui/Dialogs'
import { AddPagesDialog } from './ui/AddPagesDialog'
import { BrandMark } from '../components/ui/ModuleIcon'
import { SidebarReopen } from '../components/AppSidebar'
import { ThemeController } from '../components/ui/ThemeController'
import { preloadCanvasFonts } from '../lib/fonts'
import { useAppStore } from '../store/appStore'
import './studio.css'

/**
 * Éditeur PDF tout-en-un : un document de travail unique, des outils
 * (annotation, organisation, OCR, export…) appliqués dans la même vue.
 */

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

function useShortcuts() {
  const openDialog = useDialogs((s) => s.open)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (useAppStore.getState().activeTool) return
      const s = useStudio.getState()
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()

      if (mod && k === 'o') {
        e.preventDefault()
        void pickFiles().then((f) => addFiles(f, 'replace'))
        return
      }
      if (!s.pages.length) return
      if (mod && k === 's') {
        e.preventDefault()
        openDialog('export')
        return
      }
      if (mod && k === 'f') {
        e.preventDefault()
        s.setRightPanel('search')
        return
      }
      if (mod && (k === '+' || k === '=' || k === '-')) {
        e.preventDefault()
        const cur = s.viewScale / (96 / 72)
        s.setZoom(Math.round(Math.min(4, Math.max(0.25, cur * (k === '-' ? 1 / 1.2 : 1.2))) * 100) / 100)
        return
      }
      if (mod && k === '0') {
        e.preventDefault()
        s.setZoom('fit-width')
        return
      }
      if (isTyping(e) || s.editingAnn) return

      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault()
        s.undo()
        return
      }
      if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault()
        s.redo()
        return
      }
      if (mod && k === 'c' && s.selectedAnn) {
        s.copyAnnotation()
        return
      }
      if (mod && k === 'v' && s.clipboard) {
        e.preventDefault()
        const pageId = s.currentPageId ?? s.pages[0].id
        s.pasteAnnotation(pageId)
        return
      }
      if (mod && k === 'a' && s.view === 'organize') {
        e.preventDefault()
        s.setSelectedPages(s.pages.map((p) => p.id))
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedAnn) {
          e.preventDefault()
          s.removeAnnotation(s.selectedAnn.pageId, s.selectedAnn.id)
        } else if (s.view === 'organize' && s.selectedPageIds.length && s.selectedPageIds.length < s.pages.length) {
          e.preventDefault()
          s.deletePages(s.selectedPageIds)
        }
        return
      }
      if (e.key === 'Escape') {
        if (s.selectedAnn) s.selectAnnotation(null)
        else if (s.tool !== 'select') s.setTool('select')
        else s.setSelectedPages([])
        return
      }
      if (s.view === 'read' && (e.key === 'PageDown' || e.key === 'PageUp') && !mod) {
        const i = s.pages.findIndex((p) => p.id === s.currentPageId)
        const next = s.pages[Math.min(s.pages.length - 1, Math.max(0, i + (e.key === 'PageDown' ? 1 : -1)))]
        if (next) {
          e.preventDefault()
          s.scrollToPage(next.id)
        }
        return
      }
      if (!mod && !e.altKey && s.view === 'read') {
        const t = ALL_TOOLS.find((tool) => tool.key.toLowerCase() === k)
        if (t) s.setTool(t.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openDialog])
}

/** Glisser-déposer de fichiers n'importe où dans l'éditeur. */
function useFileDrop() {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    // Inactif quand un outil avancé est ouvert : il gère ses propres dépôts
    const hasFiles = (e: DragEvent) =>
      !useAppStore.getState().activeTool && Array.from(e.dataTransfer?.types ?? []).includes('Files')
    function enter(e: DragEvent) {
      if (!hasFiles(e)) return
      depth++
      setOver(true)
    }
    function leave(e: DragEvent) {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setOver(false)
    }
    function overFn(e: DragEvent) {
      if (hasFiles(e)) e.preventDefault()
    }
    function drop(e: DragEvent) {
      depth = 0
      setOver(false)
      // Déjà traité par une zone de dépôt (écran d'accueil)
      if (!hasFiles(e) || e.defaultPrevented) return
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (!files.length) return
      const s = useStudio.getState()
      if (!s.pages.length) void addFiles(files, 'replace')
      else void addFiles(files, 'insert', insertionIndex())
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overFn)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overFn)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return over
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl + O', 'Ouvrir des fichiers'],
  ['Ctrl + S', 'Exporter'],
  ['Ctrl + Z / Ctrl + Y', 'Annuler / rétablir'],
  ['Ctrl + F', 'Rechercher'],
  ['Ctrl + molette, Ctrl + / −', 'Zoomer'],
  ['Ctrl + 0', 'Pleine largeur'],
  ['Ctrl + C / Ctrl + V', 'Copier / coller une annotation'],
  ['Suppr', 'Supprimer l’annotation (ou les pages sélectionnées)'],
  ['Échap', 'Désélectionner / revenir à l’outil Sélection'],
  ['Page préc. / suiv.', 'Page précédente / suivante'],
  ['Double-clic', 'Modifier un texte, une note ou un tampon'],
  ['Clic molette', 'Faire défiler en glissant'],
  ...ALL_TOOLS.map((t): [string, string] => [t.key, t.label]),
]

/** Au démarrage : reprendre le travail laissé dans ce navigateur, ou repartir de zéro. */
function ResumeDialog() {
  const pending = useStudio((s) => s.pendingResume)
  const resumeSession = useStudio((s) => s.resumeSession)
  const discardSession = useStudio((s) => s.discardSession)
  const count = pending?.pages.length ?? 0
  return (
    <Modal
      open={!!pending}
      onClose={resumeSession}
      title="Reprendre l’édition en cours ?"
      actions={
        <>
          <button className="btn btn-ghost rounded-full" onClick={discardSession}>Non, repartir de zéro</button>
          <button className="btn btn-primary rounded-full" onClick={resumeSession}>Oui, reprendre</button>
        </>
      }
    >
      <p>
        Un document est resté ouvert lors de votre dernière visite :{' '}
        <strong>{pending?.name ?? 'document'}</strong> ({count} page{count > 1 ? 's' : ''}).
      </p>
      <p className="text-sm opacity-70 mt-2">
        « Repartir de zéro » vide l’éditeur. Les fichiers d’origine sur votre poste ne sont pas touchés.
      </p>
    </Modal>
  )
}

export default function Studio() {
  const hydrated = useStudio((s) => s.hydrated)
  const hydrate = useStudio((s) => s.hydrate)
  const hasPages = useStudio((s) => s.pages.length > 0)
  const view = useStudio((s) => s.view)
  const showThumbnails = useStudio((s) => s.showThumbnails)
  const name = useStudio((s) => s.name)
  const busy = useBusy()
  const dialog = useDialogs((s) => s.dialog)
  const openDialog = useDialogs((s) => s.open)
  const dropping = useFileDrop()
  useShortcuts()

  useEffect(() => {
    void hydrate()
    void preloadCanvasFonts()
  }, [hydrate])

  useEffect(() => {
    document.title = hasPages ? `${name} · LocalPDF` : 'LocalPDF — éditeur PDF privé'
  }, [hasPages, name])

  if (!hydrated) {
    return (
      <div className="studio-loading" role="status">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    )
  }

  return (
    <div className="studio">
      {hasPages ? (
        <>
          <TopBar />
          {view === 'read' && <Toolbar />}
          <div className="studio-body">
            {view === 'read' && showThumbnails && <ThumbnailsSidebar />}
            <main className="studio-main" id="main-content">
              {view === 'read' ? <Viewer /> : <Organizer />}
            </main>
            <RightPanel />
          </div>
        </>
      ) : (
        <>
          <header className="studio-topbar is-home">
            <div className="studio-topbar-left">
              <SidebarReopen />
              <BrandMark />
              <strong className="studio-brand">LocalPDF</strong>
            </div>
            <div className="studio-topbar-right">
              <span className="studio-private">🔒 Privé · 100 % local</span>
              <ThemeController />
            </div>
          </header>
          <StartScreen />
        </>
      )}

      {dropping && (
        <div className="studio-drop-overlay">
          <div>{hasPages ? 'Déposez pour insérer les fichiers dans le document' : 'Déposez pour ouvrir les fichiers'}</div>
        </div>
      )}

      {busy.label && (
        <div className="studio-busy" role="status" aria-live="polite">
          <div className="studio-busy-card">
            <span className="loading loading-spinner text-primary" />
            <span>{busy.label}</span>
            {busy.progress !== null && <progress className="progress progress-primary w-48" value={busy.progress} max={1} />}
          </div>
        </div>
      )}

      <ResumeDialog />
      <ExportDialog open={dialog === 'export'} onClose={() => openDialog(null)} />
      <NewDocDialog open={dialog === 'new'} onClose={() => openDialog(null)} />
      <AddPagesDialog open={dialog === 'add-pages'} onClose={() => openDialog(null)} />
      <Modal open={dialog === 'shortcuts'} onClose={() => openDialog(null)} title="Raccourcis clavier" wide>
        <table className="table table-sm">
          <tbody>
            {SHORTCUTS.map(([k, label]) => (
              <tr key={k + label}><td><kbd className="studio-kbd">{k}</kbd></td><td>{label}</td></tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </div>
  )
}
