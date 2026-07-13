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
import { buildMergedPdf, useMergeStore, type MergeItem } from './store'
import { openPdf } from '../../lib/pdfjs'
import { downloadBytes } from '../create/exportPdf'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { toast } from '../../components/ui/Toast'
import { IconDownload, IconImage, IconPlus, IconUpload, IconX } from '../../components/ui/icons'

/** Miniature de la première page d'un PDF (cache module pour éviter les re-rendus). */
const thumbCache = new Map<string, Promise<string>>()

function pdfFirstPageThumb(item: MergeItem): Promise<string> {
  let p = thumbCache.get(item.id)
  if (!p) {
    p = (async () => {
      const doc = await openPdf(item.bytes!)
      const page = await doc.getPage(1)
      const vp0 = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: 130 / vp0.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
      return canvas.toDataURL()
    })()
    thumbCache.set(item.id, p)
  }
  return p
}

function ItemThumb({ item }: { item: MergeItem }) {
  const [src, setSrc] = useState<string | null>(item.kind === 'image' ? item.dataUrl! : null)

  useEffect(() => {
    if (item.kind !== 'pdf') return
    let cancelled = false
    pdfFirstPageThumb(item)
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch(console.error)
    return () => {
      cancelled = true
    }
  }, [item])

  return src ? (
    <img
      src={src}
      alt=""
      className="border border-base-300 shadow-sm bg-white"
      style={{ width: 130, height: 170, objectFit: 'contain' }}
      draggable={false}
    />
  ) : (
    <div className="skeleton" style={{ width: 130, height: 170 }} />
  )
}

function SortableFileCard({ item, index }: { item: MergeItem; index: number }) {
  const removeItem = useMergeStore((s) => s.removeItem)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })

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
      className={`card card-border bg-base-100 cursor-grab active:cursor-grabbing select-none touch-none ${
        isDragging ? 'shadow-xl' : ''
      }`}
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
            {item.kind === 'image' ? <IconImage /> : null}
            {item.pageCount} p.
          </span>
          <button
            className="btn btn-ghost btn-xs text-error"
            title="Retirer de la fusion"
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
  items: MergeItem[]
}) {
  const [thumbs, setThumbs] = useState<string[]>([])
  const [rendering, setRendering] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const urls: string[] = []
      try {
        for (const item of items) {
          if (cancelled) return
          if (item.kind === 'image') {
            urls.push(item.dataUrl!)
            setThumbs([...urls])
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
            urls.push(canvas.toDataURL())
            setThumbs([...urls])
          }
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
          {items.reduce((n, i) => n + i.pageCount, 0)} pages au total
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

export default function MergeModule() {
  const { items, hydrated, hydrate, addFiles, moveItem, reset } = useMergeStore()
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
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
      toast.success(`${files.length} fichier${files.length > 1 ? 's' : ''} ajouté${files.length > 1 ? 's' : ''}`)
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
    try {
      const bytes = await buildMergedPdf(useMergeStore.getState().items)
      downloadBytes(bytes, 'fusion.pdf')
      toast.success('PDF fusionné exporté !')
    } catch (err) {
      console.error(err)
      toast.error('Échec de la fusion')
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

  if (items.length === 0) {
    return (
      <div className="max-w-xl mx-auto mt-6 sm:mt-16">
        <FileDropzone
          accept="application/pdf,image/png,image/jpeg"
          multiple
          onFiles={(files) => void handleFiles(files)}
          className="bg-base-100 shadow-xl py-16"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="text-primary"><IconUpload /></div>
            <p className="font-semibold">Déposez des PDF et des images ici</p>
            <p className="text-sm text-base-content/60">
              Ils seront fusionnés en un seul PDF, dans l'ordre de votre choix
            </p>
            {busy && <span className="loading loading-spinner text-primary" />}
          </div>
        </FileDropzone>
      </div>
    )
  }

  const totalPages = items.reduce((n, i) => n + i.pageCount, 0)

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
        {busy && <span className="loading loading-spinner loading-xs" />}
        <div className="ml-auto flex gap-2">
          <button
            className="btn btn-sm btn-ghost rounded-full"
            onClick={() => {
              if (window.confirm('Vider la liste de fusion ?')) reset()
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
          >
            👁 Aperçu
          </button>
          <button
            className="btn btn-sm btn-primary rounded-full shadow-md gap-1.5"
            onClick={handleExport}
            disabled={exporting || items.length === 0}
          >
            {exporting ? <span className="loading loading-spinner loading-xs" /> : <IconDownload />}
            Fusionner
          </button>
        </div>
      </div>

      <input
        ref={addInputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : []
          void handleFiles(files)
          e.target.value = ''
        }}
      />

      <p className="text-xs text-base-content/50">
        Glissez les cartes pour définir l'ordre final du document fusionné.
      </p>

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
