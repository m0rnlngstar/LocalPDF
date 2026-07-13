import { useEffect, useState } from 'react'
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
import { useEditStore } from './store'
import { renderEditPage } from './pageRender'
import { displaySize, type EditPage } from './types'
import { IconEdit, IconRotate, IconX } from '../../components/ui/icons'

/** Miniature rendue (pdf.js / vierge / image), re-rendue quand la rotation change. */
function Thumb({ page }: { page: EditPage }) {
  const docs = useEditStore((s) => s.docs)
  const [src, setSrc] = useState<string | null>(null)
  const { width, height } = displaySize(page)

  useEffect(() => {
    let cancelled = false
    const scale = 140 / width
    renderEditPage(page, docs, scale)
      .then((canvas) => {
        if (!cancelled) setSrc(canvas.toDataURL())
      })
      .catch(console.error)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, page.rotation, width])

  const h = Math.min((140 * height) / width, 200)
  return src ? (
    <img
      src={src}
      alt=""
      className="border border-base-300 shadow-sm max-w-full"
      style={{ width: 140, height: h, objectFit: 'contain', backgroundColor: '#fff' }}
      draggable={false}
    />
  ) : (
    <div className="skeleton" style={{ width: 140, height: h }} />
  )
}

function SortablePageCard({ page, index }: { page: EditPage; index: number }) {
  const { currentPageId, setCurrentPage, setView, rotatePage, deletePage, pages } = useEditStore()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: page.id })
  const isCurrent = page.id === currentPageId

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
      className={`card card-border cursor-grab active:cursor-grabbing select-none touch-none ${
        isCurrent ? 'border-primary bg-primary/10' : 'bg-base-100'
      } ${isDragging ? 'shadow-xl' : ''}`}
      onClick={() => setCurrentPage(page.id)}
    >
      <div className="card-body p-2 items-center gap-1.5">
        <Thumb page={page} />
        <div className="flex items-center gap-1 w-full justify-center">
          <span className="text-xs font-medium">{index + 1}</span>
          {page.annotations.length > 0 && (
            <span className="badge badge-primary badge-xs">{page.annotations.length}</span>
          )}
        </div>
        <div className="flex gap-0.5">
          <button
            className="btn btn-ghost btn-xs"
            title="Annoter cette page"
            onClick={(e) => {
              e.stopPropagation()
              setCurrentPage(page.id)
              setView('annotate')
            }}
          >
            <IconEdit />
          </button>
          <button
            className="btn btn-ghost btn-xs"
            title="Pivoter de 90°"
            onClick={(e) => {
              e.stopPropagation()
              rotatePage(page.id)
            }}
          >
            <IconRotate />
          </button>
          <button
            className="btn btn-ghost btn-xs text-error"
            title="Supprimer la page"
            disabled={pages.length <= 1}
            onClick={(e) => {
              e.stopPropagation()
              deletePage(page.id)
            }}
          >
            <IconX />
          </button>
        </div>
      </div>
    </div>
  )
}

/** Vue en grille : réorganisation par drag & drop, rotation, suppression. */
export function PageGrid() {
  const { pages, movePage } = useEditStore()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    movePage(
      pages.findIndex((p) => p.id === active.id),
      pages.findIndex((p) => p.id === over.id)
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
          {pages.map((page, i) => (
            <SortablePageCard key={page.id} page={page} index={i} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
