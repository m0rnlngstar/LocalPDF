import { useStudio } from '../store'
import { useDialogs } from '../actions'
import { PageSorter } from './PageSorter'
import { IconCopy, IconDownload, IconPlus, IconRotate, IconTrash } from '../../components/ui/icons'
import { IconRotateLeft } from './icons'

/** Vue « Pages » : grille de toutes les pages, sélection multiple, actions groupées. */
export function Organizer() {
  const pages = useStudio((s) => s.pages)
  const selected = useStudio((s) => s.selectedPageIds)
  const setSelectedPages = useStudio((s) => s.setSelectedPages)
  const rotatePages = useStudio((s) => s.rotatePages)
  const deletePages = useStudio((s) => s.deletePages)
  const duplicatePages = useStudio((s) => s.duplicatePages)
  const openDialog = useDialogs((s) => s.open)
  const openAddPages = useDialogs((s) => s.openAddPages)
  const n = selected.length

  return (
    <div className="studio-organizer">
      <div className="studio-organizer-bar">
        <span className="studio-organizer-count">
          {n ? `${n} page${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''}` : `${pages.length} page${pages.length > 1 ? 's' : ''}`}
        </span>
        <button className="btn btn-xs btn-ghost rounded-full" onClick={() => setSelectedPages(n === pages.length ? [] : pages.map((p) => p.id))}>
          {n === pages.length ? 'Tout désélectionner' : 'Tout sélectionner'}
        </button>
        <span className="studio-sep" />
        <button className="btn btn-xs rounded-full gap-1" disabled={!n} onClick={() => rotatePages(selected, -1)}><IconRotateLeft /> Gauche</button>
        <button className="btn btn-xs rounded-full gap-1" disabled={!n} onClick={() => rotatePages(selected, 1)}><IconRotate /> Droite</button>
        <button className="btn btn-xs rounded-full gap-1" disabled={!n} onClick={() => duplicatePages(selected)}><IconCopy /> Dupliquer</button>
        <button className="btn btn-xs rounded-full gap-1 btn-error btn-soft" disabled={!n || n === pages.length} onClick={() => deletePages(selected)}><IconTrash /> Supprimer</button>
        <button className="btn btn-xs rounded-full gap-1" disabled={!n} onClick={() => openDialog('export')}><IconDownload /> Extraire</button>
        <span className="studio-sep" />
        <button className="btn btn-xs btn-primary rounded-full gap-1" onClick={() => openAddPages()}><IconPlus /> Ajouter des pages</button>
      </div>
      <p className="studio-organizer-hint">
        Glissez les pages pour les réordonner — Ctrl/Maj + clic pour en sélectionner plusieurs et les déplacer ensemble.
        Double-clic pour ouvrir une page. Le « + » d’une miniature ajoute une page juste après.
      </p>
      <PageSorter variant="grid" />
    </div>
  )
}

export function ThumbnailsSidebar() {
  const pages = useStudio((s) => s.pages)
  const openAddPages = useDialogs((s) => s.openAddPages)
  return (
    <aside className="studio-thumbs" aria-label="Miniatures des pages">
      <div className="studio-thumbs-head">
        <span>{pages.length} page{pages.length > 1 ? 's' : ''}</span>
        <div className="flex gap-0.5">
          <button className="studio-icon-btn is-sm" title="Ajouter des pages (vierges ou fichiers)" onClick={() => openAddPages()}><IconPlus /></button>
        </div>
      </div>
      <PageSorter variant="list" />
    </aside>
  )
}
