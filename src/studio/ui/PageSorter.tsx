import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStudio } from '../store'
import { displaySize, type StudioPage } from '../types'
import { PageBitmap } from './PageBitmap'
import { IconCopy, IconPlus, IconRotate, IconTrash } from '../../components/ui/icons'
import { useDialogs } from '../actions'
import { IconRotateLeft } from './icons'

/**
 * Liste triable des pages, en colonne (miniatures du lecteur) ou en grille
 * (organiseur). Sélection multiple : clic, Ctrl/Cmd + clic, Maj + clic.
 * Glisser une page sélectionnée déplace toute la sélection.
 */

type Variant = 'list' | 'grid'

/** Miniature, rendue seulement quand elle approche de la zone visible. */
function Thumb({ page, width }: { page: StudioPage; width: number }) {
  const docs = useStudio((s) => s.docs)
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const { width: W, height: H } = displaySize(page)
  const h = (width * H) / W

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const dpr = window.devicePixelRatio || 1
  const notes = page.annotations.length
  return (
    <div ref={ref} className="studio-thumb-paper" style={{ width, height: h }}>
      {visible && <PageBitmap page={page} docs={docs} scale={(width / W) * dpr} />}
      {notes > 0 && <span className="studio-thumb-badge" title={`${notes} annotation(s)`}>{notes}</span>}
      {page.ocr && <span className="studio-thumb-badge is-ocr" title="Texte reconnu (OCR)">OCR</span>}
    </div>
  )
}

/** Aperçu agrandi d'une page au survol de sa miniature. */
function HoverPreview({ pageId, rect }: { pageId: string; rect: DOMRect }) {
  const page = useStudio((s) => s.pages.find((p) => p.id === pageId))
  const docs = useStudio((s) => s.docs)
  if (!page) return null
  const { width: W, height: H } = displaySize(page)
  const margin = 14
  const maxH = window.innerHeight * 0.86
  let w = Math.min(440, window.innerWidth * 0.42)
  let h = (w * H) / W
  if (h > maxH) {
    h = maxH
    w = (h * W) / H
  }
  // À droite de la miniature si la place le permet, sinon à gauche
  const left = rect.right + margin + w < window.innerWidth ? rect.right + margin : Math.max(margin, rect.left - margin - w)
  const top = Math.min(Math.max(margin, rect.top + rect.height / 2 - h / 2), window.innerHeight - h - margin)
  const dpr = window.devicePixelRatio || 1
  return createPortal(
    <div className="studio-hover-preview" style={{ left, top, width: w, height: h }} aria-hidden="true">
      <PageBitmap page={page} docs={docs} scale={(w / W) * dpr} />
    </div>,
    document.body
  )
}

const SortableThumb = memo(function SortableThumb({
  page, index, variant, width, selected, current, dimmed, onPick,
}: {
  page: StudioPage
  index: number
  variant: Variant
  width: number
  selected: boolean
  current: boolean
  dimmed: boolean
  onPick: (id: string, e: React.MouseEvent) => void
}) {
  const rotatePages = useStudio((s) => s.rotatePages)
  const deletePages = useStudio((s) => s.deletePages)
  const duplicatePages = useStudio((s) => s.duplicatePages)
  const openAddPages = useDialogs((s) => s.openAddPages)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={[
        'studio-thumb', `is-${variant}`,
        selected && 'is-selected', current && 'is-current', (isDragging || dimmed) && 'is-dragging',
      ].filter(Boolean).join(' ')}
      data-thumb-id={page.id}
      {...attributes}
      {...listeners}
      onClick={(e) => onPick(page.id, e)}
      aria-label={`Page ${index + 1}`}
    >
      <Thumb page={page} width={width} />
      <div className="studio-thumb-footer">
        <span>{index + 1}</span>
        <div className="studio-thumb-actions" onPointerDown={(e) => e.stopPropagation()}>
          <button title="Pivoter à gauche" onClick={(e) => { e.stopPropagation(); rotatePages([page.id], -1) }}><IconRotateLeft /></button>
          <button title="Pivoter à droite" onClick={(e) => { e.stopPropagation(); rotatePages([page.id], 1) }}><IconRotate /></button>
          {variant === 'grid' && (
            <button title="Dupliquer" onClick={(e) => { e.stopPropagation(); duplicatePages([page.id]) }}><IconCopy /></button>
          )}
          <button title="Ajouter une page après celle-ci" onClick={(e) => { e.stopPropagation(); openAddPages(index + 1) }}><IconPlus /></button>
          <button title="Supprimer la page" className="is-danger" onClick={(e) => { e.stopPropagation(); deletePages([page.id]) }}><IconTrash /></button>
        </div>
      </div>
    </div>
  )
})

export function PageSorter({ variant }: { variant: Variant }) {
  const pages = useStudio((s) => s.pages)
  const selected = useStudio((s) => s.selectedPageIds)
  const currentPageId = useStudio((s) => s.currentPageId)
  const setSelectedPages = useStudio((s) => s.setSelectedPages)
  const movePages = useStudio((s) => s.movePages)
  const scrollToPage = useStudio((s) => s.scrollToPage)
  const setCurrentPage = useStudio((s) => s.setCurrentPage)
  const setView = useStudio((s) => s.setView)
  const anchor = useRef<string | null>(null)
  const [dragIds, setDragIds] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<{ id: string; rect: DOMRect } | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hoverId = useRef<string | null>(null)

  function clearPreview() {
    clearTimeout(hoverTimer.current)
    hoverId.current = null
    setPreview(null)
  }

  function onHover(e: React.MouseEvent) {
    if (activeId) return
    const thumb = (e.target as HTMLElement).closest<HTMLElement>('[data-thumb-id]')
    const id = thumb?.dataset.thumbId ?? null
    if (id === hoverId.current) return
    clearPreview()
    hoverId.current = id
    if (!thumb || !id) return
    // Délai : pas d'aperçu quand la souris ne fait que passer
    hoverTimer.current = setTimeout(() => {
      const paper = thumb.querySelector('.studio-thumb-paper') ?? thumb
      setPreview({ id, rect: paper.getBoundingClientRect() })
    }, 450)
  }

  useEffect(() => () => clearTimeout(hoverTimer.current), [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // La miniature de la page courante reste visible pendant la lecture
  useEffect(() => {
    if (variant !== 'list' || !currentPageId) return
    const el = containerRef.current?.querySelector(`[data-thumb-id="${currentPageId}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [currentPageId, variant])

  function onPick(id: string, e: React.MouseEvent) {
    if (e.shiftKey && anchor.current) {
      const a = pages.findIndex((p) => p.id === anchor.current)
      const b = pages.findIndex((p) => p.id === id)
      const [from, to] = a < b ? [a, b] : [b, a]
      setSelectedPages(pages.slice(from, to + 1).map((p) => p.id))
      return
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedPages(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
      anchor.current = id
      return
    }
    anchor.current = id
    setSelectedPages([id])
    if (variant === 'list') scrollToPage(id)
    else setCurrentPage(id)
  }

  function onDragStart(e: DragStartEvent) {
    clearPreview()
    const id = String(e.active.id)
    const ids = selected.includes(id) ? pages.filter((p) => selected.includes(p.id)).map((p) => p.id) : [id]
    if (!selected.includes(id)) setSelectedPages([id])
    setDragIds(ids)
    setActiveId(id)
  }

  function onDragEnd(e: DragEndEvent) {
    const ids = dragIds
    setDragIds([])
    setActiveId(null)
    if (!e.over) return
    const overId = String(e.over.id)
    if (ids.includes(overId) && ids.length === 1 && overId === e.active.id) return
    const from = pages.findIndex((p) => p.id === e.active.id)
    const to = pages.findIndex((p) => p.id === overId)
    if (from < 0 || to < 0 || from === to) return
    movePages(ids, to > from ? to + 1 : to)
  }

  const width = variant === 'grid' ? 150 : 112
  const activePage = activeId ? pages.find((p) => p.id === activeId) : null

  return (
    <div
      ref={containerRef}
      className={`studio-sorter is-${variant}`}
      onMouseOver={onHover}
      onMouseLeave={clearPreview}
      onPointerDown={clearPreview}
      onScroll={clearPreview}
      onDoubleClick={(e) => {
        const id = (e.target as HTMLElement).closest<HTMLElement>('[data-thumb-id]')?.dataset.thumbId
        if (id && variant === 'grid') {
          setView('read')
          setTimeout(() => scrollToPage(id), 0)
        }
      }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => { setDragIds([]); setActiveId(null) }}
      >
        <SortableContext items={pages.map((p) => p.id)} strategy={variant === 'grid' ? rectSortingStrategy : verticalListSortingStrategy}>
          {pages.map((page, i) => (
            <SortableThumb
              key={page.id}
              page={page}
              index={i}
              variant={variant}
              width={width}
              selected={selected.includes(page.id)}
              current={page.id === currentPageId}
              dimmed={dragIds.length > 1 && dragIds.includes(page.id) && page.id !== activeId}
              onPick={onPick}
            />
          ))}
        </SortableContext>
        <DragOverlay>
          {activePage && (
            <div className="studio-thumb is-overlay">
              <Thumb page={activePage} width={width} />
              {dragIds.length > 1 && <span className="studio-drag-count">{dragIds.length} pages</span>}
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {preview && !activeId && <HoverPreview pageId={preview.id} rect={preview.rect} />}
    </div>
  )
}
