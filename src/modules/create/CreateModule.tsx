import { useEffect, useState } from 'react'
import { useCreateStore } from './store'
import { CanvasEditor } from './CanvasEditor'
import { SelectionBar, ToolRail } from './Toolbar'
import { PagesSidebar } from './PagesSidebar'
import { IconDownload, IconFilePlus } from '../../components/ui/icons'
import { buildPdf, downloadBytes } from './exportPdf'
import { PAGE_FORMATS, type Orientation, type PageFormatId } from './types'
import { toast } from '../../components/ui/Toast'

/** Formulaire de création d'un nouveau document (format + orientation). */
function NewDocumentForm({ onDone }: { onDone?: () => void }) {
  const newDocument = useCreateStore((s) => s.newDocument)
  const [format, setFormat] = useState<PageFormatId>('A4')
  const [orientation, setOrientation] = useState<Orientation>('portrait')
  const [customW, setCustomW] = useState(595)
  const [customH, setCustomH] = useState(842)

  return (
    <div className="card bg-base-100 shadow-xl border border-base-300/50 max-w-md mx-auto mt-6 sm:mt-12">
      <div className="card-body">
        <h2 className="card-title">📄 Nouveau document</h2>
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Format</legend>
          <div className="join">
            {(Object.keys(PAGE_FORMATS) as PageFormatId[]).concat('custom').map((f) => (
              <button
                key={f}
                className={`btn btn-sm join-item ${format === f ? 'btn-primary' : ''}`}
                onClick={() => setFormat(f)}
              >
                {f === 'custom' ? 'Personnalisé' : f}
              </button>
            ))}
          </div>
        </fieldset>
        {format === 'custom' && (
          <div className="flex gap-2 items-center">
            <input
              type="number" className="input input-sm w-24" value={customW} min={72}
              onChange={(e) => setCustomW(Number(e.target.value))}
            />
            ×
            <input
              type="number" className="input input-sm w-24" value={customH} min={72}
              onChange={(e) => setCustomH(Number(e.target.value))}
            />
            <span className="text-xs text-base-content/60">points (1/72")</span>
          </div>
        )}
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Orientation</legend>
          <div className="join">
            <button
              className={`btn btn-sm join-item ${orientation === 'portrait' ? 'btn-primary' : ''}`}
              onClick={() => setOrientation('portrait')}
            >
              📄 Portrait
            </button>
            <button
              className={`btn btn-sm join-item ${orientation === 'landscape' ? 'btn-primary' : ''}`}
              onClick={() => setOrientation('landscape')}
            >
              🖼️ Paysage
            </button>
          </div>
        </fieldset>
        <div className="card-actions justify-end mt-2">
          <button
            className="btn btn-primary rounded-full px-6"
            onClick={() => {
              newDocument(format, orientation, { width: customW, height: customH })
              onDone?.()
            }}
          >
            Créer
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CreateModule() {
  const { pages, hydrated, hydrate } = useCreateStore()
  const [exporting, setExporting] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  if (!hydrated) {
    return (
      <div className="flex justify-center items-center h-64">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    )
  }

  if (pages.length === 0 || showNewForm) {
    return <NewDocumentForm onDone={() => setShowNewForm(false)} />
  }

  async function handleExport() {
    setExporting(true)
    try {
      const { pages, watermark } = useCreateStore.getState()
      const bytes = await buildPdf(pages, watermark)
      downloadBytes(bytes, 'document.pdf')
      toast.success('PDF exporté !')
    } catch (err) {
      console.error(err)
      toast.error("Échec de l'export PDF")
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SelectionBar />
        <div className="ml-auto flex gap-2">
          <button className="btn btn-sm btn-ghost rounded-full gap-1.5" onClick={() => setShowNewForm(true)}>
            <IconFilePlus /> Nouveau
          </button>
          <button className="btn btn-sm btn-primary rounded-full shadow-md gap-1.5" onClick={handleExport} disabled={exporting}>
            {exporting ? <span className="loading loading-spinner loading-xs" /> : <IconDownload />}
            Exporter le PDF
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-3 items-start">
        <ToolRail />
        <PagesSidebar />
        <div className="flex-1 min-w-0 w-full">
          <CanvasEditor />
        </div>
      </div>
    </div>
  )
}
