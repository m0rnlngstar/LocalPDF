import { useRef, useState } from 'react'
import { FONTS, FONT_FAMILIES, type FontFamily } from '../../lib/fonts'
import { useCreateStore } from './store'
import { newId, type Watermark } from './types'
import { toast } from '../../components/ui/Toast'
import {
  IconAlignCenter, IconAlignLeft, IconAlignRight, IconArrow, IconBold,
  IconChevronDown, IconChevronUp, IconChevronsDown, IconChevronsUp,
  IconCircleShape, IconDroplet, IconImage, IconItalic, IconLine,
  IconSquare, IconTrash, IconType, IconWatermark,
} from '../../components/ui/icons'

/** Rail d'outils vertical (gauche) : insertion + fond de page + filigrane. */
export function ToolRail() {
  const { pages, currentPageIndex, addElement, setPageBackground, watermark, setWatermark } =
    useCreateStore()
  const page = pages[currentPageIndex]
  const imageInputRef = useRef<HTMLInputElement>(null)
  const wmDialogRef = useRef<HTMLDialogElement>(null)

  if (!page) return null

  const cx = page.width / 2
  const cy = page.height / 3

  function insertImageFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file || !page) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const img = new Image()
      img.onload = () => {
        const ratio = Math.min(1, page.width / 2 / img.width)
        addElement({
          id: newId(), type: 'image',
          x: cx - (img.width * ratio) / 2, y: cy, rotation: 0,
          width: img.width * ratio, height: img.height * ratio, dataUrl,
        })
        toast.success('Image ajoutée')
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  const tools: { tip: string; icon: React.ReactNode; onClick: () => void }[] = [
    {
      tip: 'Zone de texte', icon: <IconType />,
      onClick: () =>
        addElement({
          id: newId(), type: 'text', x: cx - 100, y: cy, rotation: 0,
          text: 'Votre texte ici', width: 200, fontFamily: 'Helvetica',
          fontSize: 16, color: '#000000', align: 'left', bold: false, italic: false,
        }),
    },
    {
      tip: 'Image (ou glissez-la sur la page)', icon: <IconImage />,
      onClick: () => imageInputRef.current?.click(),
    },
    {
      tip: 'Rectangle', icon: <IconSquare />,
      onClick: () =>
        addElement({
          id: newId(), type: 'rect', x: cx - 75, y: cy, rotation: 0,
          width: 150, height: 90, fill: '#93c5fd', stroke: '#1d4ed8', strokeWidth: 1,
        }),
    },
    {
      tip: 'Cercle', icon: <IconCircleShape />,
      onClick: () =>
        addElement({
          id: newId(), type: 'ellipse', x: cx - 60, y: cy, rotation: 0,
          width: 120, height: 120, fill: '#fca5a5', stroke: '#b91c1c', strokeWidth: 1,
        }),
    },
    {
      tip: 'Ligne', icon: <IconLine />,
      onClick: () =>
        addElement({
          id: newId(), type: 'line', x: cx - 75, y: cy, rotation: 0,
          length: 150, stroke: '#000000', strokeWidth: 2,
        }),
    },
    {
      tip: 'Flèche', icon: <IconArrow />,
      onClick: () =>
        addElement({
          id: newId(), type: 'arrow', x: cx - 75, y: cy, rotation: 0,
          length: 150, stroke: '#000000', strokeWidth: 2,
        }),
    },
  ]

  return (
    <div className="flex lg:flex-col items-center gap-1 bg-base-100 border border-base-300/50 shadow-md rounded-2xl p-1.5 self-start flex-wrap">
      {tools.map((t) => (
        <div key={t.tip} className="tooltip tooltip-bottom lg:tooltip-right" data-tip={t.tip}>
          <button className="btn btn-ghost btn-sm btn-square" onClick={t.onClick}>
            {t.icon}
          </button>
        </div>
      ))}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          insertImageFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <div className="divider m-0 hidden lg:flex" />
      <div className="divider divider-horizontal m-0 lg:hidden" />

      {/* Couleur de fond de la page courante */}
      <div className="tooltip tooltip-bottom lg:tooltip-right" data-tip="Couleur de fond de la page">
        <label className="btn btn-ghost btn-sm btn-square relative cursor-pointer">
          <IconDroplet />
          <span
            className="absolute bottom-1 right-1 w-2 h-2 rounded-full ring-1 ring-base-content/30"
            style={{ backgroundColor: page.backgroundColor ?? '#ffffff' }}
          />
          <input
            type="color"
            className="absolute inset-0 opacity-0 cursor-pointer"
            value={page.backgroundColor ?? '#ffffff'}
            onChange={(e) => setPageBackground(e.target.value)}
          />
        </label>
      </div>

      {/* Filigrane */}
      <div className="tooltip tooltip-bottom lg:tooltip-right" data-tip="Filigrane">
        <button
          className={`btn btn-sm btn-square ${watermark ? 'btn-primary btn-soft' : 'btn-ghost'}`}
          onClick={() => wmDialogRef.current?.showModal()}
        >
          <IconWatermark />
        </button>
      </div>
      <WatermarkDialog
        dialogRef={wmDialogRef}
        watermark={watermark}
        onApply={setWatermark}
      />
    </div>
  )
}

function WatermarkDialog({
  dialogRef,
  watermark,
  onApply,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  watermark: Watermark | null
  onApply: (w: Watermark | null) => void
}) {
  const [text, setText] = useState(watermark?.text ?? 'CONFIDENTIEL')
  const [fontSize, setFontSize] = useState(watermark?.fontSize ?? 60)
  const [color, setColor] = useState(watermark?.color ?? '#9ca3af')
  const [opacity, setOpacity] = useState(watermark?.opacity ?? 0.25)
  const [diagonal, setDiagonal] = useState(watermark?.diagonal ?? true)

  return (
    <dialog ref={dialogRef} className="modal">
      <div className="modal-box max-w-sm">
        <h3 className="font-bold text-lg mb-3">Filigrane</h3>
        <div className="flex flex-col gap-3">
          <label className="input w-full">
            <span className="label">Texte</span>
            <input value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="flex items-center gap-3">
            <label className="input input-sm w-28">
              <span className="label">Taille</span>
              <input
                type="number" min={10} max={200} value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value) || 60)}
              />
            </label>
            <input
              type="color" value={color} title="Couleur"
              className="w-9 h-9 cursor-pointer rounded-lg"
              onChange={(e) => setColor(e.target.value)}
            />
            <label className="label cursor-pointer gap-2 ml-auto">
              <span className="label-text text-sm">Diagonale</span>
              <input
                type="checkbox" className="toggle toggle-sm toggle-primary"
                checked={diagonal} onChange={(e) => setDiagonal(e.target.checked)}
              />
            </label>
          </div>
          <div>
            <div className="flex justify-between text-xs text-base-content/60 mb-1">
              <span>Opacité</span>
              <span>{Math.round(opacity * 100)}%</span>
            </div>
            <input
              type="range" min={5} max={100} value={opacity * 100}
              className="range range-primary range-sm w-full"
              onChange={(e) => setOpacity(Number(e.target.value) / 100)}
            />
          </div>
        </div>
        <div className="modal-action">
          {watermark && (
            <button
              className="btn btn-sm btn-error btn-soft rounded-full mr-auto"
              onClick={() => {
                onApply(null)
                dialogRef.current?.close()
              }}
            >
              Retirer
            </button>
          )}
          <button className="btn btn-sm btn-ghost rounded-full" onClick={() => dialogRef.current?.close()}>
            Annuler
          </button>
          <button
            className="btn btn-sm btn-primary rounded-full"
            onClick={() => {
              onApply({ text, fontSize, color, opacity, diagonal })
              dialogRef.current?.close()
            }}
            disabled={!text.trim()}
          >
            Appliquer
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>fermer</button>
      </form>
    </dialog>
  )
}

/** Barre contextuelle : propriétés de l'élément sélectionné (style éditeur de texte). */
export function SelectionBar() {
  const { pages, currentPageIndex, selectedElementId, updateElement, removeElement, moveZ } =
    useCreateStore()
  const page = pages[currentPageIndex]
  const selected = page?.elements.find((el) => el.id === selectedElementId)

  if (!selected) return null

  return (
    <div className="card bg-base-100 card-sm shadow-md border border-base-300/50">
      <div className="card-body p-2 flex-row flex-wrap items-center gap-2">
        {selected.type === 'text' && (
          <>
            <select
              className="select select-sm w-28"
              value={selected.fontFamily}
              onChange={(e) => {
                const fam = e.target.value as FontFamily
                updateElement(selected.id, {
                  fontFamily: fam,
                  ...(FONTS[fam].hasBold ? {} : { bold: false }),
                  ...(FONTS[fam].hasItalic ? {} : { italic: false }),
                })
              }}
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <input
              type="number"
              className="input input-sm w-16"
              min={6}
              max={144}
              value={selected.fontSize}
              onChange={(e) =>
                updateElement(selected.id, { fontSize: Number(e.target.value) || 12 })
              }
              title="Taille de police"
            />
            <input
              type="color"
              className="w-7 h-7 cursor-pointer rounded"
              value={selected.color}
              onChange={(e) => updateElement(selected.id, { color: e.target.value })}
              title="Couleur du texte"
            />
            <div className="join">
              <button
                className={`btn btn-sm btn-square join-item ${selected.bold ? 'btn-active' : ''}`}
                title="Gras"
                disabled={!FONTS[selected.fontFamily].hasBold}
                onClick={() => updateElement(selected.id, { bold: !selected.bold })}
              >
                <IconBold />
              </button>
              <button
                className={`btn btn-sm btn-square join-item ${selected.italic ? 'btn-active' : ''}`}
                title="Italique"
                disabled={!FONTS[selected.fontFamily].hasItalic}
                onClick={() => updateElement(selected.id, { italic: !selected.italic })}
              >
                <IconItalic />
              </button>
            </div>
            <div className="join">
              {(
                [
                  ['left', 'Aligner à gauche', <IconAlignLeft key="l" />],
                  ['center', 'Centrer', <IconAlignCenter key="c" />],
                  ['right', 'Aligner à droite', <IconAlignRight key="r" />],
                ] as const
              ).map(([a, label, icon]) => (
                <button
                  key={a}
                  className={`btn btn-sm btn-square join-item ${selected.align === a ? 'btn-active' : ''}`}
                  title={label}
                  onClick={() => updateElement(selected.id, { align: a })}
                >
                  {icon}
                </button>
              ))}
            </div>
          </>
        )}

        {(selected.type === 'rect' || selected.type === 'ellipse') && (
          <label className="flex items-center gap-1.5 text-xs">
            Fond
            <input
              type="color"
              className="w-7 h-7 cursor-pointer rounded"
              value={selected.fill}
              onChange={(e) => updateElement(selected.id, { fill: e.target.value })}
            />
          </label>
        )}
        {(selected.type === 'rect' || selected.type === 'ellipse' ||
          selected.type === 'line' || selected.type === 'arrow') && (
          <>
            <label className="flex items-center gap-1.5 text-xs">
              Trait
              <input
                type="color"
                className="w-7 h-7 cursor-pointer rounded"
                value={selected.stroke}
                onChange={(e) => updateElement(selected.id, { stroke: e.target.value })}
              />
            </label>
            <input
              type="number"
              className="input input-sm w-16"
              min={0}
              max={30}
              value={selected.strokeWidth}
              onChange={(e) =>
                updateElement(selected.id, { strokeWidth: Number(e.target.value) || 1 })
              }
              title="Épaisseur du trait"
            />
          </>
        )}

        {/* Ordre des calques + suppression, communs à tous les types */}
        <div className="join ml-auto">
          <button className="btn btn-sm btn-square join-item" title="Tout en arrière" onClick={() => moveZ(selected.id, 'back')}><IconChevronsDown /></button>
          <button className="btn btn-sm btn-square join-item" title="Reculer" onClick={() => moveZ(selected.id, 'down')}><IconChevronDown /></button>
          <button className="btn btn-sm btn-square join-item" title="Avancer" onClick={() => moveZ(selected.id, 'up')}><IconChevronUp /></button>
          <button className="btn btn-sm btn-square join-item" title="Tout devant" onClick={() => moveZ(selected.id, 'front')}><IconChevronsUp /></button>
        </div>
        <button
          className="btn btn-sm btn-square btn-error btn-soft"
          title="Supprimer l'élément"
          onClick={() => removeElement(selected.id)}
        >
          <IconTrash />
        </button>
      </div>
    </div>
  )
}
