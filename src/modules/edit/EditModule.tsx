import { useEffect, useRef, useState } from 'react'
import { useEditStore } from './store'
import { PageGrid } from './PageGrid'
import { Annotator } from './Annotator'
import { buildEditedPdf } from './exportPdf'
import { downloadBytes } from '../create/exportPdf'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { toast } from '../../components/ui/Toast'
import {
  IconDownload, IconEdit, IconFilePlus, IconGrid, IconPlus, IconUpload, IconX,
} from '../../components/ui/icons'

export default function EditModule() {
  const {
    pages, hydrated, hydrate, view, setView, loadPdf, addBlankPage,
    addImagePage, currentPageId, reset,
  } = useEditStore()
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  /** Position d'insertion : après la page courante, sinon à la fin. */
  function insertIndex(): number {
    const idx = pages.findIndex((p) => p.id === currentPageId)
    return idx >= 0 ? idx + 1 : pages.length
  }

  async function handlePdfFiles(files: File[], insertAt?: number) {
    setBusy(true)
    try {
      for (const file of files) {
        const count = await loadPdf(file, insertAt)
        toast.success(`${count} page${count > 1 ? 's' : ''} importée${count > 1 ? 's' : ''} depuis ${file.name}`)
      }
    } catch (err) {
      console.error(err)
      toast.error("Impossible de lire ce PDF")
    } finally {
      setBusy(false)
    }
  }

  function handleImageFile(file: File | undefined, insertAt?: number) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const img = new Image()
      img.onload = () => {
        // Une image devient une page à sa taille, plafonnée à la largeur A4
        const ratio = Math.min(1, 595.28 / img.width)
        addImagePage(dataUrl, img.width * ratio, img.height * ratio, insertAt)
        toast.success('Image insérée comme page')
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  async function handleExport() {
    setExporting(true)
    try {
      const { pages, docs } = useEditStore.getState()
      const bytes = await buildEditedPdf(pages, docs)
      downloadBytes(bytes, 'document-edite.pdf')
      toast.success('PDF exporté !')
    } catch (err) {
      console.error(err)
      toast.error("Échec de l'export PDF")
    } finally {
      setExporting(false)
    }
  }

  if (!hydrated) {
    return (
      <div className="flex justify-center items-center h-64">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    )
  }

  if (pages.length === 0) {
    return (
      <div className="max-w-xl mx-auto mt-6 sm:mt-16">
        <FileDropzone
          accept="application/pdf"
          multiple
          onFiles={(files) => void handlePdfFiles(files)}
          className="bg-base-100 shadow-xl py-16"
          title="Déposez un PDF ici"
          description="Le fichier reste dans votre navigateur"
          footer={busy && <span className="loading loading-spinner text-primary" />}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Bascule grille / annotation */}
        <div className="tabs tabs-box tabs-sm">
          <button
            className={`tab gap-1.5 ${view === 'grid' ? 'tab-active' : ''}`}
            onClick={() => setView('grid')}
          >
            <IconGrid /> Pages
          </button>
          <button
            className={`tab gap-1.5 ${view === 'annotate' ? 'tab-active' : ''}`}
            onClick={() => setView('annotate')}
          >
            <IconEdit /> Annoter
          </button>
        </div>

        {/* Ajout de pages */}
        <div className="dropdown">
          <div tabIndex={0} role="button" className="btn btn-sm btn-soft rounded-full gap-1">
            <IconPlus /> Ajouter
          </div>
          <ul tabIndex={0} className="dropdown-content menu bg-base-200 rounded-box z-50 w-56 p-2 shadow-2xl">
            <li>
              <button onClick={() => { addBlankPage(insertIndex()); (document.activeElement as HTMLElement)?.blur() }}>
                <IconFilePlus /> Page vierge
              </button>
            </li>
            <li>
              <button onClick={() => { pdfInputRef.current?.click(); (document.activeElement as HTMLElement)?.blur() }}>
                <IconUpload /> Pages d'un autre PDF
              </button>
            </li>
            <li>
              <button onClick={() => { imgInputRef.current?.click(); (document.activeElement as HTMLElement)?.blur() }}>
                <IconUpload /> Image comme page
              </button>
            </li>
          </ul>
        </div>
        <span className="text-xs text-base-content/50 hidden sm:inline">
          insertion après la page sélectionnée
        </span>

        <div className="ml-auto flex gap-2">
          <button
            className="btn btn-sm btn-ghost rounded-full gap-1.5"
            onClick={() => {
              if (window.confirm('Fermer ce document ? Les pages et annotations en cours seront perdues.')) {
                reset()
              }
            }}
          >
            <IconX /> Fermer
          </button>
          <button
            className="btn btn-sm btn-primary rounded-full shadow-md gap-1.5"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? <span className="loading loading-spinner loading-xs" /> : <IconDownload />}
            Exporter le PDF
          </button>
        </div>
      </div>

      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : []
          void handlePdfFiles(files, insertIndex())
          e.target.value = ''
        }}
      />
      <input
        ref={imgInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          handleImageFile(e.target.files?.[0], insertIndex())
          e.target.value = ''
        }}
      />

      {busy && (
        <div className="flex items-center gap-2 text-sm text-base-content/60">
          <span className="loading loading-spinner loading-xs" /> Import en cours…
        </div>
      )}

      {view === 'grid' ? <PageGrid /> : <Annotator />}
    </div>
  )
}
