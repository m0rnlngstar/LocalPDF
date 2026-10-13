import { Fragment } from 'react'
import { useStudio } from '../store'
import type { Tool } from '../types'
import { ColorWell } from '../../components/ui/ColorWell'
import {
  IconArrow, IconCircleShape, IconHighlighter, IconImage, IconLine, IconNote, IconPointer,
  IconEdit, IconSignature, IconSquare, IconStamp, IconType,
} from '../../components/ui/icons'
import { IconHand, IconRedact, IconTextSelect } from './icons'
import { STAMP_PRESETS } from './RightPanel'

export interface ToolDef {
  id: Tool
  label: string
  key: string
  icon: React.ReactNode
}

/** Outils regroupés par usage ; `key` = raccourci clavier. */
export const TOOL_GROUPS: ToolDef[][] = [
  [
    { id: 'select', label: 'Sélectionner / déplacer', key: 'V', icon: <IconPointer /> },
    { id: 'text-select', label: 'Sélectionner du texte (copier, vérifier l’OCR)', key: 'S', icon: <IconTextSelect /> },
    { id: 'hand', label: 'Main (faire défiler)', key: 'H', icon: <IconHand /> },
  ],
  [
    { id: 'highlight', label: 'Surligner', key: 'U', icon: <IconHighlighter /> },
    { id: 'note', label: 'Commentaire', key: 'C', icon: <IconNote /> },
  ],
  [
    { id: 'edit-text', label: 'Modifier un texte existant', key: 'E', icon: <IconEdit /> },
    { id: 'text', label: 'Ajouter du texte', key: 'T', icon: <IconType /> },
  ],
  [
    { id: 'rect', label: 'Rectangle', key: 'R', icon: <IconSquare /> },
    { id: 'ellipse', label: 'Ellipse', key: 'O', icon: <IconCircleShape /> },
    { id: 'line', label: 'Ligne', key: 'L', icon: <IconLine /> },
    { id: 'arrow', label: 'Flèche', key: 'A', icon: <IconArrow /> },
    { id: 'ink', label: 'Dessin / signature', key: 'D', icon: <IconSignature /> },
  ],
  [
    { id: 'stamp', label: 'Tampon', key: 'K', icon: <IconStamp /> },
    { id: 'image', label: 'Image', key: 'I', icon: <IconImage /> },
    { id: 'redact', label: 'Masquer (caviardage)', key: 'X', icon: <IconRedact /> },
  ],
]

export const ALL_TOOLS = TOOL_GROUPS.flat()

const HINTS: Partial<Record<Tool, string>> = {
  'text-select': 'Glissez pour sélectionner le texte, puis Ctrl+C pour le copier',
  highlight: 'Glissez sur le texte à surligner',
  note: 'Cliquez pour épingler un commentaire',
  'edit-text': 'Cliquez sur une ligne de texte pour la corriger',
  text: 'Cliquez pour ajouter du texte',
  rect: 'Glissez pour tracer',
  ellipse: 'Glissez pour tracer',
  line: 'Glissez pour tracer',
  arrow: 'Glissez pour tracer',
  ink: 'Dessinez à main levée',
  stamp: 'Cliquez pour apposer le tampon',
  image: 'Cliquez à l’endroit où placer l’image',
  redact: 'Glissez sur la zone à masquer',
  hand: 'Glissez pour faire défiler',
}

export function Toolbar() {
  const tool = useStudio((s) => s.tool)
  const setTool = useStudio((s) => s.setTool)
  const opts = useStudio((s) => s.toolOptions)
  const setOpts = useStudio((s) => s.setToolOptions)

  return (
    <div className="studio-toolbar" role="toolbar" aria-label="Outils d'annotation">
      <div className="studio-toolbar-tools">
        {TOOL_GROUPS.map((group, gi) => (
          <Fragment key={gi}>
            {gi > 0 && <span className="studio-sep" />}
            {group.map((t) => (
              <button
                key={t.id}
                className={`studio-tool ${tool === t.id ? 'is-active' : ''}`}
                title={`${t.label} (${t.key})`}
                aria-pressed={tool === t.id}
                onClick={() => setTool(tool === t.id && t.id !== 'select' ? 'select' : t.id)}
              >
                {t.icon}
                {t.id === 'highlight' && <span className="studio-tool-dot" style={{ background: opts.highlightColor }} />}
              </button>
            ))}
          </Fragment>
        ))}
      </div>

      <div className="studio-toolbar-options">
        {HINTS[tool] && <span className="studio-tool-hint">{HINTS[tool]}</span>}
        {tool === 'highlight' && (
          <>
            <ColorWell size="sm" value={opts.highlightColor} onChange={(highlightColor) => setOpts({ highlightColor })} title="Couleur du surligneur" />
            <label className="studio-inline-check" title="Aligne le surlignage sur les lignes de texte détectées">
              <input type="checkbox" className="checkbox checkbox-xs" checked={opts.snapToText} onChange={(e) => setOpts({ snapToText: e.target.checked })} />
              Sur le texte
            </label>
          </>
        )}
        {(tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow') && (
          <>
            <ColorWell size="sm" value={opts.strokeColor} onChange={(strokeColor) => setOpts({ strokeColor })} title="Couleur" />
            <select className="select select-xs w-16" value={opts.strokeWidth} onChange={(e) => setOpts({ strokeWidth: Number(e.target.value) })} title="Épaisseur">
              {[1, 2, 3, 4, 6, 8].map((w) => <option key={w} value={w}>{w} pt</option>)}
            </select>
          </>
        )}
        {tool === 'ink' && (
          <>
            <ColorWell size="sm" value={opts.inkColor} onChange={(inkColor) => setOpts({ inkColor })} title="Couleur" />
            <select className="select select-xs w-16" value={opts.strokeWidth} onChange={(e) => setOpts({ strokeWidth: Number(e.target.value) })} title="Épaisseur">
              {[1, 2, 3, 4, 6, 8].map((w) => <option key={w} value={w}>{w} pt</option>)}
            </select>
          </>
        )}
        {tool === 'text' && (
          <>
            <ColorWell size="sm" value={opts.textColor} onChange={(textColor) => setOpts({ textColor })} title="Couleur du texte" />
            <select className="select select-xs w-16" value={opts.fontSize} onChange={(e) => setOpts({ fontSize: Number(e.target.value) })} title="Taille">
              {[8, 9, 10, 11, 12, 14, 16, 18, 24, 32, 48].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        )}
        {tool === 'note' && (
          <ColorWell size="sm" value={opts.noteColor} onChange={(noteColor) => setOpts({ noteColor })} title="Couleur de la note" />
        )}
        {tool === 'stamp' && (
          <>
            <select className="select select-xs" value={STAMP_PRESETS.includes(opts.stampText) ? opts.stampText : ''} onChange={(e) => e.target.value && setOpts({ stampText: e.target.value })}>
              {!STAMP_PRESETS.includes(opts.stampText) && <option value="">{opts.stampText}</option>}
              {STAMP_PRESETS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <ColorWell size="sm" value={opts.stampColor} onChange={(stampColor) => setOpts({ stampColor })} title="Couleur du tampon" />
          </>
        )}
      </div>
    </div>
  )
}
