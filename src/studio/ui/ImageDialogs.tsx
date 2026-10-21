import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useStudio, useCurrentPage } from '../store'
import { useBusy } from '../actions'
import { renderPage, loadImage } from '../render'
import { displaySize, newId, type StudioPage } from '../types'
import { Modal } from './Dialogs'
import { toast } from '../../components/ui/Toast'
import { getOpenCvRuntime } from '../../lib/opencv'
import {
  detectReceipts, enhanceCanvas, ENHANCE_MODES, extractQuad, quadBounds, receiptZoom, rectQuad, sortReadingOrder,
  type EnhanceMode, type EnhanceOptions, type Pt, type Quad,
} from '../../lib/imageEnhance'

/**
 * Outils image de l'éditeur : amélioration de lisibilité (netteté, contraste,
 * fond blanchi) et isolement des tickets d'une page. Tout est calculé en local
 * avec OpenCV.js ; la page traitée devient une image (annulable par Ctrl+Z).
 */

/** Côté long maximal du rendu traité (≈ 300 dpi sur un A4). */
const MAX_RENDER_PX = 3500
/** Résolution de rendu des pages PDF / vierges (points → pixels). */
const PDF_SCALE = 200 / 72

/** Échelle de rendu d'une page : résolution native pour une image, 200 dpi sinon. */
async function workScale(page: StudioPage): Promise<number> {
  const { width, height } = displaySize(page)
  let scale = PDF_SCALE
  if (page.source.kind === 'image') {
    const img = await loadImage(page.source.dataUrl)
    scale = Math.max(1, img.naturalWidth / page.source.width)
  }
  return Math.min(scale, MAX_RENDER_PX / Math.max(width, height))
}

/** JPEG pour la couleur et les gris (léger), PNG pour le noir et blanc (net et compact). */
function toDataUrl(canvas: HTMLCanvasElement, mode: EnhanceMode | 'none') {
  return mode === 'bw' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9)
}

const ENHANCE_KEY = 'studio-enhance'

function loadEnhanceOptions(): EnhanceOptions {
  const fallback: EnhanceOptions = { mode: 'document', strength: 0.5, upscale: true }
  try {
    const raw = localStorage.getItem(ENHANCE_KEY)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function saveEnhanceOptions(o: EnhanceOptions) {
  try {
    localStorage.setItem(ENHANCE_KEY, JSON.stringify(o))
  } catch {
    // préférence non mémorisée
  }
}

function EnhanceControls({ value, onChange }: { value: EnhanceOptions; onChange: (o: EnhanceOptions) => void }) {
  return (
    <div className="studio-enhance-controls">
      <div className="studio-segmented" role="radiogroup" aria-label="Rendu">
        {(Object.keys(ENHANCE_MODES) as EnhanceMode[]).map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={value.mode === m}
            className={value.mode === m ? 'is-active' : ''}
            title={ENHANCE_MODES[m].description}
            onClick={() => onChange({ ...value, mode: m })}
          >
            {ENHANCE_MODES[m].label}
          </button>
        ))}
      </div>
      <label className="studio-enhance-range">
        <span>Intensité</span>
        <input
          type="range" className="range range-xs" min={0} max={1} step={0.05}
          value={value.strength}
          onChange={(e) => onChange({ ...value, strength: Number(e.target.value) })}
        />
      </label>
      <label className="studio-enhance-check">
        <input type="checkbox" className="checkbox checkbox-xs" checked={value.upscale} onChange={(e) => onChange({ ...value, upscale: e.target.checked })} />
        <span>Agrandir les images de faible résolution</span>
      </label>
    </div>
  )
}

/** Comparaison avant / après : le curseur découvre la version traitée. */
function Compare({ before, after, loading }: { before: string | null; after: string | null; loading: boolean }) {
  const [split, setSplit] = useState(50)
  const [actual, setActual] = useState(false)
  return (
    <div className="studio-compare-wrap">
      <div className={`studio-compare ${actual ? 'is-actual' : ''}`}>
        {before ? (
          <div className="studio-compare-stage">
            <img src={before} alt="Avant" draggable={false} />
            {after && <img src={after} alt="Après" draggable={false} className="is-after" style={{ clipPath: `inset(0 0 0 ${split}%)` }} />}
            {after && <span className="studio-compare-line" style={{ left: `${split}%` }} />}
            <span className="studio-compare-tag is-left">Avant</span>
            <span className="studio-compare-tag is-right">Après</span>
          </div>
        ) : (
          <div className="studio-compare-empty"><span className="loading loading-spinner" /></div>
        )}
        {loading && before && <span className="studio-compare-busy loading loading-spinner loading-sm" />}
      </div>
      <div className="studio-compare-bar">
        <input type="range" className="range range-xs flex-1" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Curseur avant / après" />
        <label className="studio-enhance-check">
          <input type="checkbox" className="checkbox checkbox-xs" checked={actual} onChange={(e) => setActual(e.target.checked)} />
          <span>Taille réelle</span>
        </label>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------- */

type Scope = 'current' | 'selection' | 'all'

export function EnhanceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const page = useCurrentPage()
  const docs = useStudio((s) => s.docs)
  const selected = useStudio((s) => s.selectedPageIds)
  const [opts, setOpts] = useState<EnhanceOptions>(loadEnhanceOptions)
  const [scope, setScope] = useState<Scope>('current')
  const [keepOriginal, setKeepOriginal] = useState(false)
  const [source, setSource] = useState<{ canvas: HTMLCanvasElement; url: string } | null>(null)
  const [after, setAfter] = useState<string | null>(null)
  const [computing, setComputing] = useState(false)

  useEffect(() => {
    if (open) setScope(selected.length > 1 ? 'selection' : 'current')
  }, [open, selected.length])

  // Rendu de la page courante à la résolution de travail
  useEffect(() => {
    if (!open || !page) return
    let alive = true
    setSource(null)
    setAfter(null)
    void (async () => {
      const canvas = await renderPage(page, docs, await workScale(page))
      if (alive) setSource({ canvas, url: canvas.toDataURL('image/jpeg', 0.85) })
    })().catch((err) => {
      console.error(err)
      toast.error('Impossible de lire la page')
    })
    return () => { alive = false }
  }, [open, page, docs])

  // Aperçu recalculé (avec un léger délai) à chaque réglage
  useEffect(() => {
    if (!source) return
    let alive = true
    setComputing(true)
    const t = window.setTimeout(() => {
      void getOpenCvRuntime()
        .then((cv) => {
          if (!alive) return
          const out = enhanceCanvas(cv, source.canvas, opts)
          setAfter(toDataUrl(out, opts.mode))
        })
        .catch((err) => {
          console.error(err)
          toast.error('Le moteur de traitement d’image n’a pas pu démarrer')
        })
        .finally(() => alive && setComputing(false))
    }, 200)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [source, opts])

  function change(o: EnhanceOptions) {
    setOpts(o)
    saveEnhanceOptions(o)
  }

  async function apply() {
    const { pages, docs: allDocs } = useStudio.getState()
    const targets = scope === 'all'
      ? pages
      : scope === 'selection'
        ? pages.filter((p) => selected.includes(p.id))
        : page ? [page] : []
    if (!targets.length) return
    onClose()
    const busy = useBusy.getState()
    try {
      busy.set('Chargement du moteur d’image…', null)
      const cv = await getOpenCvRuntime()
      const replaced = new Map<string, StudioPage>()
      for (let i = 0; i < targets.length; i++) {
        const p = targets[i]
        useBusy.getState().set(`Amélioration de la page ${pages.indexOf(p) + 1}…`, i / targets.length)
        // Laisse le navigateur afficher la progression entre deux pages
        await new Promise((r) => setTimeout(r, 0))
        const canvas = await renderPage(p, allDocs, await workScale(p))
        const out = enhanceCanvas(cv, canvas, opts)
        const { width, height } = displaySize(p)
        const source = { kind: 'image' as const, dataUrl: toDataUrl(out, opts.mode), width, height }
        // La page devient une image déjà tournée : rotation remise à zéro, annotations et OCR inchangés
        replaced.set(p.id, keepOriginal
          ? { id: newId(), source, rotation: 0, annotations: [] }
          : { ...p, source, rotation: 0 })
      }
      const next = useStudio.getState().pages.flatMap((p) => {
        const r = replaced.get(p.id)
        if (!r) return [p]
        return keepOriginal ? [p, r] : [r]
      })
      useStudio.getState().replaceAllPages(next)
      toast.success(`${targets.length} page${targets.length > 1 ? 's' : ''} améliorée${targets.length > 1 ? 's' : ''} — Ctrl+Z pour annuler`)
    } catch (err) {
      console.error(err)
      toast.error('Échec du traitement de l’image')
    } finally {
      useBusy.getState().set(null)
    }
  }

  const hasNativeText = page?.source.kind === 'pdf'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Améliorer la lisibilité"
      wide="xl"
      actions={
        <>
          <button className="btn btn-ghost rounded-full" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary rounded-full" disabled={!page} onClick={() => void apply()}>Appliquer</button>
        </>
      }
    >
      <div className="studio-image-dialog">
        <Compare before={source?.url ?? null} after={after} loading={computing} />
        <div className="studio-image-side">
          <EnhanceControls value={opts} onChange={change} />
          <p className="studio-hint">{ENHANCE_MODES[opts.mode].description}.</p>

          <h4 className="studio-subtitle">Pages</h4>
          <div className="studio-enhance-scope">
            <label><input type="radio" className="radio radio-xs" checked={scope === 'current'} onChange={() => setScope('current')} /> Page courante</label>
            {selected.length > 1 && (
              <label><input type="radio" className="radio radio-xs" checked={scope === 'selection'} onChange={() => setScope('selection')} /> {selected.length} pages sélectionnées</label>
            )}
            <label><input type="radio" className="radio radio-xs" checked={scope === 'all'} onChange={() => setScope('all')} /> Tout le document</label>
          </div>
          <label className="studio-enhance-check">
            <input type="checkbox" className="checkbox checkbox-xs" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} />
            <span>Conserver l’original (version améliorée ajoutée juste après)</span>
          </label>

          <p className="studio-hint">
            Traitement local, sans IA : les pixels sont renforcés, jamais inventés. Un chiffre illisible ne devient pas un autre
            chiffre — vérifiez tout de même les montants sur l’original.
          </p>
          {hasNativeText && (
            <p className="studio-hint studio-hint-warn">
              Cette page est un PDF : après traitement elle devient une image, son texte n’est plus sélectionnable. Relancez l’OCR
              si besoin.
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------------- */

interface Zone {
  id: string
  quad: Quad
  enabled: boolean
}

const RECEIPTS_KEY = 'studio-receipts'

interface ReceiptPrefs {
  sensitivity: number
  enhance: EnhanceMode | 'none'
  replace: boolean
  /** Agrandir les tickets issus d'une image de faible résolution. */
  upscale: boolean
}

/** En dessous de 150 dpi, la source est jugée de faible résolution. */
const LOW_RES_SCALE = 150 / 72
/** Résolution de mise en page d'un ticket agrandi. */
const RECEIPT_DPI = 250

function loadReceiptPrefs(): ReceiptPrefs {
  const fallback: ReceiptPrefs = { sensitivity: 0.5, enhance: 'none', replace: true, upscale: true }
  try {
    const raw = localStorage.getItem(RECEIPTS_KEY)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

export function ReceiptsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const page = useCurrentPage()
  const docs = useStudio((s) => s.docs)
  const [prefs, setPrefsState] = useState<ReceiptPrefs>(loadReceiptPrefs)
  const [source, setSource] = useState<{ canvas: HTMLCanvasElement; url: string; scale: number } | null>(null)
  const [zones, setZones] = useState<Zone[]>([])
  const [detecting, setDetecting] = useState(false)
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Coin en cours de déplacement. */
  const dragRef = useRef<{ id: string; corner: number } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  /** Modifie une zone ; une zone retouchée est conservée lors d'une nouvelle détection. */
  function editZone(id: string, quad: Quad) {
    const manualId = id.startsWith('manual-') ? id : `manual-${id}`
    setZones((prev) => prev.map((z) => (z.id === id ? { ...z, id: manualId, quad } : z)))
    if (selectedId === id) setSelectedId(manualId)
    if (dragRef.current?.id === id) dragRef.current = { ...dragRef.current, id: manualId }
  }

  /** Coupe la zone sélectionnée en deux (deux tickets détectés comme un seul). */
  function splitSelected(direction: 'h' | 'v') {
    const z = zones.find((o) => o.id === selectedId)
    if (!z) return
    const [a, b, c, d] = z.quad
    const mid = (p: Pt, q: Pt) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })
    const parts: Quad[] = direction === 'h'
      ? [[a, b, mid(b, c), mid(a, d)], [mid(a, d), mid(b, c), c, d]]
      : [[a, mid(a, b), mid(d, c), d], [mid(a, b), b, c, mid(d, c)]]
    const created = parts.map((quad) => ({ id: `manual-${newId()}`, quad, enabled: z.enabled }))
    setZones((prev) => prev.flatMap((o) => (o.id === z.id ? created : [o])))
    setSelectedId(created[0].id)
  }

  function setPrefs(p: Partial<ReceiptPrefs>) {
    const next = { ...prefs, ...p }
    setPrefsState(next)
    try {
      localStorage.setItem(RECEIPTS_KEY, JSON.stringify(next))
    } catch {
      // préférence non mémorisée
    }
  }

  useEffect(() => {
    if (!open || !page) return
    let alive = true
    setSource(null)
    setZones([])
    setSelectedId(null)
    void (async () => {
      const scale = await workScale(page)
      const canvas = await renderPage(page, docs, scale)
      if (alive) setSource({ canvas, url: canvas.toDataURL('image/jpeg', 0.85), scale })
    })().catch((err) => {
      console.error(err)
      toast.error('Impossible de lire la page')
    })
    return () => { alive = false }
  }, [open, page, docs])

  // Détection automatique (relancée quand la sensibilité change)
  useEffect(() => {
    if (!source) return
    let alive = true
    setDetecting(true)
    const t = window.setTimeout(() => {
      void getOpenCvRuntime()
        .then((cv) => {
          if (!alive) return
          const quads = detectReceipts(cv, source.canvas, prefs.sensitivity)
          // Les zones tracées à la main sont conservées
          setZones((prev) => [
            ...prev.filter((z) => z.id.startsWith('manual-')),
            ...quads.map((quad) => ({ id: newId(), quad, enabled: true })),
          ])
        })
        .catch((err) => {
          console.error(err)
          toast.error('Le moteur de traitement d’image n’a pas pu démarrer')
        })
        .finally(() => alive && setDetecting(false))
    }, 150)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [source, prefs.sensitivity])

  function point(e: ReactPointerEvent) {
    const r = stageRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    }
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0 || !source) return
    const p = point(e)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setSelectedId(null)
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }

  function onPointerMove(e: ReactPointerEvent) {
    const drag = dragRef.current
    if (drag) {
      const z = zones.find((o) => o.id === drag.id)
      if (!z) return
      const quad = [...z.quad] as Quad
      quad[drag.corner] = point(e)
      editZone(z.id, quad)
      return
    }
    if (!draft) return
    const p = point(e)
    setDraft({ ...draft, x1: p.x, y1: p.y })
  }

  function onPointerUp() {
    dragRef.current = null
    if (!draft) return
    const x = Math.min(draft.x0, draft.x1)
    const y = Math.min(draft.y0, draft.y1)
    const w = Math.abs(draft.x1 - draft.x0)
    const h = Math.abs(draft.y1 - draft.y0)
    setDraft(null)
    if (w < 0.02 || h < 0.02) return
    const id = `manual-${newId()}`
    setZones((prev) => [...prev, { id, quad: rectQuad(x, y, w, h), enabled: true }])
    setSelectedId(id)
  }

  const ordered = sortReadingOrder(zones.map((z) => z.quad))
  const orderOf = (z: Zone) => ordered.indexOf(z.quad)
  const enabled = zones.filter((z) => z.enabled).sort((a, b) => orderOf(a) - orderOf(b))

  async function apply() {
    if (!source || !page || !enabled.length) return
    const quads = enabled.map((z) => z.quad)
    const { scale, canvas } = source
    const mode = prefs.enhance
    onClose()
    const busy = useBusy.getState()
    try {
      busy.set('Découpe des tickets…', 0)
      const cv = await getOpenCvRuntime()
      const created: StudioPage[] = []
      for (let i = 0; i < quads.length; i++) {
        useBusy.getState().set(`Ticket ${i + 1} / ${quads.length}…`, i / quads.length)
        await new Promise((r) => setTimeout(r, 0))
        const b = quadBounds(quads[i])
        const lowRes = scale < LOW_RES_SCALE
        const zoom = prefs.upscale && lowRes ? receiptZoom(b.width * canvas.width, b.height * canvas.height) : 1
        const crop = extractQuad(cv, canvas, quads[i], zoom)
        // Taille physique conservée (un ticket de 8 cm reste un ticket de 8 cm), sauf pour une image
        // de faible résolution (capture, photo réduite) : sa taille n'a pas de sens, le ticket agrandi
        // est mis en page à 250 dpi pour rester lisible
        const ppt = zoom > 1 ? RECEIPT_DPI / 72 : scale
        const width = crop.width / ppt
        const height = crop.height / ppt
        // Déjà agrandi : pas de second agrandissement
        const out = mode === 'none' ? crop : enhanceCanvas(cv, crop, { ...loadEnhanceOptions(), mode, ...(zoom > 1 && { upscale: false }) })
        created.push({
          id: newId(),
          source: { kind: 'image', dataUrl: toDataUrl(out, mode), width, height },
          rotation: 0,
          annotations: [],
        })
      }
      const pages = useStudio.getState().pages
      const idx = pages.findIndex((p) => p.id === page.id)
      const next = [...pages]
      next.splice(idx < 0 ? pages.length : idx + (prefs.replace ? 0 : 1), prefs.replace && idx >= 0 ? 1 : 0, ...created)
      useStudio.getState().replaceAllPages(next, created[0]?.id)
      toast.success(`${created.length} ticket${created.length > 1 ? 's' : ''} isolé${created.length > 1 ? 's' : ''} — Ctrl+Z pour annuler`)
    } catch (err) {
      console.error(err)
      toast.error('Échec de la découpe des tickets')
    } finally {
      useBusy.getState().set(null)
    }
  }

  const aspect = source ? source.canvas.width / source.canvas.height : 0.7

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Isoler les tickets"
      wide="xl"
      actions={
        <>
          <button className="btn btn-ghost rounded-full" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary rounded-full" disabled={!enabled.length} onClick={() => void apply()}>
            {enabled.length ? `Créer ${enabled.length} page${enabled.length > 1 ? 's' : ''}` : 'Aucun ticket retenu'}
          </button>
        </>
      }
    >
      <div className="studio-image-dialog">
        <div className="studio-compare-wrap">
          <div className="studio-compare">
            {source ? (
              <div
                ref={stageRef}
                className="studio-receipts-stage"
                style={{ aspectRatio: String(aspect) }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => setDraft(null)}
              >
                <img src={source.url} alt="Page" draggable={false} />
                <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
                  {zones.map((z) => (
                    <polygon
                      key={z.id}
                      points={z.quad.map((p) => `${p.x},${p.y}`).join(' ')}
                      className={`${z.enabled ? 'is-on' : 'is-off'} ${z.id === selectedId ? 'is-selected' : ''}`}
                      vectorEffect="non-scaling-stroke"
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        setSelectedId(z.id)
                      }}
                    />
                  ))}
                  {draft && (
                    <rect
                      x={Math.min(draft.x0, draft.x1)} y={Math.min(draft.y0, draft.y1)}
                      width={Math.abs(draft.x1 - draft.x0)} height={Math.abs(draft.y1 - draft.y0)}
                      className="is-draft" vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>
                {zones.find((z) => z.id === selectedId)?.quad.map((p, corner) => (
                  <span
                    key={corner}
                    className="studio-receipt-handle"
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                    title="Déplacer ce coin"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      stageRef.current?.setPointerCapture(e.pointerId)
                      dragRef.current = { id: selectedId!, corner }
                    }}
                  />
                ))}
                {zones.map((z) => {
                  const b = quadBounds(z.quad)
                  const n = enabled.indexOf(z) + 1
                  return (
                    <div key={z.id} className="studio-receipt-badge" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%` }}>
                      <button
                        className={z.enabled ? 'is-on' : ''}
                        title={z.enabled ? 'Exclure ce ticket' : 'Inclure ce ticket'}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setZones((prev) => prev.map((o) => (o.id === z.id ? { ...o, enabled: !o.enabled } : o)))}
                      >
                        {z.enabled ? n : '—'}
                      </button>
                      <button
                        title="Supprimer la zone"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setZones((prev) => prev.filter((o) => o.id !== z.id))}
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="studio-compare-empty"><span className="loading loading-spinner" /></div>
            )}
            {detecting && source && <span className="studio-compare-busy loading loading-spinner loading-sm" />}
          </div>
        </div>

        <div className="studio-image-side">
          <p className="studio-hint">
            {zones.length
              ? `${zones.length} zone${zones.length > 1 ? 's' : ''}. Cliquez sur un numéro pour exclure un ticket, sur une zone pour ajuster ses coins, ou tracez une zone à la souris pour en ajouter une.`
              : 'Aucun ticket détecté automatiquement : tracez les zones à la souris.'}
          </p>
          <label className="studio-enhance-range">
            <span>Sensibilité</span>
            <input
              type="range" className="range range-xs" min={0} max={1} step={0.05}
              value={prefs.sensitivity}
              onChange={(e) => setPrefs({ sensitivity: Number(e.target.value) })}
            />
          </label>
          {selectedId && zones.some((z) => z.id === selectedId) && (
            <div className="studio-receipt-tools">
              <span>Zone sélectionnée</span>
              <div className="flex flex-wrap gap-1">
                <button className="btn btn-xs rounded-full" title="Deux tickets l’un au-dessus de l’autre" onClick={() => splitSelected('h')}>Couper en haut / bas</button>
                <button className="btn btn-xs rounded-full" title="Deux tickets côte à côte" onClick={() => splitSelected('v')}>Couper gauche / droite</button>
                <button
                  className="btn btn-xs btn-ghost rounded-full"
                  onClick={() => {
                    setZones((prev) => prev.filter((z) => z.id !== selectedId))
                    setSelectedId(null)
                  }}
                >
                  Supprimer
                </button>
              </div>
            </div>
          )}
          <div className="flex gap-1">
            <button className="btn btn-xs rounded-full" disabled={!zones.length} onClick={() => { setZones([]); setSelectedId(null) }}>Effacer les zones</button>
          </div>

          <h4 className="studio-subtitle">Chaque ticket</h4>
          <label className="studio-field">
            <span>Amélioration</span>
            <select className="select select-sm" value={prefs.enhance} onChange={(e) => setPrefs({ enhance: e.target.value as ReceiptPrefs['enhance'] })}>
              <option value="none">Aucune (image d’origine)</option>
              {(Object.keys(ENHANCE_MODES) as EnhanceMode[]).map((m) => (
                <option key={m} value={m}>{ENHANCE_MODES[m].label}</option>
              ))}
            </select>
          </label>
          <label className="studio-enhance-check">
            <input type="checkbox" className="checkbox checkbox-xs" checked={prefs.replace} onChange={(e) => setPrefs({ replace: e.target.checked })} />
            <span>Remplacer la page d’origine par les tickets</span>
          </label>
          <label className="studio-enhance-check">
            <input type="checkbox" className="checkbox checkbox-xs" checked={prefs.upscale} onChange={(e) => setPrefs({ upscale: e.target.checked })} />
            <span>Agrandir les tickets d’une image de faible résolution (capture, photo réduite)</span>
          </label>
          {prefs.upscale && source && source.scale < LOW_RES_SCALE && (
            <p className="studio-hint studio-hint-warn">
              Image de faible résolution : les tickets seront agrandis pour être lisibles. L’agrandissement adoucit les
              pixels sans en inventer — un chiffre illisible sur l’original le restera.
            </p>
          )}
          <p className="studio-hint">
            Une page est créée par ticket, redressée et à sa taille réelle, dans l’ordre de lecture (de haut en bas, de gauche à
            droite). Exportez ensuite « une page par fichier » pour obtenir un PDF par ticket.
          </p>
        </div>
      </div>
    </Modal>
  )
}
