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
import { useCreateStore } from './store'
import type { PageData } from './types'
import { IconCopy, IconPlus, IconX } from '../../components/ui/icons'

function SortablePageCard({
  page,
  index,
  isCurrent,
  canDelete,
}: {
  page: PageData
  index: number
  isCurrent: boolean
  canDelete: boolean
}) {
  const { setCurrentPage, duplicatePage, deletePage } = useCreateStore()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: page.id })

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
      className={`card card-border shrink-0 cursor-grab active:cursor-grabbing select-none touch-none ${
        isCurrent ? 'border-primary bg-primary/10' : 'bg-base-100'
      } ${isDragging ? 'shadow-xl' : ''}`}
      onClick={() => setCurrentPage(index)}
    >
      <div className="card-body p-2 items-center gap-1">
        <div
          className="border border-base-300 shadow-sm"
          style={{
            width: 56,
            height: (56 * page.height) / page.width,
            maxHeight: 80,
            backgroundColor: page.backgroundColor ?? '#ffffff',
          }}
        />
        <span className="text-xs font-medium">Page {index + 1}</span>
        <div className="flex gap-1">
          <button
            className="btn btn-ghost btn-xs"
            title="Dupliquer la page"
            onClick={(e) => {
              e.stopPropagation()
              duplicatePage(index)
            }}
          >
            <IconCopy />
          </button>
          <button
            className="btn btn-ghost btn-xs text-error"
            title="Supprimer la page"
            disabled={!canDelete}
            onClick={(e) => {
              e.stopPropagation()
              deletePage(index)
            }}
          >
            <IconX />
          </button>
        </div>
      </div>
    </div>
  )
}

/** Liste des pages : sélection, ajout, duplication, suppression, réorganisation par drag & drop. */
export function PagesSidebar() {
  const { pages, currentPageIndex, addPage, movePage } = useCreateStore()

  // distance/delay : un simple clic sélectionne, un maintien/glissement réordonne
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = pages.findIndex((p) => p.id === active.id)
    const to = pages.findIndex((p) => p.id === over.id)
    movePage(from, to)
  }

  return (
    <div className="flex lg:flex-col gap-2 lg:w-36 overflow-x-auto lg:overflow-y-auto lg:max-h-[70vh] p-1 shrink-0">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
          {pages.map((page, i) => (
            <SortablePageCard
              key={page.id}
              page={page}
              index={i}
              isCurrent={i === currentPageIndex}
              canDelete={pages.length > 1}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button className="btn btn-soft btn-sm rounded-full shrink-0 lg:w-full gap-1" onClick={addPage}>
        <IconPlus /> Page
      </button>
    </div>
  )
}
