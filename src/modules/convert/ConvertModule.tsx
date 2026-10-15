import { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useConvertStore } from './store'
import type { ConvertItem } from './types'
import { openPdf } from '../../lib/pdfjs'
import { buildFinalPdf, downloadBytes, exportSeparatePdfs } from './exportPdf'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { InfoDialog } from '../../components/ui/InfoDialog'
import { toast } from '../../components/ui/Toast'
import { IconAlertTriangle, IconDownload, IconPlus, IconX } from '../../components/ui/icons'

const OCR_KEY = 'convert-ocr'
const SEPARATE_KEY = 'convert-separate'

const ACCEPT = [
  'application/pdf',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/svg+xml',
  'image/heic', 'image/heif', '.heic', '.heif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx',
  'text/plain', '.txt',
  'text/markdown', '.md', '.markdown',
].join(',')

function extBadge(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  return m ? m[1].toUpperCase() : '?'
}

function ItemThumb({ item }: { item: ConvertItem }) {
  if (item.status === 'converting') {
    return (
      <div className="flex items-center justify-center bg-base-200" style={{ width: 130, height: 170 }}>
        <span className="loading loading-spinner text-primary" />
      </div>
    )
  }

  if (item.status === 'error') {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1 bg-error/10 text-error p-2 text-center"
        style={{ width: 130, height: 170 }}
        title={item.error}
      >
        <IconAlertTriangle />
        <span className="text-[11px] leading-tight">{item.error ?? 'Échec'}</span>
      </div>
    )
  }

  return item.thumb ? (
    <img
      src={item.thumb}
      alt=""
      loading="lazy"
      decoding="async"
      className="border border-base-300 shadow-sm bg-white"
      style={{ width: 130, height: 170, objectFit: 'contain' }}
      draggable={false}
    />
  ) : (
    <div className="skeleton" style={{ width: 130, height: 170 }} />
  )
}

function SortableFileCard({ item, index }: { item: ConvertItem; index: number }) {
  const removeItem = useConvertStore((s) => s.removeItem)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id, disabled: item.status === 'converting' })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
      {...attributes}
      {...listeners}
      className={`card card-border bg-base-100 select-none touch-none ${
        item.status === 'converting' ? 'cursor-wait' : 'cursor-grab active:cursor-grabbing'
      } ${isDragging ? 'shadow-xl' : ''}`}
    >
      <div className="card-body p-2 items-center gap-1.5">
        <div className="relative">
          <ItemThumb item={item} />
          <span className="badge badge-neutral badge-sm absolute top-1 left-1">{index + 1}</span>
        </div>
        <span className="text-xs font-medium truncate max-w-[130px]" title={item.name}>
          {item.name}
        </span>
        <div className="flex items-center gap-1">
          <span className="badge badge-ghost badge-xs gap-1">
            {extBadge(item.name)}
            {item.status === 'ready' && ` · ${item.pageCount} p.`}
          </span>
          <button
            className="btn btn-ghost btn-xs text-error"
            title="Retirer"
            onClick={(e) => {
              e.stopPropagation()
              removeItem(item.id)
            }}
          >
            <IconX />
          </button>
        </div>
      </div>
    </div>
  )
}

/** Aperçu du résultat : rend toutes les pages du document final, dans l'ordre. */
function PreviewDialog({
  dialogRef,
  items,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  items: ConvertItem[]
}) {
  const [thumbs, setThumbs] = useState<string[]>([])
  const [rendering, setRendering] = useState(true)

  useEffect(() => {
    let cancelled = false
    const readyItems = items.filter((i) => i.status === 'ready')
    ;(async () => {
      const urls: string[] = []
      try {
        for (const item of readyItems) {
          if (cancelled) return
          if (item.kind === 'pages' && item.pages) {
            for (const pg of item.pages) {
              urls.push(pg.thumb)
              setThumbs([...urls])
            }
            continue
          }
          const doc = await openPdf(item.bytes!)
          for (let i = 1; i <= doc.numPages; i++) {
            if (cancelled) break
            const page = await doc.getPage(i)
            const vp0 = page.getViewport({ scale: 1 })
            const viewport = page.getViewport({ scale: 110 / vp0.width })
            const canvas = document.createElement('canvas')
            canvas.width = Math.ceil(viewport.width)
            canvas.height = Math.ceil(viewport.height)
            await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
            urls.push(canvas.toDataURL('image/jpeg', 0.75))
            canvas.width = 0
            setThumbs([...urls])
          }
          void doc.loadingTask.destroy()
        }
      } catch (err) {
        console.error(err)
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [items])

  return (
    <dialog ref={dialogRef} className="modal">
      <div className="modal-box max-w-3xl">
        <h3 className="font-bold text-lg mb-1">Aperçu du résultat</h3>
        <p className="text-sm text-base-content/60 mb-3">
          {items.filter((i) => i.status === 'ready').reduce((n, i) => n + i.pageCount, 0)} pages au total
          {rendering && ' — rendu en cours…'}
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2 max-h-[60vh] overflow-y-auto">
          {thumbs.map((src, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <img
                src={src}
                alt=""
                className="border border-base-300 bg-white w-full object-contain"
                style={{ maxHeight: 140 }}
              />
              <span className="text-[10px] text-base-content/50">{i + 1}</span>
            </div>
          ))}
          {rendering && <div className="skeleton w-full" style={{ height: 140 }} />}
        </div>
        <div className="modal-action">
          <form method="dialog">
            <button className="btn btn-sm rounded-full">Fermer</button>
          </form>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>fermer</button>
      </form>
    </dialog>
  )
}

export default function ConvertModule() {
  const { items, hydrated, hydrate, addFiles, moveItem, reset, discardSaved, progress } = useConvertStore()
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [ocr, setOcr] = useState(localStorage.getItem(OCR_KEY) === 'on')
  // Un PDF par fichier source (même nom, extension .pdf) au lieu d'un document unique
  const [separate, setSeparate] = useState(localStorage.getItem(SEPARATE_KEY) === 'on')
  const [ocrProgress, setOcrProgress] = useState<{ done: number; total: number } | null>(null)
  const addInputRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLDialogElement>(null)
  // Remonte l'aperçu à chaque ouverture pour relancer le rendu sur l'état courant
  const [previewKey, setPreviewKey] = useState(0)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  )

  async function handleFiles(files: File[]) {
    setBusy(true)
    try {
      await addFiles(files)
      const failed = useConvertStore.getState().items.filter((i) => i.status === 'error').length
      if (failed > 0) {
        toast.error(`${failed} fichier${failed > 1 ? 's' : ''} n'ont pas pu être converti${failed > 1 ? 's' : ''}`)
      } else {
        toast.success(`${files.length} fichier${files.length > 1 ? 's' : ''} converti${files.length > 1 ? 's' : ''}`)
      }
    } catch (err) {
      console.error(err)
      toast.error("Impossible de lire l'un des fichiers")
    } finally {
      setBusy(false)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    moveItem(
      items.findIndex((i) => i.id === active.id),
      items.findIndex((i) => i.id === over.id)
    )
  }

  async function handleExport() {
    setExporting(true)
    setOcrProgress(null)
    try {
      const ready = useConvertStore.getState().items.filter((i) => i.status === 'ready')
      const opts = { ocr, onOcrProgress: (done: number, total: number) => setOcrProgress({ done, total }) }
      if (separate) {
        const n = await exportSeparatePdfs(ready, 'documents-convertis.zip', opts)
        toast.success(n > 1 ? `${n} PDF exportés (archive .zip)` : 'PDF exporté !')
      } else {
        const bytes = await buildFinalPdf(ready, opts)
        downloadBytes(bytes, 'document-converti.pdf')
        toast.success('PDF exporté !')
      }
    } catch (err) {
      console.error(err)
      toast.error("Échec de l'export PDF")
    } finally {
      setExporting(false)
      setOcrProgress(null)
    }
  }

  if (!hydrated) {
    return (
      <div className="flex flex-col justify-center items-center gap-4 h-64">
        <span className="loading loading-spinner loading-lg text-primary" />
        <p className="text-sm text-base-content/60">Restauration de la session précédente…</p>
        <button
          className="btn btn-sm btn-ghost rounded-full"
          onClick={() => {
            if (window.confirm('Abandonner la session précédente du convertisseur ?')) void discardSaved()
          }}
        >
          <IconX /> Abandonner et repartir de zéro
        </button>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="max-w-xl mx-auto mt-6 sm:mt-16">
        <FileDropzone
          accept={ACCEPT}
          multiple
          onFiles={(files) => void handleFiles(files)}
          className="bg-base-100 shadow-xl py-16"
          title="Déposez vos fichiers ici"
          description="Images (JPG, PNG, WEBP, HEIC…), DOCX, TXT ou Markdown : assemblés en un seul PDF ou convertis chacun en PDF séparé."
          footer={busy && <span className="loading loading-spinner text-primary" />}
        />
      </div>
    )
  }

  const readyCount = items.filter((i) => i.status === 'ready').length
  const totalPages = items.reduce((n, i) => n + i.pageCount, 0)
  const hasImages = items.some((i) => i.isImage)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn btn-sm btn-soft rounded-full gap-1"
          onClick={() => addInputRef.current?.click()}
        >
          <IconPlus /> Ajouter des fichiers
        </button>
        <span className="text-sm text-base-content/60">
          {items.length} fichier{items.length > 1 ? 's' : ''} · {totalPages} page{totalPages > 1 ? 's' : ''}
        </span>
        {progress ? (
          <span className="flex items-center gap-2 text-xs text-base-content/60">
            <progress className="progress progress-primary w-28" value={progress.done} max={progress.total} />
            Conversion {progress.done} / {progress.total}
          </span>
        ) : (
          busy && <span className="loading loading-spinner loading-xs" />
        )}
        <div className="ml-auto flex gap-2">
          <button
            className="btn btn-sm btn-ghost rounded-full"
            onClick={() => {
              if (window.confirm('Vider la liste ?')) reset()
            }}
          >
            <IconX /> Vider
          </button>
          <button
            className="btn btn-sm btn-soft rounded-full"
            onClick={() => {
              setPreviewKey((k) => k + 1)
              // Laisse l'aperçu se remonter avant d'ouvrir la modale
              requestAnimationFrame(() => previewRef.current?.showModal())
            }}
            disabled={readyCount === 0}
          >
            👁 Aperçu
          </button>
          <button
            className="btn btn-sm btn-primary rounded-full shadow-md gap-1.5"
            onClick={handleExport}
            disabled={exporting || readyCount === 0 || progress !== null}
          >
            {exporting ? <span className="loading loading-spinner loading-xs" /> : <IconDownload />}
            {separate && readyCount > 1 ? `Générer ${readyCount} PDF` : 'Générer le PDF'}
          </button>
        </div>
      </div>

      <input
        ref={addInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : []
          void handleFiles(files)
          e.target.value = ''
        }}
      />

      <label className="flex items-center gap-2 text-sm w-fit">
        <input
          type="checkbox"
          role="switch"
          className="toggle toggle-sm toggle-primary"
          checked={separate}
          onChange={(e) => {
            setSeparate(e.target.checked)
            localStorage.setItem(SEPARATE_KEY, e.target.checked ? 'on' : 'off')
          }}
          disabled={exporting}
        />
        Un PDF par fichier (même nom, en .pdf — regroupés dans un .zip)
      </label>

      <p className="text-xs text-base-content/50">
        Glissez les cartes pour définir l'ordre final du document. Les fichiers texte/DOCX sont rendus en
        images (mise en page fidèle) pour préserver leur apparence.
      </p>

      {hasImages && (
        <div className="card bg-base-100 border border-base-300/50 shadow-sm">
          <div className="card-body p-3 flex-row flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                role="switch"
                className="toggle toggle-sm toggle-primary"
                checked={ocr}
                onChange={(e) => {
                  setOcr(e.target.checked)
                  localStorage.setItem(OCR_KEY, e.target.checked ? 'on' : 'off')
                }}
                disabled={exporting}
              />
              Rendre les images reconnaissables (OCR)
            </label>
            <InfoDialog title="🔍 OCR des images">
              <p>
                Quand cette option est activée, chaque page issue d'une image ou d'une photo
                (JPG, PNG, HEIC…) est analysée par reconnaissance de texte (français + anglais,
                entièrement dans votre navigateur) avant d'être ajoutée au PDF.
              </p>
              <p>
                Le texte reconnu est superposé <strong>invisible</strong> sur l'image d'origine :
                le PDF final garde exactement le même aspect visuel, mais devient sélectionnable
                et cherchable (Ctrl+F, copier-coller).
              </p>
              <p className="text-base-content/60">
                Cela ralentit la génération du PDF, surtout avec beaucoup d'images. Les fichiers
                DOCX, TXT et Markdown ne sont pas concernés (leur texte est déjà connu).
              </p>
            </InfoDialog>
            {exporting && ocr && ocrProgress && (
              <span className="text-xs text-base-content/50 ml-auto">
                OCR : page {ocrProgress.done} / {ocrProgress.total}
              </span>
            )}
          </div>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {items.map((item, i) => (
              <SortableFileCard key={item.id} item={item} index={i} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <PreviewDialog key={previewKey} dialogRef={previewRef} items={items} />
    </div>
  )
}
