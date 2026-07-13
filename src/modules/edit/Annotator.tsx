import { useCallback, useEffect, useRef, useState } from 'react'
import { Stage, Layer, Rect, Ellipse, Text, Line, Label, Tag, Group, Image as KImage, Transformer } from 'react-konva'
import type Konva from 'konva'
import { useEditStore } from './store'
import { renderEditPage } from './pageRender'
import { displaySize, newId, type EditAnnotation, type EditPage, type EditTool } from './types'
import {
  IconChevronLeft, IconChevronRight, IconCircleShape, IconGrid, IconHighlighter,
  IconNote, IconPointer, IconSignature, IconSquare, IconStamp, IconTrash, IconType,
} from '../../components/ui/icons'

/**
 * Annotateur : la page (PDF/vierge/image) est rendue en fond via pdf.js,
 * les annotations vivent dans une couche Konva par-dessus, dans le repère
 * d'affichage de la page (points PDF, origine haut-gauche).
 */

const HIGHLIGHT_COLORS = ['#fde047', '#86efac', '#f9a8d4', '#93c5fd']
const NOTE_COLORS = ['#fef08a', '#bbf7d0', '#fbcfe8']
const STAMP_PRESETS = ['APPROUVÉ', 'REFUSÉ', 'BROUILLON', 'CONFIDENTIEL']

interface DraftShape {
  tool: 'highlight' | 'rect' | 'ellipse'
  x0: number
  y0: number
  x1: number
  y1: number
}

function AnnNode({
  ann,
  pageId,
  interactive,
  onSelect,
  onEditText,
}: {
  ann: EditAnnotation
  pageId: string
  interactive: boolean
  onSelect: () => void
  onEditText: () => void
}) {
  const updateAnnotation = useEditStore((s) => s.updateAnnotation)

  const common = {
    id: ann.id,
    x: ann.x,
    y: ann.y,
    draggable: interactive,
    listening: interactive,
    onClick: onSelect,
    onTap: onSelect,
    onDragStart: onSelect,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      updateAnnotation(pageId, ann.id, { x: e.target.x(), y: e.target.y() })
    },
  }

  function resizeEnd(e: Konva.KonvaEventObject<Event>, minW = 8, minH = 8) {
    const node = e.target
    const scaleX = node.scaleX()
    const scaleY = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)
    if (ann.type === 'text') {
      updateAnnotation(pageId, ann.id, {
        x: node.x(),
        y: node.y(),
        width: Math.max(30, ann.width * scaleX),
      })
    } else if (ann.type === 'highlight' || ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'note') {
      updateAnnotation(pageId, ann.id, {
        x: node.x(),
        y: node.y(),
        width: Math.max(minW, ann.width * scaleX),
        height: Math.max(minH, ann.height * scaleY),
      })
    }
  }

  switch (ann.type) {
    case 'highlight':
      return (
        <Rect
          {...common}
          width={ann.width}
          height={ann.height}
          fill={ann.color}
          opacity={0.45}
          globalCompositeOperation="multiply"
          onTransformEnd={resizeEnd}
        />
      )
    case 'rect':
      return (
        <Rect
          {...common}
          width={ann.width}
          height={ann.height}
          stroke={ann.stroke}
          strokeWidth={ann.strokeWidth}
          onTransformEnd={resizeEnd}
        />
      )
    case 'ellipse':
      return (
        <Ellipse
          {...common}
          x={ann.x + ann.width / 2}
          y={ann.y + ann.height / 2}
          radiusX={ann.width / 2}
          radiusY={ann.height / 2}
          stroke={ann.stroke}
          strokeWidth={ann.strokeWidth}
          onDragEnd={(e) =>
            updateAnnotation(pageId, ann.id, {
              x: e.target.x() - ann.width / 2,
              y: e.target.y() - ann.height / 2,
            })
          }
          onTransformEnd={(e) => {
            const node = e.target
            const w = Math.max(8, ann.width * node.scaleX())
            const h = Math.max(8, ann.height * node.scaleY())
            node.scaleX(1)
            node.scaleY(1)
            updateAnnotation(pageId, ann.id, {
              x: node.x() - w / 2,
              y: node.y() - h / 2,
              width: w,
              height: h,
            })
          }}
        />
      )
    case 'ink':
      return (
        <Line
          {...common}
          points={ann.points}
          stroke={ann.stroke}
          strokeWidth={ann.strokeWidth}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={Math.max(16, ann.strokeWidth)}
        />
      )
    case 'text':
      return (
        <Text
          {...common}
          text={ann.text}
          width={ann.width}
          fontSize={ann.fontSize}
          fontFamily="Helvetica, Arial, sans-serif"
          fill={ann.color}
          lineHeight={1}
          onDblClick={onEditText}
          onDblTap={onEditText}
          onTransformEnd={resizeEnd}
        />
      )
    case 'note':
      return (
        <Group {...common} onDblClick={onEditText} onDblTap={onEditText} onTransformEnd={(e) => resizeEnd(e, 60, 40)}>
          <Rect
            width={ann.width}
            height={ann.height}
            fill={ann.color}
            stroke="rgba(0,0,0,0.15)"
            strokeWidth={1}
            shadowColor="black"
            shadowBlur={6}
            shadowOpacity={0.2}
            shadowOffsetY={2}
          />
          <Text
            text={ann.text}
            width={ann.width}
            height={ann.height}
            padding={8}
            fontSize={12}
            fontFamily="Helvetica, Arial, sans-serif"
            fill="#333333"
            lineHeight={1}
          />
        </Group>
      )
    case 'stamp':
      return (
        <Label {...common} onDblClick={onEditText} onDblTap={onEditText}>
          <Tag stroke={ann.color} strokeWidth={2} />
          <Text
            text={ann.text}
            fontSize={ann.fontSize}
            fontStyle="bold"
            fontFamily="Helvetica, Arial, sans-serif"
            fill={ann.color}
            padding={8}
          />
        </Label>
      )
  }
}

/** Ancres du Transformer selon le type d'annotation sélectionnée. */
function transformerConfig(ann: EditAnnotation | undefined) {
  if (!ann) return { enabledAnchors: [] as string[], rotateEnabled: false }
  switch (ann.type) {
    case 'text':
      return { enabledAnchors: ['middle-left', 'middle-right'], rotateEnabled: false }
    case 'highlight':
    case 'rect':
    case 'ellipse':
    case 'note':
      return {
        enabledAnchors: [
          'top-left', 'top-right', 'bottom-left', 'bottom-right',
          'middle-left', 'middle-right', 'top-center', 'bottom-center',
        ],
        rotateEnabled: false,
      }
    default:
      // ink, stamp : déplacement seul
      return { enabledAnchors: [] as string[], rotateEnabled: false }
  }
}

const TOOLS: { id: EditTool; tip: string; icon: React.ReactNode }[] = [
  { id: 'select', tip: 'Sélection / déplacement', icon: <IconPointer /> },
  { id: 'highlight', tip: 'Surligner (glisser sur le texte)', icon: <IconHighlighter /> },
  { id: 'text', tip: 'Texte libre', icon: <IconType /> },
  { id: 'note', tip: 'Note collante', icon: <IconNote /> },
  { id: 'rect', tip: 'Rectangle', icon: <IconSquare /> },
  { id: 'ellipse', tip: 'Cercle', icon: <IconCircleShape /> },
  { id: 'ink', tip: 'Signature / dessin à main levée', icon: <IconSignature /> },
  { id: 'stamp', tip: 'Tampon', icon: <IconStamp /> },
]

export function Annotator() {
  const {
    pages, currentPageId, docs, tool, setTool, setView,
    selectedAnnotationId, selectAnnotation,
    addAnnotation, updateAnnotation, removeAnnotation, setCurrentPage,
  } = useEditStore()

  const page: EditPage | undefined =
    pages.find((p) => p.id === currentPageId) ?? pages[0]
  const pageIndex = page ? pages.findIndex((p) => p.id === page.id) : -1

  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const [scale, setScale] = useState(1)
  const [bgCanvas, setBgCanvas] = useState<HTMLCanvasElement | null>(null)
  const [draft, setDraft] = useState<DraftShape | null>(null)
  const [inkPoints, setInkPoints] = useState<number[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const drawingRef = useRef(false)

  const disp = page ? displaySize(page) : { width: 1, height: 1 }

  // Rendu du fond de page (qualité 1.5x, réutilisé tant que la page ne change pas)
  useEffect(() => {
    if (!page) return
    let cancelled = false
    setBgCanvas(null)
    renderEditPage(page, docs, 1.5)
      .then((canvas) => {
        if (!cancelled) setBgCanvas(canvas)
      })
      .catch(console.error)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id, page?.rotation])

  // Échelle responsive
  useEffect(() => {
    const el = containerRef.current
    if (!el || !page) return
    const observer = new ResizeObserver(() => {
      setScale(Math.min((el.clientWidth - 16) / disp.width, 1.5))
    })
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disp.width, page?.id])

  // Transformer
  useEffect(() => {
    const tr = trRef.current
    const stage = stageRef.current
    if (!tr || !stage) return
    const node = selectedAnnotationId ? stage.findOne(`#${selectedAnnotationId}`) : null
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [selectedAnnotationId, page?.annotations])

  // Suppression clavier
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editingId || !page) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotationId) {
        removeAnnotation(page.id, selectedAnnotationId)
      }
      if (e.key === 'Escape') selectAnnotation(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedAnnotationId, editingId, page, removeAnnotation, selectAnnotation])

  const pointerPos = useCallback((): { x: number; y: number } | null => {
    return stageRef.current?.getRelativePointerPosition() ?? null
  }, [])

  if (!page) return null

  function handlePointerDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    const pos = pointerPos()
    if (!pos || !page) return
    const onBackground = e.target === e.target.getStage() || e.target.name() === 'page-bg'

    if (tool === 'select') {
      if (onBackground) selectAnnotation(null)
      return
    }
    if (tool === 'highlight' || tool === 'rect' || tool === 'ellipse') {
      drawingRef.current = true
      setDraft({ tool, x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y })
      return
    }
    if (tool === 'ink') {
      drawingRef.current = true
      setInkPoints([pos.x, pos.y])
      return
    }
    // Outils "au clic" : texte, note, tampon
    if (tool === 'text') {
      const id = newId()
      addAnnotation(page.id, {
        id, type: 'text', x: pos.x, y: pos.y,
        width: 220, text: 'Votre texte', fontSize: 14, color: '#111111',
      })
      setTool('select')
      // Différé : si la textarea montait pendant le mousedown, l'action par
      // défaut du navigateur (focus de la cible cliquée) la refermerait aussitôt
      setTimeout(() => setEditingId(id), 0)
    } else if (tool === 'note') {
      addAnnotation(page.id, {
        id: newId(), type: 'note', x: pos.x, y: pos.y,
        width: 170, height: 120, text: 'Double-cliquez pour éditer', color: NOTE_COLORS[0],
      })
      setTool('select')
    } else if (tool === 'stamp') {
      addAnnotation(page.id, {
        id: newId(), type: 'stamp', x: pos.x, y: pos.y,
        text: STAMP_PRESETS[0], color: '#dc2626', fontSize: 18,
      })
      setTool('select')
    }
  }

  function handlePointerMove() {
    if (!drawingRef.current) return
    const pos = pointerPos()
    if (!pos) return
    if (draft) setDraft({ ...draft, x1: pos.x, y1: pos.y })
    else if (inkPoints) setInkPoints([...inkPoints, pos.x, pos.y])
  }

  function handlePointerUp() {
    if (!drawingRef.current || !page) return
    drawingRef.current = false
    if (draft) {
      const x = Math.min(draft.x0, draft.x1)
      const y = Math.min(draft.y0, draft.y1)
      const w = Math.abs(draft.x1 - draft.x0)
      const h = Math.abs(draft.y1 - draft.y0)
      if (w > 4 && h > 4) {
        if (draft.tool === 'highlight') {
          addAnnotation(page.id, {
            id: newId(), type: 'highlight', x, y, width: w, height: h,
            color: HIGHLIGHT_COLORS[0],
          })
        } else {
          addAnnotation(page.id, {
            id: newId(), type: draft.tool, x, y, width: w, height: h,
            stroke: '#dc2626', strokeWidth: 2,
          })
        }
      }
      setDraft(null)
    }
    if (inkPoints) {
      if (inkPoints.length >= 6) {
        addAnnotation(page.id, {
          id: newId(), type: 'ink', x: 0, y: 0,
          points: inkPoints, stroke: '#1d4ed8', strokeWidth: 2,
        })
      }
      setInkPoints(null)
    }
  }

  const selected = page.annotations.find((a) => a.id === selectedAnnotationId)
  const editing = page.annotations.find((a) => a.id === editingId)
  const trConfig = transformerConfig(selected)

  return (
    <div className="flex flex-col gap-3">
      {/* Navigation + propriétés contextuelles */}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-sm btn-ghost rounded-full gap-1" onClick={() => setView('grid')}>
          <IconGrid /> Pages
        </button>
        <div className="join">
          <button
            className="btn btn-sm btn-square join-item"
            disabled={pageIndex <= 0}
            onClick={() => setCurrentPage(pages[pageIndex - 1].id)}
          >
            <IconChevronLeft />
          </button>
          <span className="btn btn-sm join-item pointer-events-none">
            {pageIndex + 1} / {pages.length}
          </span>
          <button
            className="btn btn-sm btn-square join-item"
            disabled={pageIndex >= pages.length - 1}
            onClick={() => setCurrentPage(pages[pageIndex + 1].id)}
          >
            <IconChevronRight />
          </button>
        </div>

        {selected && (
          <div className="flex items-center gap-2 bg-base-100 border border-base-300/50 shadow-sm rounded-full px-3 py-1">
            {selected.type === 'highlight' && (
              <div className="flex gap-1">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`w-5 h-5 rounded-full border-2 ${selected.color === c ? 'border-base-content' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    onClick={() => updateAnnotation(page.id, selected.id, { color: c })}
                  />
                ))}
              </div>
            )}
            {selected.type === 'note' && (
              <div className="flex gap-1">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`w-5 h-5 rounded-full border-2 ${selected.color === c ? 'border-base-content' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    onClick={() => updateAnnotation(page.id, selected.id, { color: c })}
                  />
                ))}
              </div>
            )}
            {selected.type === 'text' && (
              <>
                <input
                  type="number" className="input input-xs w-14" min={6} max={72}
                  value={selected.fontSize}
                  onChange={(e) =>
                    updateAnnotation(page.id, selected.id, { fontSize: Number(e.target.value) || 12 })
                  }
                />
                <input
                  type="color" className="w-6 h-6 cursor-pointer rounded"
                  value={selected.color}
                  onChange={(e) => updateAnnotation(page.id, selected.id, { color: e.target.value })}
                />
              </>
            )}
            {(selected.type === 'rect' || selected.type === 'ellipse' || selected.type === 'ink') && (
              <>
                <input
                  type="color" className="w-6 h-6 cursor-pointer rounded"
                  value={selected.stroke}
                  onChange={(e) => updateAnnotation(page.id, selected.id, { stroke: e.target.value })}
                />
                <input
                  type="number" className="input input-xs w-14" min={1} max={20}
                  value={selected.strokeWidth}
                  onChange={(e) =>
                    updateAnnotation(page.id, selected.id, { strokeWidth: Number(e.target.value) || 2 })
                  }
                />
              </>
            )}
            {selected.type === 'stamp' && (
              <>
                <select
                  className="select select-xs w-36"
                  value={STAMP_PRESETS.includes(selected.text) ? selected.text : '__custom'}
                  onChange={(e) => {
                    if (e.target.value !== '__custom') {
                      updateAnnotation(page.id, selected.id, { text: e.target.value })
                    }
                  }}
                >
                  {STAMP_PRESETS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                  {!STAMP_PRESETS.includes(selected.text) && (
                    <option value="__custom">{selected.text}</option>
                  )}
                </select>
                <input
                  type="color" className="w-6 h-6 cursor-pointer rounded"
                  value={selected.color}
                  onChange={(e) => updateAnnotation(page.id, selected.id, { color: e.target.value })}
                />
              </>
            )}
            <button
              className="btn btn-xs btn-square btn-error btn-soft"
              title="Supprimer l'annotation"
              onClick={() => removeAnnotation(page.id, selected.id)}
            >
              <IconTrash />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-3 items-start">
        {/* Rail d'outils */}
        <div className="flex lg:flex-col items-center gap-1 bg-base-100 border border-base-300/50 shadow-md rounded-2xl p-1.5 self-start flex-wrap">
          {TOOLS.map((t) => (
            <div key={t.id} className="tooltip tooltip-bottom lg:tooltip-right" data-tip={t.tip}>
              <button
                className={`btn btn-sm btn-square ${tool === t.id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTool(t.id)}
              >
                {t.icon}
              </button>
            </div>
          ))}
        </div>

        {/* Page + annotations */}
        <div ref={containerRef} className="flex-1 min-w-0 w-full flex justify-center relative">
          <div
            className="shadow-2xl shadow-base-content/10 ring-1 ring-base-content/10 bg-white relative rounded-sm"
            style={{
              width: disp.width * scale,
              height: disp.height * scale,
              cursor: tool === 'select' ? 'default' : 'crosshair',
            }}
          >
            {!bgCanvas && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="loading loading-spinner text-primary" />
              </div>
            )}
            <Stage
              ref={stageRef}
              width={disp.width * scale}
              height={disp.height * scale}
              scaleX={scale}
              scaleY={scale}
              onMouseDown={handlePointerDown}
              onTouchStart={handlePointerDown}
              onMouseMove={handlePointerMove}
              onTouchMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onTouchEnd={handlePointerUp}
            >
              <Layer>
                {bgCanvas && (
                  <KImage
                    name="page-bg"
                    image={bgCanvas}
                    x={0}
                    y={0}
                    width={disp.width}
                    height={disp.height}
                  />
                )}
                {page.annotations.map((ann) => (
                  <AnnNode
                    key={ann.id}
                    ann={ann}
                    pageId={page.id}
                    interactive={tool === 'select'}
                    onSelect={() => tool === 'select' && selectAnnotation(ann.id)}
                    onEditText={() => setEditingId(ann.id)}
                  />
                ))}
                {/* Aperçu du tracé en cours */}
                {draft && (
                  <Rect
                    x={Math.min(draft.x0, draft.x1)}
                    y={Math.min(draft.y0, draft.y1)}
                    width={Math.abs(draft.x1 - draft.x0)}
                    height={Math.abs(draft.y1 - draft.y0)}
                    fill={draft.tool === 'highlight' ? HIGHLIGHT_COLORS[0] : undefined}
                    opacity={draft.tool === 'highlight' ? 0.45 : 1}
                    stroke={draft.tool === 'highlight' ? undefined : '#dc2626'}
                    strokeWidth={draft.tool === 'highlight' ? 0 : 2}
                    listening={false}
                  />
                )}
                {inkPoints && (
                  <Line
                    points={inkPoints}
                    stroke="#1d4ed8"
                    strokeWidth={2}
                    lineCap="round"
                    lineJoin="round"
                    listening={false}
                  />
                )}
                <Transformer
                  ref={trRef}
                  enabledAnchors={trConfig.enabledAnchors}
                  rotateEnabled={trConfig.rotateEnabled}
                  keepRatio={false}
                  flipEnabled={false}
                  boundBoxFunc={(oldBox, newBox) =>
                    newBox.width < 5 || newBox.height < 5 ? oldBox : newBox
                  }
                />
              </Layer>
            </Stage>

            {/* Édition du texte des annotations texte / note / tampon */}
            {editing && (editing.type === 'text' || editing.type === 'note' || editing.type === 'stamp') && (
              <textarea
                autoFocus
                className="absolute bg-base-100/90 outline-2 outline-primary resize-none p-1 m-0 text-sm rounded"
                style={{
                  left: editing.x * scale,
                  top: editing.y * scale,
                  width:
                    (editing.type === 'stamp' ? 200 : editing.width * scale) as number,
                  minHeight: editing.type === 'note' ? editing.height * scale : 40,
                }}
                defaultValue={editing.text}
                onBlur={(e) => {
                  const text = e.target.value.trim()
                  if (text) updateAnnotation(page.id, editing.id, { text })
                  setEditingId(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
                  if (e.key === 'Enter' && editing.type === 'stamp') {
                    e.preventDefault()
                    ;(e.target as HTMLTextAreaElement).blur()
                  }
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
