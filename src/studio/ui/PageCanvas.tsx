import { memo, useEffect, useRef, useState } from 'react'
import {
  Stage, Layer, Rect, Ellipse, Text, Line, Arrow, Label, Tag, Group, Image as KImage, Transformer,
} from 'react-konva'
import type Konva from 'konva'
import { useStudio } from '../store'
import { CANVAS_FONTS } from '../../lib/fonts'
import { getPageTextItems, loadImage, textRectsInZone } from '../render'
import { displaySize, newId, type Annotation, type StudioPage } from '../types'
import { toast } from '../../components/ui/Toast'
import { PageBitmap } from './PageBitmap'
import { TextLayer, usePageText } from './TextLayer'

/**
 * Une page du lecteur : rendu du fond (canvas mis en cache) + couche Konva
 * pour les annotations, dans le repère d'affichage de la page (points PDF,
 * origine haut-gauche). Tous les outils de création passent par ici.
 */

type Box = { x: number; y: number; width: number; height: number }

interface Draft {
  tool: 'highlight' | 'rect' | 'ellipse' | 'redact' | 'line' | 'arrow'
  x0: number
  y0: number
  x1: number
  y1: number
}

const BOX_TOOLS = new Set(['highlight', 'rect', 'ellipse', 'redact', 'line', 'arrow'])
/** Outils qui restent actifs après usage (on enchaîne souvent plusieurs tracés). */
const STICKY_TOOLS = new Set(['highlight', 'ink', 'redact'])

function fontStyle(a: { bold?: boolean; italic?: boolean }) {
  return [a.italic && 'italic', a.bold && 'bold'].filter(Boolean).join(' ') || 'normal'
}

function useLoadedImage(dataUrl: string | undefined) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!dataUrl) return
    let cancelled = false
    loadImage(dataUrl).then((i) => !cancelled && setImg(i)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [dataUrl])
  return img
}

function ImageNode(props: Omit<Konva.ImageConfig, 'image'> & { dataUrl: string }) {
  const img = useLoadedImage(props.dataUrl)
  const { dataUrl: _ignored, ...rest } = props
  void _ignored
  return <KImage {...rest} image={img ?? undefined} />
}

const AnnShape = memo(function AnnShape({
  ann, pageId, interactive,
}: {
  ann: Annotation
  pageId: string
  interactive: boolean
}) {
  const updateAnnotation = useStudio((s) => s.updateAnnotation)
  const selectAnnotation = useStudio((s) => s.selectAnnotation)
  const setEditingAnn = useStudio((s) => s.setEditingAnn)

  const select = () => selectAnnotation({ pageId, id: ann.id })
  const edit = () => {
    if (ann.type === 'text' || ann.type === 'note' || ann.type === 'stamp') setEditingAnn({ pageId, id: ann.id })
  }

  const common = {
    id: ann.id,
    x: ann.x,
    y: ann.y,
    draggable: interactive,
    listening: interactive,
    onClick: select,
    onTap: select,
    onDragStart: select,
    onDblClick: edit,
    onDblTap: edit,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      updateAnnotation(pageId, ann.id, { x: e.target.x(), y: e.target.y() })
    },
    onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (interactive) e.target.getStage()!.container().style.cursor = 'move'
    },
    onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => {
      e.target.getStage()!.container().style.cursor = ''
    },
  }

  function resizeEnd(e: Konva.KonvaEventObject<Event>) {
    const node = e.target
    const sx = node.scaleX()
    const sy = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)
    if (ann.type === 'text') {
      updateAnnotation(pageId, ann.id, { x: node.x(), y: node.y(), width: Math.max(24, ann.width * sx) })
    } else if ('width' in ann && 'height' in ann) {
      updateAnnotation(pageId, ann.id, {
        x: node.x(), y: node.y(),
        width: Math.max(6, ann.width * sx), height: Math.max(6, ann.height * sy),
      })
    }
  }

  switch (ann.type) {
    case 'highlight':
      return ann.rects?.length ? (
        <Group {...common}>
          {ann.rects.map((r, i) => (
            <Rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} fill={ann.color} opacity={0.45} />
          ))}
        </Group>
      ) : (
        <Rect {...common} width={ann.width} height={ann.height} fill={ann.color} opacity={0.45} onTransformEnd={resizeEnd} />
      )
    case 'rect':
      return (
        <Rect
          {...common} width={ann.width} height={ann.height}
          stroke={ann.stroke} strokeWidth={ann.strokeWidth} fill={ann.fill}
          strokeScaleEnabled={false} onTransformEnd={resizeEnd}
        />
      )
    case 'redact':
      return <Rect {...common} width={ann.width} height={ann.height} fill={ann.color} onTransformEnd={resizeEnd} />
    case 'ellipse':
      return (
        <Ellipse
          {...common}
          x={ann.x + ann.width / 2} y={ann.y + ann.height / 2}
          radiusX={ann.width / 2} radiusY={ann.height / 2}
          stroke={ann.stroke} strokeWidth={ann.strokeWidth} fill={ann.fill} strokeScaleEnabled={false}
          onDragEnd={(e) => updateAnnotation(pageId, ann.id, { x: e.target.x() - ann.width / 2, y: e.target.y() - ann.height / 2 })}
          onTransformEnd={(e) => {
            const node = e.target
            const w = Math.max(6, ann.width * node.scaleX())
            const h = Math.max(6, ann.height * node.scaleY())
            node.scaleX(1)
            node.scaleY(1)
            updateAnnotation(pageId, ann.id, { x: node.x() - w / 2, y: node.y() - h / 2, width: w, height: h })
          }}
        />
      )
    case 'line':
      return (
        <Line
          {...common} points={[0, 0, ann.dx, ann.dy]} stroke={ann.stroke} strokeWidth={ann.strokeWidth}
          lineCap="round" hitStrokeWidth={Math.max(14, ann.strokeWidth)}
        />
      )
    case 'arrow':
      return (
        <Arrow
          {...common} points={[0, 0, ann.dx, ann.dy]} stroke={ann.stroke} fill={ann.stroke}
          strokeWidth={ann.strokeWidth} pointerLength={Math.max(8, ann.strokeWidth * 4)}
          pointerWidth={Math.max(8, ann.strokeWidth * 4)} lineCap="round" hitStrokeWidth={Math.max(14, ann.strokeWidth)}
        />
      )
    case 'ink':
      return (
        <Line
          {...common} points={ann.points} stroke={ann.stroke} strokeWidth={ann.strokeWidth}
          lineCap="round" lineJoin="round" tension={0.3} hitStrokeWidth={Math.max(14, ann.strokeWidth)}
        />
      )
    case 'text':
      return (
        <Label {...common} onTransformEnd={resizeEnd}>
          <Tag fill={ann.background ?? 'rgba(0,0,0,0)'} />
          <Text
            text={ann.text || ' '}
            width={ann.width}
            fontSize={ann.fontSize}
            fontFamily={CANVAS_FONTS[ann.fontFamily ?? 'Helvetica']}
            fontStyle={fontStyle(ann)}
            align={ann.align ?? 'left'}
            fill={ann.color}
            lineHeight={1.15}
            wrap="word"
          />
        </Label>
      )
    case 'note':
      return (
        <Group {...common} onTransformEnd={resizeEnd}>
          <Rect
            width={ann.width} height={ann.height} fill={ann.color}
            stroke="rgba(0,0,0,0.15)" strokeWidth={1}
            shadowColor="black" shadowBlur={6} shadowOpacity={0.18} shadowOffsetY={2}
          />
          <Text
            text={ann.text} width={ann.width} height={ann.height} padding={8}
            fontSize={11} fontFamily={CANVAS_FONTS.Helvetica} fill="#333333" lineHeight={1.15}
          />
        </Group>
      )
    case 'stamp':
      return (
        <Label {...common}>
          <Tag stroke={ann.color} strokeWidth={2} cornerRadius={2} />
          <Text
            text={ann.text} fontSize={ann.fontSize} fontStyle="bold"
            fontFamily={CANVAS_FONTS.Helvetica} fill={ann.color} padding={7}
          />
        </Label>
      )
    case 'image':
      return (
        <ImageNode {...common} dataUrl={ann.dataUrl} width={ann.width} height={ann.height} onTransformEnd={resizeEnd} />
      )
  }
})

function transformerConfig(ann: Annotation | undefined) {
  const all = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']
  if (!ann) return { anchors: [] as string[], keepRatio: false }
  switch (ann.type) {
    case 'text':
      return { anchors: ['middle-left', 'middle-right'], keepRatio: false }
    case 'image':
      return { anchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], keepRatio: true }
    case 'highlight':
      return { anchors: ann.rects?.length ? [] : all, keepRatio: false }
    case 'rect':
    case 'ellipse':
    case 'note':
    case 'redact':
      return { anchors: all, keepRatio: false }
    default:
      return { anchors: [] as string[], keepRatio: false }
  }
}

/** Lit un fichier image en dataURL, réduit si très grand (PDF plus léger). */
async function readImageFile(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const max = 1600
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * k)
    canvas.height = Math.round(img.naturalHeight * k)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const png = file.type === 'image/png' || file.type === 'image/svg+xml'
    return {
      dataUrl: canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88),
      width: img.naturalWidth,
      height: img.naturalHeight,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export const PageCanvas = memo(function PageCanvas({
  page, scale, visible, index,
}: {
  page: StudioPage
  /** Pixels CSS par point PDF. */
  scale: number
  visible: boolean
  index: number
}) {
  const docs = useStudio((s) => s.docs)
  const tool = useStudio((s) => s.tool)
  const opts = useStudio((s) => s.toolOptions)
  const selectedAnn = useStudio((s) => (s.selectedAnn?.pageId === page.id ? s.selectedAnn.id : null))
  const editingId = useStudio((s) => (s.editingAnn?.pageId === page.id ? s.editingAnn.id : null))
  const flash = useStudio((s) => (s.flash?.pageId === page.id ? s.flash : null))
  const watermark = useStudio((s) => s.watermark)
  const addAnnotation = useStudio((s) => s.addAnnotation)
  const updateAnnotation = useStudio((s) => s.updateAnnotation)
  const removeAnnotation = useStudio((s) => s.removeAnnotation)
  const selectAnnotation = useStudio((s) => s.selectAnnotation)
  const setEditingAnn = useStudio((s) => s.setEditingAnn)
  const setTool = useStudio((s) => s.setTool)
  const setRightPanel = useStudio((s) => s.setRightPanel)
  const setCurrentPage = useStudio((s) => s.setCurrentPage)

  const { width: W, height: H } = displaySize(page)
  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const highlightLayerRef = useRef<Konva.Layer>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingImagePos = useRef<{ x: number; y: number } | null>(null)
  const drawing = useRef(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [ink, setInk] = useState<number[] | null>(null)

  const textInfo = usePageText(page, docs, visible)
  const textSelect = tool === 'text-select'
  // Outil flèche : le texte est sélectionnable, sauf quand la souris survole
  // une annotation (qui garde alors la main : déplacement, redimensionnement)
  const [overAnn, setOverAnn] = useState(false)
  const textMode: 'off' | 'select' | 'text' = textSelect ? 'text' : tool === 'select' && !overAnn ? 'select' : 'off'

  function trackHover(e: React.MouseEvent) {
    if (tool !== 'select' || e.buttons) return
    const stage = stageRef.current
    if (!stage) return
    const r = stage.container().getBoundingClientRect()
    const hit = !!stage.getIntersection({ x: e.clientX - r.left, y: e.clientY - r.top })
    if (hit !== overAnn) setOverAnn(hit)
  }

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

  // Surlignage façon « feutre » : la couche des surlignages se fond (multiply)
  // avec le rendu de la page situé dessous.
  useEffect(() => {
    const el = highlightLayerRef.current?.getCanvas()._canvas
    if (el) el.style.mixBlendMode = 'multiply'
  }, [visible])

  // Transformer sur l'annotation sélectionnée
  useEffect(() => {
    const tr = trRef.current
    const stage = stageRef.current
    if (!tr || !stage) return
    const node = selectedAnn && tool === 'select' ? stage.findOne(`#${selectedAnn}`) : null
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [selectedAnn, page.annotations, tool, visible])

  const pos = () => stageRef.current?.getRelativePointerPosition() ?? null

  function finishTool() {
    if (!STICKY_TOOLS.has(tool)) setTool('select')
  }

  async function onPointerDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (tool === 'hand' || tool === 'text-select') return
    if ('button' in e.evt && e.evt.button !== 0) return
    const p = pos()
    if (!p) return
    const onBackground = e.target === e.target.getStage()

    if (tool === 'select') {
      if (onBackground) selectAnnotation(null)
      return
    }
    if (BOX_TOOLS.has(tool)) {
      drawing.current = true
      setDraft({ tool: tool as Draft['tool'], x0: p.x, y0: p.y, x1: p.x, y1: p.y })
      return
    }
    if (tool === 'ink') {
      drawing.current = true
      setInk([p.x, p.y])
      return
    }
    if (tool === 'text') {
      const id = newId()
      addAnnotation(page.id, {
        id, type: 'text', x: p.x, y: p.y - opts.fontSize * 0.6, width: 220, text: '',
        fontSize: opts.fontSize, color: opts.textColor, fontFamily: 'Helvetica',
      })
      setTool('select')
      // Différé : sinon le focus par défaut du mousedown refermerait la saisie
      setTimeout(() => setEditingAnn({ pageId: page.id, id }), 0)
      return
    }
    if (tool === 'edit-text') {
      const items = await getPageTextItems(page, docs)
      const hit = items.find((i) => p.x >= i.x - 2 && p.x <= i.x + i.width + 2 && p.y >= i.y - 2 && p.y <= i.y + i.height + 2)
      if (!hit) {
        toast.info(items.length
          ? 'Cliquez directement sur une ligne de texte à modifier.'
          : 'Aucun texte détecté sur cette page : lancez d’abord l’OCR (panneau OCR).')
        return
      }
      const id = newId()
      // Hauteur de l'élément pdf.js = corps de la police
      const size = Math.max(5, Math.round(hit.height * 10) / 10)
      addAnnotation(page.id, {
        id, type: 'text', x: hit.x - 1, y: hit.y - hit.height * 0.06,
        width: hit.width + Math.max(24, size * 3), text: hit.text.trim(), fontSize: size,
        color: '#111111', fontFamily: 'Helvetica', background: '#ffffff',
        comment: undefined,
      })
      setTool('select')
      setTimeout(() => setEditingAnn({ pageId: page.id, id }), 0)
      return
    }
    if (tool === 'note') {
      const id = newId()
      addAnnotation(page.id, { id, type: 'note', x: p.x, y: p.y, width: 180, height: 110, text: '', color: opts.noteColor })
      setTool('select')
      setTimeout(() => setEditingAnn({ pageId: page.id, id }), 0)
      return
    }
    if (tool === 'stamp') {
      addAnnotation(page.id, {
        id: newId(), type: 'stamp', x: p.x, y: p.y, text: opts.stampText || 'APPROUVÉ', color: opts.stampColor, fontSize: 18,
      })
      finishTool()
      return
    }
    if (tool === 'image') {
      pendingImagePos.current = p
      fileRef.current?.click()
    }
  }

  function onPointerMove() {
    if (!drawing.current) return
    const p = pos()
    if (!p) return
    if (draft) setDraft({ ...draft, x1: p.x, y1: p.y })
    else if (ink) setInk([...ink, p.x, p.y])
  }

  async function onPointerUp() {
    if (!drawing.current) return
    drawing.current = false
    if (draft) {
      const d = draft
      setDraft(null)
      const box: Box = {
        x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1),
        width: Math.abs(d.x1 - d.x0), height: Math.abs(d.y1 - d.y0),
      }
      if (d.tool === 'line' || d.tool === 'arrow') {
        if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 4) return
        addAnnotation(page.id, {
          id: newId(), type: d.tool, x: d.x0, y: d.y0, dx: d.x1 - d.x0, dy: d.y1 - d.y0,
          stroke: opts.strokeColor, strokeWidth: opts.strokeWidth,
        })
        finishTool()
        return
      }
      if (d.tool === 'highlight') {
        if (opts.snapToText) {
          const items = await getPageTextItems(page, docs)
          // Un simple « trait » sur une ligne suffit : on élargit la zone en hauteur
          const zone = box.height < 4 ? { ...box, y: box.y - 3, height: 6 } : box
          const hit = textRectsInZone(items, zone)
          if (hit) {
            const x = Math.min(...hit.rects.map((r) => r.x))
            const y = Math.min(...hit.rects.map((r) => r.y))
            const x1 = Math.max(...hit.rects.map((r) => r.x + r.width))
            const y1 = Math.max(...hit.rects.map((r) => r.y + r.height))
            addAnnotation(page.id, {
              id: newId(), type: 'highlight', x, y, width: x1 - x, height: y1 - y, color: opts.highlightColor,
              rects: hit.rects.map((r) => ({ ...r, x: r.x - x, y: r.y - y })), quote: hit.quote,
            })
            return
          }
        }
        if (box.width < 4 || box.height < 4) return
        addAnnotation(page.id, { id: newId(), type: 'highlight', ...box, color: opts.highlightColor })
        return
      }
      if (box.width < 4 || box.height < 4) return
      if (d.tool === 'redact') {
        addAnnotation(page.id, { id: newId(), type: 'redact', ...box, color: '#000000' })
        return
      }
      addAnnotation(page.id, {
        id: newId(), type: d.tool, ...box, stroke: opts.strokeColor, strokeWidth: opts.strokeWidth,
      })
      finishTool()
      return
    }
    if (ink) {
      const pts = ink
      setInk(null)
      if (pts.length >= 6) {
        addAnnotation(page.id, { id: newId(), type: 'ink', x: 0, y: 0, points: pts, stroke: opts.inkColor, strokeWidth: opts.strokeWidth })
      }
    }
  }

  async function onImagePicked(file: File | undefined) {
    const p = pendingImagePos.current
    pendingImagePos.current = null
    if (!file || !p) return
    try {
      const img = await readImageFile(file)
      const w = Math.min(220, W * 0.6)
      const h = (img.height / img.width) * w
      addAnnotation(page.id, { id: newId(), type: 'image', x: p.x, y: p.y, width: w, height: h, dataUrl: img.dataUrl })
      setTool('select')
    } catch {
      toast.error('Image illisible')
    }
  }

  const selected = page.annotations.find((a) => a.id === selectedAnn)
  const tr = transformerConfig(selected)
  const editing = page.annotations.find((a) => a.id === editingId)
  const interactive = tool === 'select'
  const highlights = page.annotations.filter((a) => a.type === 'highlight')
  const others = page.annotations.filter((a) => a.type !== 'highlight')

  const cursor =
    tool === 'select' ? 'default'
      : tool === 'hand' ? 'grab'
        : tool === 'text' || tool === 'edit-text' || tool === 'text-select' ? 'text'
          : 'crosshair'

  return (
    <div
      className="studio-page"
      data-page-id={page.id}
      style={{ width: W * scale, height: H * scale, cursor }}
      onMouseMove={trackHover}
      onMouseLeave={() => overAnn && setOverAnn(false)}
    >
      {visible && (
        <>
          <PageBitmap page={page} docs={docs} scale={scale * dpr} />
          <Stage
            ref={stageRef}
            className="studio-stage"
            style={textSelect ? { pointerEvents: 'none' } : undefined}
            width={W * scale}
            height={H * scale}
            scaleX={scale}
            scaleY={scale}
            onMouseDown={(e) => void onPointerDown(e)}
            onTouchStart={(e) => void onPointerDown(e)}
            onMouseMove={onPointerMove}
            onTouchMove={onPointerMove}
            onMouseUp={() => void onPointerUp()}
            onTouchEnd={() => void onPointerUp()}
            onMouseLeave={() => drawing.current && void onPointerUp()}
          >
            <Layer ref={highlightLayerRef}>
              {highlights.map((ann) => (
                <AnnShape key={ann.id} ann={ann} pageId={page.id} interactive={interactive} />
              ))}
              {draft?.tool === 'highlight' && (
                <Rect
                  x={Math.min(draft.x0, draft.x1)} y={Math.min(draft.y0, draft.y1)}
                  width={Math.abs(draft.x1 - draft.x0)} height={Math.max(2, Math.abs(draft.y1 - draft.y0))}
                  fill={opts.highlightColor} opacity={0.45} listening={false}
                />
              )}
            </Layer>
            <Layer>
              {others.map((ann) =>
                ann.id === editingId && ann.type === 'text' ? null : (
                  <AnnShape key={ann.id} ann={ann} pageId={page.id} interactive={interactive} />
                )
              )}
              {draft && draft.tool !== 'highlight' && <DraftShape draft={draft} opts={opts} />}
              {ink && (
                <Line points={ink} stroke={opts.inkColor} strokeWidth={opts.strokeWidth} lineCap="round" lineJoin="round" listening={false} />
              )}
              <Transformer
                ref={trRef}
                enabledAnchors={tr.anchors}
                rotateEnabled={false}
                keepRatio={tr.keepRatio}
                flipEnabled={false}
                ignoreStroke
                anchorSize={8}
                borderStroke="#6d5dfc"
                anchorStroke="#6d5dfc"
                boundBoxFunc={(oldBox, newBox) => (newBox.width < 5 || newBox.height < 5 ? oldBox : newBox)}
              />
            </Layer>
          </Stage>

          {textInfo && textInfo.items.length > 0 && (
            <TextLayer
              items={textInfo.items}
              scale={scale}
              mode={textMode}
              onBackgroundDown={() => selectedAnn && selectAnnotation(null)}
            />
          )}
          {textSelect && textInfo?.kind === 'none' && (
            <div className="studio-notext-hint">
              <strong>Aucun texte sur cette page</strong>
              <span>C’est une image (scan, photo). Lancez l’OCR pour rendre le texte sélectionnable.</span>
              <button
                className="btn btn-xs btn-primary rounded-full"
                onClick={() => { setCurrentPage(page.id); setRightPanel('ocr') }}
              >
                Ouvrir l’OCR
              </button>
            </div>
          )}

          {watermark?.text && (
            <span
              className="studio-watermark"
              style={{
                fontSize: watermark.fontSize * scale,
                color: watermark.color,
                opacity: watermark.opacity,
                transform: `translate(-50%, -50%) rotate(${watermark.diagonal ? (-Math.atan2(H, W) * 180) / Math.PI : 0}deg)`,
              }}
            >
              {watermark.text}
            </span>
          )}

          {flash && (
            <div key={flash.nonce} className="studio-flash-layer">
              {flash.rects.map((r, i) => (
                <span
                  key={i}
                  className="studio-flash"
                  style={{ left: r.x * scale - 2, top: r.y * scale - 2, width: r.width * scale + 4, height: r.height * scale + 4 }}
                />
              ))}
            </div>
          )}

          {editing && (editing.type === 'text' || editing.type === 'note' || editing.type === 'stamp') && (
            <textarea
              autoFocus
              className={`studio-inline-editor is-${editing.type}`}
              style={{
                left: editing.x * scale,
                top: editing.y * scale,
                width: editing.type === 'stamp' ? 220 : editing.width * scale,
                minHeight: editing.type === 'note' ? editing.height * scale : undefined,
                fontSize: editing.type === 'text' ? editing.fontSize * scale : 13,
                lineHeight: 1.15,
                fontFamily: editing.type === 'text' ? CANVAS_FONTS[editing.fontFamily ?? 'Helvetica'] : undefined,
                fontWeight: editing.type === 'text' && editing.bold ? 700 : undefined,
                fontStyle: editing.type === 'text' && editing.italic ? 'italic' : undefined,
                textAlign: editing.type === 'text' ? editing.align ?? 'left' : undefined,
                color: editing.type === 'text' ? editing.color : undefined,
                background: editing.type === 'text' ? editing.background ?? 'rgba(255,255,255,0.85)' : undefined,
              }}
              defaultValue={editing.text}
              onFocus={(e) => {
                const t = e.currentTarget
                t.setSelectionRange(t.value.length, t.value.length)
                t.style.height = 'auto'
                t.style.height = `${t.scrollHeight}px`
              }}
              placeholder={editing.type === 'note' ? 'Votre commentaire…' : 'Saisissez votre texte…'}
              rows={editing.type === 'text' ? Math.max(1, editing.text.split('\n').length) : 3}
              onInput={(e) => {
                const t = e.currentTarget
                t.style.height = 'auto'
                t.style.height = `${t.scrollHeight}px`
              }}
              onBlur={(e) => {
                const text = e.target.value.replace(/\s+$/, '')
                if (!text.trim() && editing.type !== 'note') removeAnnotation(page.id, editing.id)
                else if (text !== editing.text) updateAnnotation(page.id, editing.id, { text })
                setEditingAnn(null)
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') e.currentTarget.blur()
                if (e.key === 'Enter' && (editing.type === 'stamp' || e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
              }}
            />
          )}
        </>
      )}
      <div className="studio-page-number">
        <span>{index + 1}</span>
        {textInfo && (
          <button
            className={`studio-text-status is-${textInfo.kind}`}
            title={
              textInfo.kind === 'native' ? 'La page contient du texte : il est sélectionnable et cherchable'
                : textInfo.kind === 'ocr' ? 'Texte reconnu par OCR : sélectionnable et cherchable'
                  : 'Page image sans texte : cliquez pour lancer l’OCR'
            }
            onClick={() => {
              if (textInfo.kind === 'none') {
                setCurrentPage(page.id)
                setRightPanel('ocr')
              } else setTool('text-select')
            }}
          >
            {textInfo.kind === 'native' ? 'Texte sélectionnable' : textInfo.kind === 'ocr' ? 'Texte OCR' : 'Image sans texte · OCR'}
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        hidden
        onChange={(e) => {
          void onImagePicked(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
})

function DraftShape({ draft, opts }: { draft: Draft; opts: { strokeColor: string; strokeWidth: number } }) {
  const x = Math.min(draft.x0, draft.x1)
  const y = Math.min(draft.y0, draft.y1)
  const w = Math.abs(draft.x1 - draft.x0)
  const h = Math.abs(draft.y1 - draft.y0)
  switch (draft.tool) {
    case 'redact':
      return <Rect x={x} y={y} width={w} height={h} fill="#000" opacity={0.6} listening={false} />
    case 'ellipse':
      return (
        <Ellipse x={x + w / 2} y={y + h / 2} radiusX={w / 2} radiusY={h / 2} stroke={opts.strokeColor} strokeWidth={opts.strokeWidth} listening={false} />
      )
    case 'line':
      return <Line points={[draft.x0, draft.y0, draft.x1, draft.y1]} stroke={opts.strokeColor} strokeWidth={opts.strokeWidth} lineCap="round" listening={false} />
    case 'arrow':
      return (
        <Arrow
          points={[draft.x0, draft.y0, draft.x1, draft.y1]} stroke={opts.strokeColor} fill={opts.strokeColor}
          strokeWidth={opts.strokeWidth} pointerLength={Math.max(8, opts.strokeWidth * 4)} pointerWidth={Math.max(8, opts.strokeWidth * 4)} listening={false}
        />
      )
    default:
      return <Rect x={x} y={y} width={w} height={h} stroke={opts.strokeColor} strokeWidth={opts.strokeWidth} listening={false} />
  }
}
