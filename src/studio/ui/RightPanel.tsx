import { useMemo, useRef, useState } from 'react'
import { useStudio, useCurrentPage, type RightPanel as PanelId } from '../store'
import { getPageText, getPageTextItems, renderPage } from '../render'
import { ANN_LABELS, annBounds, displaySize, type Annotation, type StudioPage } from '../types'
import { FONT_FAMILIES, type FontFamily } from '../../lib/fonts'
import { cssFont, longestLine } from '../textMeasure'
import { CALLOUT_PAD } from '../types'
import { getOcrQuality, recognizeCanvas, setOcrQuality, type OcrQuality } from '../../lib/ocr'
import { ColorWell } from '../../components/ui/ColorWell'
import { toast } from '../../components/ui/Toast'
import {
  IconAlignCenter, IconAlignLeft, IconAlignRight, IconBold, IconChevronsDown, IconChevronsUp, IconCopy, IconItalic, IconTrash, IconX,
} from '../../components/ui/icons'
import { IconComments, IconFileText, IconScanText, IconSearch, IconSliders } from './icons'

const HIGHLIGHT_COLORS = ['#fde047', '#86efac', '#f9a8d4', '#93c5fd', '#fdba74']
const NOTE_COLORS = ['#fef08a', '#bbf7d0', '#fbcfe8', '#bfdbfe']
export const STAMP_PRESETS = ['APPROUVÉ', 'REFUSÉ', 'BROUILLON', 'CONFIDENTIEL', 'PAYÉ', 'REÇU LE', 'COPIE']

const TABS: { id: Exclude<PanelId, null>; label: string; icon: React.ReactNode }[] = [
  { id: 'properties', label: 'Propriétés', icon: <IconSliders /> },
  { id: 'comments', label: 'Commentaires', icon: <IconComments /> },
  { id: 'search', label: 'Rechercher', icon: <IconSearch /> },
  { id: 'ocr', label: 'OCR', icon: <IconScanText /> },
  { id: 'document', label: 'Document', icon: <IconFileText /> },
]

export function RightPanel() {
  const panel = useStudio((s) => s.rightPanel)
  const setRightPanel = useStudio((s) => s.setRightPanel)
  if (!panel) return null
  return (
    <aside className="studio-right" aria-label="Panneau latéral">
      <div className="studio-right-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={panel === t.id}
            className={panel === t.id ? 'is-active' : ''}
            title={t.label}
            onClick={() => setRightPanel(t.id)}
          >
            {t.icon}
          </button>
        ))}
        <button className="studio-right-close" title="Fermer le panneau" onClick={() => setRightPanel(null)}><IconX /></button>
      </div>
      <div className="studio-right-body">
        <h3 className="studio-right-title">{TABS.find((t) => t.id === panel)?.label}</h3>
        {panel === 'properties' && <PropertiesPanel />}
        {panel === 'comments' && <CommentsPanel />}
        {panel === 'search' && <SearchPanel />}
        {panel === 'ocr' && <OcrPanel />}
        {panel === 'document' && <DocumentPanel />}
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------------- */

function Swatches({ colors, value, onChange }: { colors: string[]; value: string; onChange: (c: string) => void }) {
  return (
    <div className="studio-swatches">
      {colors.map((c) => (
        <button
          key={c}
          className={value.toLowerCase() === c ? 'is-active' : ''}
          style={{ background: c }}
          title={c}
          onClick={() => onChange(c)}
        />
      ))}
      <ColorWell size="sm" value={value} onChange={onChange} title="Autre couleur" />
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="studio-prop-row">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  )
}

function NumberInput({ value, onChange, min, max, step = 1 }: { value: number; onChange: (n: number) => void; min: number; max: number; step?: number }) {
  return (
    <input
      type="number"
      className="input input-xs w-20"
      value={Math.round(value * 10) / 10}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const n = Number(e.target.value)
        if (Number.isFinite(n) && n >= min && n <= max) onChange(n)
      }}
    />
  )
}

function PropertiesPanel() {
  const sel = useStudio((s) => s.selectedAnn)
  const ann = useStudio((s) =>
    s.selectedAnn ? s.pages.find((p) => p.id === s.selectedAnn!.pageId)?.annotations.find((a) => a.id === s.selectedAnn!.id) : undefined
  )
  const update = useStudio((s) => s.updateAnnotation)
  const remove = useStudio((s) => s.removeAnnotation)
  const reorder = useStudio((s) => s.reorderAnnotation)
  const copy = useStudio((s) => s.copyAnnotation)
  const paste = useStudio((s) => s.pasteAnnotation)
  const setEditingAnn = useStudio((s) => s.setEditingAnn)

  if (!sel || !ann) return <ToolDefaults />
  const set = (patch: Partial<Annotation>) => update(sel.pageId, ann.id, patch)

  return (
    <div className="studio-props">
      <div className="studio-props-head">
        <strong>{ANN_LABELS[ann.type]}</strong>
        <div className="flex gap-1">
          <button className="btn btn-ghost btn-xs btn-square" title="Premier plan" onClick={() => reorder(sel.pageId, ann.id, 'front')}><IconChevronsUp /></button>
          <button className="btn btn-ghost btn-xs btn-square" title="Arrière-plan" onClick={() => reorder(sel.pageId, ann.id, 'back')}><IconChevronsDown /></button>
          <button className="btn btn-ghost btn-xs btn-square" title="Dupliquer (Ctrl+C / Ctrl+V)" onClick={() => { copy(); paste(sel.pageId) }}><IconCopy /></button>
          <button className="btn btn-ghost btn-xs btn-square text-error" title="Supprimer (Suppr)" onClick={() => remove(sel.pageId, ann.id)}><IconTrash /></button>
        </div>
      </div>

      {ann.type === 'highlight' && (
        <>
          <Row label="Couleur"><Swatches colors={HIGHLIGHT_COLORS} value={ann.color} onChange={(color) => set({ color })} /></Row>
          {ann.quote && <blockquote className="studio-quote">« {ann.quote} »</blockquote>}
        </>
      )}

      {ann.type === 'text' && (
        <>
          <Row label="Texte">
            <button className="btn btn-xs rounded-full" onClick={() => setEditingAnn(sel)}>Modifier le texte</button>
            <button
              className="btn btn-xs btn-ghost rounded-full"
              title="Réduit la largeur de la zone à celle de la plus longue ligne"
              onClick={() => set({ width: Math.max(24, longestLine(ann.text, cssFont(ann.fontSize, ann.fontFamily, ann.bold, ann.italic)) + 4) })}
            >
              Ajuster au texte
            </button>
          </Row>
          <Row label="Police">
            <select className="select select-xs" value={ann.fontFamily ?? 'Helvetica'} onChange={(e) => set({ fontFamily: e.target.value as FontFamily })}>
              {FONT_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Row>
          <Row label="Taille"><NumberInput value={ann.fontSize} min={4} max={160} onChange={(fontSize) => set({ fontSize })} /></Row>
          <Row label="Style">
            <div className="join">
              <button className={`btn btn-xs join-item ${ann.bold ? 'btn-active' : ''}`} onClick={() => set({ bold: !ann.bold })}><IconBold /></button>
              <button className={`btn btn-xs join-item ${ann.italic ? 'btn-active' : ''}`} onClick={() => set({ italic: !ann.italic })}><IconItalic /></button>
            </div>
            <div className="join ml-2">
              {(['left', 'center', 'right'] as const).map((al) => (
                <button key={al} className={`btn btn-xs join-item ${(ann.align ?? 'left') === al ? 'btn-active' : ''}`} onClick={() => set({ align: al })}>
                  {al === 'left' ? <IconAlignLeft /> : al === 'center' ? <IconAlignCenter /> : <IconAlignRight />}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Couleur"><ColorWell size="sm" value={ann.color} onChange={(color) => set({ color })} title="Couleur du texte" /></Row>
          <Row label="Fond">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" className="checkbox checkbox-xs" checked={!!ann.background} onChange={(e) => set({ background: e.target.checked ? '#ffffff' : undefined })} />
              Opaque
            </label>
            {ann.background && <ColorWell size="sm" value={ann.background} onChange={(background) => set({ background })} title="Couleur de fond" />}
          </Row>
          <Row label="Bordure">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox" className="checkbox checkbox-xs" checked={!!ann.border}
                onChange={(e) => set(e.target.checked ? { border: ann.color === '#111111' ? '#2563eb' : ann.color, borderWidth: ann.borderWidth ?? 1.5 } : { border: undefined })}
              />
              Cadre
            </label>
            {ann.border && (
              <>
                <ColorWell size="sm" value={ann.border} onChange={(border) => set({ border })} title="Couleur de la bordure" />
                <NumberInput value={ann.borderWidth ?? 1.5} min={0.5} max={10} step={0.5} onChange={(borderWidth) => set({ borderWidth })} />
              </>
            )}
          </Row>
        </>
      )}

      {ann.type === 'callout' && (
        <>
          <Row label="Texte">
            <button className="btn btn-xs rounded-full" onClick={() => setEditingAnn(sel)}>Modifier le texte</button>
            <button
              className="btn btn-xs btn-ghost rounded-full"
              title="Réduit la largeur de la bulle à celle de la plus longue ligne"
              onClick={() => set({ width: Math.max(40, longestLine(ann.text, cssFont(ann.fontSize)) + CALLOUT_PAD * 2 + 4) })}
            >
              Ajuster au texte
            </button>
          </Row>
          <Row label="Taille"><NumberInput value={ann.fontSize} min={6} max={48} onChange={(fontSize) => set({ fontSize })} /></Row>
          <Row label="Texte"><ColorWell size="sm" value={ann.color} onChange={(color) => set({ color })} title="Couleur du texte" /></Row>
          <Row label="Cadre et flèche"><ColorWell size="sm" value={ann.stroke} onChange={(stroke) => set({ stroke })} title="Couleur du cadre et de la flèche" /></Row>
          <Row label="Épaisseur"><NumberInput value={ann.strokeWidth ?? 1.2} min={0.5} max={8} step={0.5} onChange={(strokeWidth) => set({ strokeWidth })} /></Row>
          <Row label="Fond">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" className="checkbox checkbox-xs" checked={!!ann.background} onChange={(e) => set({ background: e.target.checked ? '#ffffff' : undefined })} />
              Opaque
            </label>
            {ann.background && <ColorWell size="sm" value={ann.background} onChange={(background) => set({ background })} title="Couleur de fond" />}
          </Row>
          <p className="studio-hint">Déplacez la zone pour la placer ; faites glisser le point rond pour viser un autre endroit.</p>
        </>
      )}

      {ann.type === 'note' && (
        <>
          <Row label="Couleur"><Swatches colors={NOTE_COLORS} value={ann.color} onChange={(color) => set({ color })} /></Row>
          <label className="studio-field">
            <span>Texte de la note</span>
            <textarea className="textarea textarea-sm w-full" rows={4} value={ann.text} onChange={(e) => set({ text: e.target.value })} />
          </label>
        </>
      )}

      {(ann.type === 'rect' || ann.type === 'ellipse') && (
        <>
          <Row label="Trait"><ColorWell size="sm" value={ann.stroke} onChange={(stroke) => set({ stroke })} title="Couleur du trait" /></Row>
          <Row label="Épaisseur"><NumberInput value={ann.strokeWidth} min={0.5} max={30} step={0.5} onChange={(strokeWidth) => set({ strokeWidth })} /></Row>
          <Row label="Remplissage">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" className="checkbox checkbox-xs" checked={!!ann.fill} onChange={(e) => set({ fill: e.target.checked ? '#ffffff' : undefined })} />
              Plein
            </label>
            {ann.fill && <ColorWell size="sm" value={ann.fill} onChange={(fill) => set({ fill })} title="Couleur de remplissage" />}
          </Row>
        </>
      )}

      {(ann.type === 'line' || ann.type === 'arrow' || ann.type === 'ink') && (
        <>
          <Row label="Couleur"><ColorWell size="sm" value={ann.stroke} onChange={(stroke) => set({ stroke })} title="Couleur" /></Row>
          <Row label="Épaisseur"><NumberInput value={ann.strokeWidth} min={0.5} max={30} step={0.5} onChange={(strokeWidth) => set({ strokeWidth })} /></Row>
        </>
      )}

      {ann.type === 'redact' && (
        <>
          <Row label="Couleur"><ColorWell size="sm" value={ann.color} onChange={(color) => set({ color })} title="Couleur du masque" /></Row>
          <p className="studio-hint">À l’export, la page est aplatie : le contenu sous le masque est définitivement supprimé.</p>
        </>
      )}

      {ann.type === 'stamp' && (
        <>
          <Row label="Texte">
            <input className="input input-xs w-36" list="studio-stamps" value={ann.text} onChange={(e) => set({ text: e.target.value })} />
          </Row>
          <Row label="Taille"><NumberInput value={ann.fontSize} min={8} max={72} onChange={(fontSize) => set({ fontSize })} /></Row>
          <Row label="Couleur"><ColorWell size="sm" value={ann.color} onChange={(color) => set({ color })} title="Couleur du tampon" /></Row>
        </>
      )}

      {ann.type !== 'note' && (
        <label className="studio-field mt-3">
          <span>Commentaire</span>
          <textarea
            className="textarea textarea-sm w-full"
            rows={3}
            placeholder="Ajouter un commentaire à cette annotation…"
            value={ann.comment ?? ''}
            onChange={(e) => set({ comment: e.target.value || undefined })}
          />
        </label>
      )}
      <datalist id="studio-stamps">{STAMP_PRESETS.map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  )
}

/** Sans sélection : réglages par défaut des outils + propriétés de la page. */
function ToolDefaults() {
  const opts = useStudio((s) => s.toolOptions)
  const setOpts = useStudio((s) => s.setToolOptions)
  const page = useCurrentPage()
  const setPageBackground = useStudio((s) => s.setPageBackground)
  return (
    <div className="studio-props">
      <p className="studio-hint">Sélectionnez une annotation pour la modifier. Réglages par défaut des nouveaux éléments :</p>
      <Row label="Surligneur"><Swatches colors={HIGHLIGHT_COLORS} value={opts.highlightColor} onChange={(highlightColor) => setOpts({ highlightColor })} /></Row>
      <Row label="Aligner sur le texte">
        <input type="checkbox" className="toggle toggle-sm" checked={opts.snapToText} onChange={(e) => setOpts({ snapToText: e.target.checked })} />
      </Row>
      <Row label="Formes"><ColorWell size="sm" value={opts.strokeColor} onChange={(strokeColor) => setOpts({ strokeColor })} title="Couleur des formes" /></Row>
      <Row label="Épaisseur"><NumberInput value={opts.strokeWidth} min={0.5} max={30} step={0.5} onChange={(strokeWidth) => setOpts({ strokeWidth })} /></Row>
      <Row label="Texte"><ColorWell size="sm" value={opts.textColor} onChange={(textColor) => setOpts({ textColor })} title="Couleur du texte" /></Row>
      <Row label="Taille du texte"><NumberInput value={opts.fontSize} min={4} max={160} onChange={(fontSize) => setOpts({ fontSize })} /></Row>
      <Row label="Dessin"><ColorWell size="sm" value={opts.inkColor} onChange={(inkColor) => setOpts({ inkColor })} title="Couleur du dessin" /></Row>
      <Row label="Tampon">
        <input className="input input-xs w-32" list="studio-stamps" value={opts.stampText} onChange={(e) => setOpts({ stampText: e.target.value })} />
        <ColorWell size="sm" value={opts.stampColor} onChange={(stampColor) => setOpts({ stampColor })} title="Couleur du tampon" />
      </Row>
      <datalist id="studio-stamps">{STAMP_PRESETS.map((s) => <option key={s} value={s} />)}</datalist>

      {page?.source.kind === 'blank' && (
        <>
          <h4 className="studio-subtitle">Page vierge</h4>
          <Row label="Fond de page">
            <ColorWell size="sm" value={page.source.background ?? '#ffffff'} onChange={(c) => setPageBackground(page.id, c)} title="Couleur de fond" />
          </Row>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------- */

function CommentsPanel() {
  const pages = useStudio((s) => s.pages)
  const selectAnnotation = useStudio((s) => s.selectAnnotation)
  const scrollToPage = useStudio((s) => s.scrollToPage)
  const update = useStudio((s) => s.updateAnnotation)
  const remove = useStudio((s) => s.removeAnnotation)
  const setTool = useStudio((s) => s.setTool)
  const selected = useStudio((s) => s.selectedAnn?.id)
  const [onlyComments, setOnlyComments] = useState(false)

  const items = pages.flatMap((p, i) =>
    p.annotations
      .filter((a) => (onlyComments ? a.type === 'note' || !!a.comment : true))
      .map((a) => ({ page: p, index: i, ann: a }))
  )

  function focus(page: StudioPage, ann: Annotation) {
    setTool('select')
    selectAnnotation({ pageId: page.id, id: ann.id })
    scrollToPage(page.id, annBounds(ann).y)
  }

  return (
    <div className="studio-comments">
      <label className="flex items-center gap-2 text-xs mb-2">
        <input type="checkbox" className="checkbox checkbox-xs" checked={onlyComments} onChange={(e) => setOnlyComments(e.target.checked)} />
        Uniquement les commentaires
      </label>
      {!items.length && <p className="studio-hint">Aucune annotation. Utilisez l’outil Commentaire ou ajoutez un commentaire à un surlignage.</p>}
      {items.map(({ page, index, ann }) => (
        <div
          key={ann.id}
          className={`studio-comment ${selected === ann.id ? 'is-active' : ''}`}
          onClick={() => focus(page, ann)}
        >
          <div className="studio-comment-head">
            <span className="studio-comment-dot" style={{ background: 'color' in ann ? ann.color : 'stroke' in ann ? ann.stroke : '#888' }} />
            <strong>{ANN_LABELS[ann.type]}</strong>
            <span>p. {index + 1}</span>
            {ann.createdAt && <time>{new Date(ann.createdAt).toLocaleDateString('fr-FR')}</time>}
            <button className="btn btn-ghost btn-xs btn-square ml-auto" title="Supprimer" onClick={(e) => { e.stopPropagation(); remove(page.id, ann.id) }}><IconTrash /></button>
          </div>
          {ann.type === 'highlight' && ann.quote && <blockquote className="studio-quote">« {ann.quote} »</blockquote>}
          {(ann.type === 'text' || ann.type === 'callout' || ann.type === 'stamp') && <p className="studio-comment-text">{ann.text}</p>}
          {ann.type === 'note' ? (
            <textarea
              className="textarea textarea-xs w-full"
              rows={2}
              value={ann.text}
              placeholder="Commentaire…"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => update(page.id, ann.id, { text: e.target.value })}
            />
          ) : (
            <textarea
              className="textarea textarea-xs w-full"
              rows={ann.comment ? 2 : 1}
              value={ann.comment ?? ''}
              placeholder="Ajouter un commentaire…"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => update(page.id, ann.id, { comment: e.target.value || undefined })}
            />
          )}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------------- */

/** Normalise pour une recherche insensible à la casse et aux accents. */
function norm(s: string) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

interface Hit {
  pageId: string
  index: number
  rect: { x: number; y: number; width: number; height: number }
  snippet: string
}

function SearchPanel() {
  const pages = useStudio((s) => s.pages)
  const docs = useStudio((s) => s.docs)
  const scrollToPage = useStudio((s) => s.scrollToPage)
  const flashRects = useStudio((s) => s.flashRects)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [running, setRunning] = useState(false)
  const [active, setActive] = useState(-1)
  const token = useRef(0)

  async function search() {
    const needle = norm(q.trim())
    if (!needle) return
    const t = ++token.current
    setRunning(true)
    const found: Hit[] = []
    for (let i = 0; i < pages.length; i++) {
      const items = await getPageTextItems(pages[i], docs)
      if (t !== token.current) return
      for (const it of items) {
        const hay = norm(it.text)
        let from = 0
        let pos: number
        while ((pos = hay.indexOf(needle, from)) >= 0) {
          // Position approximative du mot dans l'élément de texte
          const k = it.text.length ? it.width / it.text.length : 0
          found.push({
            pageId: pages[i].id,
            index: i,
            rect: { x: it.x + pos * k, y: it.y, width: Math.max(4, needle.length * k), height: it.height },
            snippet: it.text.length > 90 ? `${it.text.slice(Math.max(0, pos - 35), pos + 55)}…` : it.text,
          })
          from = pos + needle.length
        }
      }
    }
    setHits(found)
    setRunning(false)
    if (found.length) go(found, 0)
  }

  function go(list: Hit[], i: number) {
    const h = list[i]
    if (!h) return
    setActive(i)
    scrollToPage(h.pageId, h.rect.y)
    setTimeout(() => flashRects(h.pageId, [h.rect]), 250)
  }

  const noText = useMemo(() => pages.every((p) => p.source.kind !== 'pdf' && !p.ocr), [pages])

  return (
    <div className="studio-search">
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          if (hits && hits.length && active >= 0) go(hits, (active + 1) % hits.length)
          else void search()
        }}
      >
        <input
          className="input input-sm flex-1"
          autoFocus
          placeholder="Rechercher dans le document…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setHits(null); setActive(-1) }}
        />
        <button className="btn btn-sm btn-primary" disabled={!q.trim() || running}>{running ? <span className="loading loading-spinner loading-xs" /> : 'OK'}</button>
      </form>
      {noText && <p className="studio-hint mt-2">Ce document semble être une image : lancez l’OCR pour pouvoir y rechercher du texte.</p>}
      {hits && (
        <p className="studio-hint mt-2">
          {hits.length ? `${hits.length} résultat(s) — Entrée pour passer au suivant` : 'Aucun résultat'}
        </p>
      )}
      <div className="studio-search-results">
        {hits?.map((h, i) => (
          <button key={i} className={i === active ? 'is-active' : ''} onClick={() => go(hits, i)}>
            <span>p. {h.index + 1}</span>
            <span>{h.snippet}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------- */

function OcrPanel() {
  const pages = useStudio((s) => s.pages)
  const docs = useStudio((s) => s.docs)
  const setPageOcr = useStudio((s) => s.setPageOcr)
  const page = useCurrentPage()
  const [quality, setQuality] = useState<OcrQuality>(getOcrQuality())
  const [progress, setProgress] = useState<{ done: number; total: number; page: number } | null>(null)
  const [nativeText, setNativeText] = useState<string | null>(null)
  const cancel = useRef(false)

  async function hasNativeText(p: StudioPage) {
    if (p.source.kind !== 'pdf') return false
    const items = await getPageTextItems({ ...p, ocr: undefined }, docs)
    return items.length > 3
  }

  async function run(scope: 'current' | 'missing' | 'all') {
    let targets = scope === 'current' ? (page ? [page] : []) : pages
    if (scope === 'missing') {
      const out: StudioPage[] = []
      for (const p of targets) if (!p.ocr && !(await hasNativeText(p))) out.push(p)
      targets = out
    }
    if (!targets.length) {
      toast.info('Toutes les pages ont déjà du texte.')
      return
    }
    cancel.current = false
    try {
      for (let i = 0; i < targets.length; i++) {
        if (cancel.current) break
        const p = targets[i]
        setProgress({ done: i, total: targets.length, page: pages.indexOf(p) + 1 })
        const scale = 2.5
        const canvas = await renderPage(p, docs, scale)
        const res = await recognizeCanvas(canvas, (r) => setProgress({ done: i + r, total: targets.length, page: pages.indexOf(p) + 1 }))
        const { width } = displaySize(p)
        const k = width / canvas.width
        setPageOcr(p.id, {
          text: res.text,
          words: res.words.map((w) => ({ text: w.text, x: w.x0 * k, y: w.y0 * k, width: (w.x1 - w.x0) * k, height: (w.y1 - w.y0) * k })),
        })
      }
      toast.success(cancel.current ? 'OCR interrompu' : 'Reconnaissance terminée')
    } catch (err) {
      console.error(err)
      toast.error('Échec de la reconnaissance OCR')
    } finally {
      setProgress(null)
    }
  }

  const currentText = page?.ocr?.text

  return (
    <div className="studio-ocr">
      <p className="studio-hint">
        La reconnaissance se fait dans votre navigateur. Le texte reconnu rend les pages cherchables, permet le surlignage
        aligné et est ajouté (invisible) au PDF exporté.
      </p>
      <Row label="Qualité">
        <select
          className="select select-xs"
          value={quality}
          onChange={(e) => { const v = e.target.value as OcrQuality; setQuality(v); setOcrQuality(v) }}
          disabled={!!progress}
        >
          <option value="fast">Rapide</option>
          <option value="best">Précise (modèle plus lourd)</option>
        </select>
      </Row>
      {progress ? (
        <div className="studio-ocr-progress">
          <span>Page {progress.page} — {Math.round((progress.done / progress.total) * 100)} %</span>
          <progress className="progress progress-primary w-full" value={progress.done} max={progress.total} />
          <button className="btn btn-xs rounded-full" onClick={() => { cancel.current = true }}>Arrêter</button>
        </div>
      ) : (
        <div className="studio-ocr-actions">
          <button className="btn btn-sm btn-primary rounded-full" onClick={() => void run('current')} disabled={!page}>Page courante</button>
          <button className="btn btn-sm rounded-full" onClick={() => void run('missing')}>Pages sans texte</button>
          <button className="btn btn-sm btn-ghost rounded-full" onClick={() => void run('all')}>Tout le document</button>
        </div>
      )}

      <h4 className="studio-subtitle">Texte de la page courante</h4>
      {currentText ? (
        <>
          <textarea className="textarea textarea-xs w-full studio-ocr-text" readOnly value={currentText} rows={10} />
          <div className="flex gap-1 mt-1">
            <button className="btn btn-xs rounded-full" onClick={() => void navigator.clipboard.writeText(currentText).then(() => toast.success('Texte copié'))}>Copier</button>
            <button className="btn btn-xs btn-ghost rounded-full" onClick={() => page && setPageOcr(page.id, undefined)}>Effacer l’OCR</button>
          </div>
        </>
      ) : (
        <>
          <button
            className="btn btn-xs rounded-full"
            onClick={() => page && void getPageText(page, docs).then((t) => setNativeText(t || ''))}
          >
            Afficher le texte natif
          </button>
          {nativeText !== null && (
            <textarea className="textarea textarea-xs w-full studio-ocr-text mt-1" readOnly value={nativeText || '(aucun texte natif)'} rows={8} />
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------- */

function DocumentPanel() {
  const name = useStudio((s) => s.name)
  const setName = useStudio((s) => s.setName)
  const pages = useStudio((s) => s.pages)
  const watermark = useStudio((s) => s.watermark)
  const setWatermark = useStudio((s) => s.setWatermark)
  const wm = watermark ?? { text: '', fontSize: 60, color: '#9ca3af', opacity: 0.25, diagonal: true }

  const annCount = pages.reduce((n, p) => n + p.annotations.length, 0)
  const ocrCount = pages.filter((p) => p.ocr).length

  return (
    <div className="studio-props">
      <label className="studio-field">
        <span>Nom du document</span>
        <input className="input input-sm w-full" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <dl className="studio-stats">
        <div><dt>Pages</dt><dd>{pages.length}</dd></div>
        <div><dt>Annotations</dt><dd>{annCount}</dd></div>
        <div><dt>Pages OCR</dt><dd>{ocrCount}</dd></div>
      </dl>

      <h4 className="studio-subtitle">Filigrane</h4>
      <label className="studio-field">
        <span>Texte (vide = aucun)</span>
        <input
          className="input input-sm w-full"
          placeholder="ex. CONFIDENTIEL, COPIE…"
          value={wm.text}
          onChange={(e) => setWatermark(e.target.value ? { ...wm, text: e.target.value } : null)}
        />
      </label>
      {watermark && (
        <>
          <Row label="Taille"><NumberInput value={wm.fontSize} min={10} max={200} onChange={(fontSize) => setWatermark({ ...wm, fontSize })} /></Row>
          <Row label="Couleur"><ColorWell size="sm" value={wm.color} onChange={(color) => setWatermark({ ...wm, color })} title="Couleur du filigrane" /></Row>
          <Row label="Opacité">
            <input type="range" className="range range-xs w-28" min={0.05} max={1} step={0.05} value={wm.opacity} onChange={(e) => setWatermark({ ...wm, opacity: Number(e.target.value) })} />
          </Row>
          <Row label="Diagonale">
            <input type="checkbox" className="toggle toggle-sm" checked={wm.diagonal} onChange={(e) => setWatermark({ ...wm, diagonal: e.target.checked })} />
          </Row>
          <p className="studio-hint">Le filigrane est appliqué à toutes les pages lors de l’export.</p>
        </>
      )}
    </div>
  )
}
