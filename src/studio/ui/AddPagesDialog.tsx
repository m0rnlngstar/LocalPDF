import { useEffect, useState } from 'react'
import { useStudio } from '../store'
import { addFiles, insertionIndex, useDialogs } from '../actions'
import { ACCEPT } from '../importFiles'
import { PAGE_FORMATS, displaySize, newId, type PageFormatId, type StudioPage } from '../types'
import { Modal } from './Dialogs'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { ColorWell } from '../../components/ui/ColorWell'
import { toast } from '../../components/ui/Toast'
import { IconFilePlus } from '../../components/ui/icons'
import { IconFileText } from './icons'

type AddWhere = 'start' | 'after' | 'end'
type AddKind = 'blank' | 'file'

const PT_TO_MM = 25.4 / 72

/**
 * Ajout de pages : choix de l'emplacement, puis page(s) vierge(s) à créer
 * ou fichiers à importer (PDF, images, Word…).
 */
export function AddPagesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pages = useStudio((s) => s.pages)
  const insertPages = useStudio((s) => s.insertPages)
  const addAt = useDialogs((s) => s.addAt)

  const [kind, setKind] = useState<AddKind>('blank')
  const [where, setWhere] = useState<AddWhere>('after')
  const [afterPage, setAfterPage] = useState(1)
  const [format, setFormat] = useState<PageFormatId | 'same'>('same')
  const [landscape, setLandscape] = useState(false)
  const [count, setCount] = useState(1)
  const [background, setBackground] = useState('#ffffff')

  // À chaque ouverture : position proposée = après la page visée (ou la sélection)
  useEffect(() => {
    if (!open) return
    const idx = addAt ?? insertionIndex()
    const n = useStudio.getState().pages.length
    setWhere(idx >= n ? 'end' : idx <= 0 ? 'start' : 'after')
    setAfterPage(Math.max(1, Math.min(n, idx)))
  }, [open, addAt])

  const at = where === 'start' ? 0 : where === 'end' ? pages.length : Math.max(1, Math.min(pages.length, afterPage))
  const ref = pages[Math.max(0, at - 1)] ?? pages[0]
  const refSize = ref ? displaySize(ref) : { width: PAGE_FORMATS.A4.width, height: PAGE_FORMATS.A4.height }

  function pageSize() {
    if (format === 'same') return refSize
    const f = PAGE_FORMATS[format]
    return landscape ? { width: f.height, height: f.width } : { width: f.width, height: f.height }
  }

  function createBlank() {
    const size = pageSize()
    const custom = background.toLowerCase() !== '#ffffff'
    const created: StudioPage[] = Array.from({ length: count }, () => ({
      id: newId(),
      source: { kind: 'blank' as const, ...size, ...(custom ? { background } : {}) },
      rotation: 0 as const,
      annotations: [],
    }))
    insertPages(created, {}, at)
    toast.success(count > 1 ? `${count} pages vierges ajoutées` : 'Page vierge ajoutée')
    onClose()
  }

  function importAt(files: File[]) {
    if (!files.length) return
    onClose()
    void addFiles(files, 'insert', at)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajouter des pages"
      wide
      actions={
        <>
          <button className="btn btn-ghost rounded-full" onClick={onClose}>Annuler</button>
          {kind === 'blank' && (
            <button className="btn btn-primary rounded-full" onClick={createBlank}>
              {count > 1 ? `Ajouter ${count} pages vierges` : 'Ajouter la page vierge'}
            </button>
          )}
        </>
      }
    >
      <div className="studio-form">
        <fieldset className="studio-field">
          <span>Emplacement</span>
          <div className="studio-radio-row items-center">
            <label>
              <input type="radio" className="radio radio-sm" checked={where === 'start'} onChange={() => setWhere('start')} /> Au début
            </label>
            <label>
              <input type="radio" className="radio radio-sm" checked={where === 'after'} onChange={() => setWhere('after')} /> Après la page
              <input
                type="number"
                className="input input-xs w-16"
                min={1}
                max={pages.length}
                value={afterPage}
                onFocus={() => setWhere('after')}
                onChange={(e) => setAfterPage(Number(e.target.value) || 1)}
              />
              <small className="opacity-60">/ {pages.length}</small>
            </label>
            <label>
              <input type="radio" className="radio radio-sm" checked={where === 'end'} onChange={() => setWhere('end')} /> À la fin
            </label>
          </div>
        </fieldset>

        <div className="studio-choice" role="tablist" aria-label="Type de page">
          <button role="tab" aria-selected={kind === 'blank'} className={kind === 'blank' ? 'is-active' : ''} onClick={() => setKind('blank')}>
            <IconFileText />
            <span><strong>Page vierge</strong><small>Une page à remplir : texte, dessin, images…</small></span>
          </button>
          <button role="tab" aria-selected={kind === 'file'} className={kind === 'file' ? 'is-active' : ''} onClick={() => setKind('file')}>
            <IconFilePlus />
            <span><strong>Importer un fichier</strong><small>PDF, photos (JPG, PNG, HEIC), Word, texte…</small></span>
          </button>
        </div>

        {kind === 'blank' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="studio-field">
                <span>Format</span>
                <select className="select select-sm w-full" value={format} onChange={(e) => setFormat(e.target.value as PageFormatId | 'same')}>
                  <option value="same">
                    Comme la page voisine ({Math.round(refSize.width * PT_TO_MM)} × {Math.round(refSize.height * PT_TO_MM)} mm)
                  </option>
                  {(Object.keys(PAGE_FORMATS) as PageFormatId[]).map((k) => <option key={k} value={k}>{PAGE_FORMATS[k].label}</option>)}
                </select>
              </label>
              <label className="studio-field">
                <span>Nombre de pages</span>
                <input
                  type="number" min={1} max={50} className="input input-sm w-full" value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className={`studio-radio-row ${format === 'same' ? 'opacity-40 pointer-events-none' : ''}`}>
                <label><input type="radio" className="radio radio-sm" checked={!landscape} onChange={() => setLandscape(false)} /> Portrait</label>
                <label><input type="radio" className="radio radio-sm" checked={landscape} onChange={() => setLandscape(true)} /> Paysage</label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                Couleur de fond <ColorWell size="sm" value={background} onChange={setBackground} title="Couleur de fond" />
              </label>
            </div>
          </>
        ) : (
          <FileDropzone
            accept={ACCEPT}
            multiple
            onFiles={importAt}
            title="Fichiers à insérer"
            description="Plusieurs fichiers sont insérés dans l’ordre, à l’emplacement choisi."
            actionLabel="Parcourir…"
            className="studio-add-drop"
          />
        )}
      </div>
    </Modal>
  )
}
