import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Rect, Ellipse, Text, Line, Arrow, Image as KImage, Transformer } from 'react-konva'
import type Konva from 'konva'
import useImage from 'use-image'
import { CANVAS_FONTS, preloadCanvasFonts } from '../../lib/fonts'
import { useCreateStore } from './store'
import { newId, type ImageElement, type PdfElement, type TextElement } from './types'
import { toast } from '../../components/ui/Toast'

/**
 * Éditeur de page : rendu Konva à l'échelle, sélection + Transformer,
 * édition de texte par double-clic (textarea superposée), drop d'images.
 * Les coordonnées des nœuds sont en points PDF, le Stage applique l'échelle.
 */

interface ElementNodeProps {
  el: PdfElement
  onSelect: () => void
}

function ElementNode({ el, onSelect }: ElementNodeProps) {
  const updateElement = useCreateStore((s) => s.updateElement)

  const common = {
    id: el.id,
    x: el.x,
    y: el.y,
    rotation: el.rotation,
    draggable: true,
    onClick: onSelect,
    onTap: onSelect,
    onDragStart: onSelect,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      updateElement(el.id, { x: e.target.x(), y: e.target.y() })
    },
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
      const node = e.target
      const scaleX = node.scaleX()
      const scaleY = node.scaleY()
      node.scaleX(1)
      node.scaleY(1)
      const base = { x: node.x(), y: node.y(), rotation: node.rotation() }
      if (el.type === 'text') {
        updateElement(el.id, {
          ...base,
          rotation: el.rotation,
          width: Math.max(20, el.width * scaleX),
        })
      } else if (el.type === 'line' || el.type === 'arrow') {
        updateElement(el.id, { ...base, length: Math.max(10, el.length * scaleX) })
      } else if (el.type === 'image' || el.type === 'rect' || el.type === 'ellipse') {
        updateElement(el.id, {
          ...base,
          width: Math.max(5, el.width * scaleX),
          height: Math.max(5, el.height * scaleY),
        })
      }
    },
  }

  switch (el.type) {
    case 'text':
      return (
        <Text
          {...common}
          text={el.text}
          width={el.width}
          fontSize={el.fontSize}
          fontFamily={CANVAS_FONTS[el.fontFamily]}
          fontStyle={
            `${el.bold ? 'bold' : ''} ${el.italic ? 'italic' : ''}`.trim() || 'normal'
          }
          fill={el.color}
          align={el.align}
          lineHeight={1}
        />
      )
    case 'image':
      return <ImageNode el={el} common={common} />
    case 'rect':
      return (
        <Rect
          {...common}
          width={el.width}
          height={el.height}
          fill={el.fill}
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
        />
      )
    case 'ellipse':
      // Konva.Ellipse est centré : on décale pour garder un modèle "boîte haut-gauche"
      return (
        <Ellipse
          {...common}
          x={el.x + el.width / 2}
          y={el.y + el.height / 2}
          radiusX={el.width / 2}
          radiusY={el.height / 2}
          fill={el.fill}
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
          onDragEnd={(e) =>
            updateElement(el.id, {
              x: e.target.x() - el.width / 2,
              y: e.target.y() - el.height / 2,
            })
          }
          onTransformEnd={(e) => {
            const node = e.target
            const w = Math.max(5, el.width * node.scaleX())
            const h = Math.max(5, el.height * node.scaleY())
            node.scaleX(1)
            node.scaleY(1)
            updateElement(el.id, { x: node.x() - w / 2, y: node.y() - h / 2, width: w, height: h })
          }}
        />
      )
    case 'line':
      return (
        <Line
          {...common}
          points={[0, 0, el.length, 0]}
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
          hitStrokeWidth={Math.max(14, el.strokeWidth)}
        />
      )
    case 'arrow':
      return (
        <Arrow
          {...common}
          points={[0, 0, el.length, 0]}
          stroke={el.stroke}
          fill={el.stroke}
          strokeWidth={el.strokeWidth}
          pointerLength={Math.max(10, el.strokeWidth * 4)}
          pointerWidth={Math.max(10, el.strokeWidth * 4)}
          hitStrokeWidth={Math.max(14, el.strokeWidth)}
        />
      )
  }
}

function ImageNode({
  el,
  common,
}: {
  el: ImageElement
  common: Record<string, unknown>
}) {
  const [image] = useImage(el.dataUrl)
  return <KImage {...common} image={image} width={el.width} height={el.height} />
}

/** Ancres de redimensionnement et rotation autorisées selon le type d'élément. */
function transformerConfig(el: PdfElement | undefined) {
  if (!el) return { enabledAnchors: [], rotateEnabled: false }
  switch (el.type) {
    case 'text':
      return { enabledAnchors: ['middle-left', 'middle-right'], rotateEnabled: false }
    case 'line':
    case 'arrow':
      return { enabledAnchors: ['middle-left', 'middle-right'], rotateEnabled: true }
    case 'ellipse':
    case 'rect':
      return {
        enabledAnchors: [
          'top-left', 'top-right', 'bottom-left', 'bottom-right',
          'middle-left', 'middle-right', 'top-center', 'bottom-center',
        ],
        rotateEnabled: false,
      }
    case 'image':
      return {
        enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        rotateEnabled: true,
      }
  }
}

export function CanvasEditor() {
  const { pages, currentPageIndex, selectedElementId, selectElement, updateElement, removeElement, addElement, watermark } =
    useCreateStore()
  const page = pages[currentPageIndex]

  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const [scale, setScale] = useState(1)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)

  // Force un re-rendu du canvas une fois les polices TTF chargées
  // (sinon Konva dessine avec la police de secours)
  useEffect(() => {
    void preloadCanvasFonts().then(() => stageRef.current?.batchDraw())
  }, [])

  // Adapte l'échelle à la largeur disponible (responsive, mobile compris)
  useEffect(() => {
    const el = containerRef.current
    if (!el || !page) return
    const observer = new ResizeObserver(() => {
      const available = el.clientWidth - 16
      setScale(Math.min(available / page.width, 1.5))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [page?.width, page])

  // Attache le Transformer au nœud sélectionné
  useEffect(() => {
    const tr = trRef.current
    const stage = stageRef.current
    if (!tr || !stage) return
    const node = selectedElementId ? stage.findOne(`#${selectedElementId}`) : null
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [selectedElementId, page?.elements])

  // Suppression clavier
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editingTextId) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElementId) {
        removeElement(selectedElementId)
      }
      if (e.key === 'Escape') selectElement(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedElementId, editingTextId, removeElement, selectElement])

  if (!page) return null

  const selected = page.elements.find((el) => el.id === selectedElementId)
  const editingText = page.elements.find(
    (el): el is TextElement => el.id === editingTextId && el.type === 'text'
  )
  const trConfig = transformerConfig(selected)

  function handleImageDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))
    if (!file) return
    const stage = stageRef.current
    stage?.setPointersPositions(e.nativeEvent)
    const pos = stage?.getRelativePointerPosition() ?? { x: page.width / 4, y: page.height / 4 }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const img = new window.Image()
      img.onload = () => {
        // Limite l'image à la moitié de la page en conservant le ratio
        const maxW = page.width / 2
        const ratio = Math.min(1, maxW / img.width)
        addElement({
          id: newId(),
          type: 'image',
          x: pos.x,
          y: pos.y,
          rotation: 0,
          width: img.width * ratio,
          height: img.height * ratio,
          dataUrl,
        })
        toast.success('Image ajoutée')
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  return (
    <div ref={containerRef} className="w-full flex justify-center relative" onDragOver={(e) => e.preventDefault()} onDrop={handleImageDrop}>
      <div
        className="shadow-2xl shadow-base-content/10 ring-1 ring-base-content/10 bg-white relative rounded-sm"
        style={{ width: page.width * scale, height: page.height * scale }}
      >
        <Stage
          ref={stageRef}
          width={page.width * scale}
          height={page.height * scale}
          scaleX={scale}
          scaleY={scale}
          onMouseDown={(e) => {
            if (e.target === e.target.getStage() || e.target.name() === 'page-bg') selectElement(null)
          }}
          onTouchStart={(e) => {
            if (e.target === e.target.getStage() || e.target.name() === 'page-bg') selectElement(null)
          }}
          onDblClick={(e) => {
            const id = e.target.id()
            const el = page.elements.find((x) => x.id === id)
            if (el?.type === 'text') setEditingTextId(id)
          }}
          onDblTap={(e) => {
            const id = e.target.id()
            const el = page.elements.find((x) => x.id === id)
            if (el?.type === 'text') setEditingTextId(id)
          }}
        >
          <Layer>
            {/* Fond de page coloré (cliquable pour désélectionner) */}
            <Rect
              name="page-bg"
              x={0}
              y={0}
              width={page.width}
              height={page.height}
              fill={page.backgroundColor ?? '#ffffff'}
            />
            {page.elements.map((el) => (
              <ElementNode key={el.id} el={el} onSelect={() => selectElement(el.id)} />
            ))}
            {/* Filigrane : aperçu non interactif, identique à l'export */}
            {watermark && (
              <Text
                listening={false}
                x={page.width / 2}
                y={page.height / 2}
                width={Math.hypot(page.width, page.height)}
                offsetX={Math.hypot(page.width, page.height) / 2}
                offsetY={watermark.fontSize / 2}
                align="center"
                text={watermark.text}
                fontSize={watermark.fontSize}
                fontFamily={CANVAS_FONTS.Helvetica}
                fill={watermark.color}
                opacity={watermark.opacity}
                rotation={watermark.diagonal ? -45 : 0}
              />
            )}
            <Transformer
              ref={trRef}
              enabledAnchors={trConfig.enabledAnchors}
              rotateEnabled={trConfig.rotateEnabled}
              keepRatio={selected?.type === 'image'}
              flipEnabled={false}
              boundBoxFunc={(oldBox, newBox) =>
                newBox.width < 5 || newBox.height < 5 ? oldBox : newBox
              }
            />
          </Layer>
        </Stage>

        {/* Édition de texte inline : textarea superposée au nœud Konva */}
        {editingText && (
          <textarea
            autoFocus
            className="absolute bg-transparent outline-2 outline-primary resize-none overflow-hidden p-0 m-0"
            style={{
              left: editingText.x * scale,
              top: editingText.y * scale,
              width: editingText.width * scale,
              minHeight: editingText.fontSize * scale * 1.4,
              fontSize: editingText.fontSize * scale,
              fontFamily: CANVAS_FONTS[editingText.fontFamily],
              fontWeight: editingText.bold ? 'bold' : 'normal',
              fontStyle: editingText.italic ? 'italic' : 'normal',
              color: editingText.color,
              textAlign: editingText.align,
              lineHeight: 1,
            }}
            defaultValue={editingText.text}
            onBlur={(e) => {
              updateElement(editingText.id, { text: e.target.value })
              setEditingTextId(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
            }}
          />
        )}
      </div>
    </div>
  )
}
