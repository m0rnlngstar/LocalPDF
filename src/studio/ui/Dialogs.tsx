import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStudio } from '../store'
import { buildStudioPdf, buildWithinLimit, zipFiles } from '../exportPdf'
import { downloadBytes } from '../../lib/pdfExport'
import { COMPRESS_LEVELS, type CompressLevel } from '../../lib/compress'
import { PAGE_FORMATS, type PageFormatId, type StudioPage } from '../types'
import { useBusy } from '../actions'
import { toast } from '../../components/ui/Toast'

export function Modal({
  open, onClose, title, children, actions, wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  actions?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onCancel={onClose}>
      <div className={`modal-box studio-modal ${wide ? 'max-w-2xl' : 'max-w-lg'}`}>
        <h3 className="font-semibold text-lg mb-4">{title}</h3>
        {children}
        {actions && <div className="modal-action">{actions}</div>}
      </div>
      <form method="dialog" className="modal-backdrop"><button aria-label="Fermer">close</button></form>
    </dialog>
  )
}

/**
 * Plages de pages saisies par l'utilisateur (« 1-3, 5, 8- »), en index 0..n-1.
 * Retourne null si la saisie est invalide.
 */
export function parseRanges(input: string, count: number): number[][] | null {
  const groups: number[][] = []
  for (const part of input.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part)
    let a: number
    let b: number
    if (m) {
      a = m[1] ? Number(m[1]) : 1
      b = m[2] ? Number(m[2]) : count
    } else if (/^\d+$/.test(part)) {
      a = b = Number(part)
    } else return null
    if (a < 1 || b > count || a > b) return null
    groups.push(Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i))
  }
  return groups.length ? groups : null
}

type Scope = 'all' | 'selection' | 'range'

/** Taille maximale par fichier mémorisée (ex. 5 Mo pour MEG). */
const MAX_SIZE_KEY = 'studio-export-max-mb'
type Output = 'single' | 'per-page' | 'per-range'

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pages = useStudio((s) => s.pages)
  const docs = useStudio((s) => s.docs)
  const name = useStudio((s) => s.name)
  const watermark = useStudio((s) => s.watermark)
  const selected = useStudio((s) => s.selectedPageIds)

  const [scope, setScope] = useState<Scope>('all')
  const [range, setRange] = useState('')
  const [output, setOutput] = useState<Output>('single')
  const [fileName, setFileName] = useState(name)
  const [compress, setCompress] = useState<CompressLevel | ''>('')
  const [nativeComments, setNativeComments] = useState(true)
  const [includeOcr, setIncludeOcr] = useState(true)
  const [withWatermark, setWithWatermark] = useState(true)
  // Le nom du fichier (souvent le nom du client) n'est pas écrit dans les propriétés du PDF par défaut
  const [withTitle, setWithTitle] = useState(false)
  const [maxMb, setMaxMbState] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(MAX_SIZE_KEY)) || 0
    } catch {
      return 0
    }
  })
  const setMaxMb = (v: number) => {
    setMaxMbState(v)
    try {
      localStorage.setItem(MAX_SIZE_KEY, String(v))
    } catch {
      // préférence non mémorisée
    }
  }

  useEffect(() => {
    if (!open) return
    setFileName(name)
    setScope(selected.length > 1 ? 'selection' : 'all')
  }, [open, name, selected.length])

  const groups = parseRanges(range, pages.length)
  const rangeError = scope === 'range' || output === 'per-range' ? (range.trim() && !groups ? 'Plage invalide' : null) : null

  function chosenPages(): StudioPage[] {
    if (scope === 'selection') return pages.filter((p) => selected.includes(p.id))
    if (scope === 'range' && groups) {
      const idx = [...new Set(groups.flat())].sort((a, b) => a - b)
      return idx.map((i) => pages[i])
    }
    return pages
  }

  const count = chosenPages().length
  const hasOcr = pages.some((p) => p.ocr)
  const hasComments = pages.some((p) => p.annotations.some((a) => a.comment || a.type === 'note'))

  async function run() {
    const base = fileName.trim().replace(/\.pdf$/i, '') || 'document'
    const setBusy = (label: string, p: number | null = null) => useBusy.getState().set(label, p)
    const opts = {
      watermark: withWatermark ? watermark : null,
      nativeComments, includeOcr, compress: compress || null, title: withTitle ? base : undefined,
      onProgress: (d: number, t: number) => setBusy('Export en cours…', t ? d / t : null),
    }
    const chosen = chosenPages()
    if (!chosen.length) return

    // Fichiers à produire (avant application éventuelle de la taille maximale)
    const jobs: { name: string; pages: StudioPage[] }[] =
      output === 'single'
        ? [{ name: base, pages: chosen }]
        : output === 'per-page'
          ? chosen.map((p) => ({ name: `${base}-p${pages.indexOf(p) + 1}`, pages: [p] }))
          : (groups ?? []).map((g) => ({
              name: `${base}-p${g[0] + 1}${g.length > 1 ? `-${g[g.length - 1] + 1}` : ''}`,
              pages: g.map((i) => pages[i]),
            }))

    onClose()
    setBusy('Export en cours…', 0)
    try {
      const files: { name: string; bytes: Uint8Array }[] = []
      let rasterized = false
      let split = false
      let overLimit = false
      for (const [j, job] of jobs.entries()) {
        const prefix = jobs.length > 1 ? `Fichier ${j + 1}/${jobs.length} — ` : ''
        if (!maxMb) {
          setBusy(`${prefix}Export…`, jobs.length > 1 ? j / jobs.length : 0)
          files.push({ name: `${job.name}.pdf`, bytes: await buildStudioPdf(job.pages, docs, jobs.length > 1 ? { ...opts, onProgress: undefined } : opts) })
          continue
        }
        const r = await buildWithinLimit(job.pages, docs, opts, maxMb * 1024 * 1024, (label) => setBusy(prefix + label))
        rasterized ||= r.method === 'rasterize'
        overLimit ||= r.overLimit
        if (r.parts.length > 1) split = true
        r.parts.forEach((part, k) =>
          files.push({ name: r.parts.length > 1 ? `${job.name}-partie${k + 1}.pdf` : `${job.name}.pdf`, bytes: part.bytes })
        )
      }

      if (files.length === 1) downloadBytes(files[0].bytes, files[0].name)
      else downloadBytes(await zipFiles(files), `${base}.zip`, 'application/zip')

      if (overLimit) toast.error(`Une page seule dépasse encore ${maxMb} Mo : vérifiez le fichier avant l’envoi.`)
      else if (split) toast.info(`Document découpé en ${files.length} fichiers de ${maxMb} Mo maximum (archive .zip).`)
      else if (rasterized) toast.info(`Pages converties en images pour tenir sous ${maxMb} Mo (texte toujours cherchable).`)
      else toast.success('Export terminé')
    } catch (err) {
      console.error(err)
      toast.error('Échec de l’export')
    } finally {
      useBusy.getState().set(null)
    }
  }

  const disabled = !count || !!rangeError || ((scope === 'range' || output === 'per-range') && !groups)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Exporter"
      wide
      actions={
        <>
          <button className="btn btn-ghost rounded-full" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary rounded-full" disabled={disabled} onClick={() => void run()}>
            Exporter {count ? `(${count} page${count > 1 ? 's' : ''})` : ''}
          </button>
        </>
      }
    >
      <div className="studio-form">
        <label className="studio-field">
          <span>Nom du fichier</span>
          <input className="input input-sm w-full" value={fileName} onChange={(e) => setFileName(e.target.value)} />
        </label>

        <fieldset className="studio-field">
          <span>Pages</span>
          <div className="studio-radio-row">
            <label><input type="radio" className="radio radio-sm" checked={scope === 'all'} onChange={() => setScope('all')} /> Toutes ({pages.length})</label>
            <label className={selected.length ? '' : 'opacity-50'}>
              <input type="radio" className="radio radio-sm" disabled={!selected.length} checked={scope === 'selection'} onChange={() => setScope('selection')} /> Sélection ({selected.length})
            </label>
            <label><input type="radio" className="radio radio-sm" checked={scope === 'range'} onChange={() => setScope('range')} /> Plage</label>
          </div>
        </fieldset>

        <fieldset className="studio-field">
          <span>Fichiers produits</span>
          <div className="studio-radio-row">
            <label><input type="radio" className="radio radio-sm" checked={output === 'single'} onChange={() => setOutput('single')} /> Un seul PDF</label>
            <label><input type="radio" className="radio radio-sm" checked={output === 'per-page'} onChange={() => setOutput('per-page')} /> Un PDF par page (.zip)</label>
            <label><input type="radio" className="radio radio-sm" checked={output === 'per-range'} onChange={() => setOutput('per-range')} /> Un PDF par plage (.zip)</label>
          </div>
        </fieldset>

        {(scope === 'range' || output === 'per-range') && (
          <label className="studio-field">
            <span>Plages {output === 'per-range' ? '(un fichier par plage)' : ''}</span>
            <input
              className={`input input-sm w-full ${rangeError ? 'input-error' : ''}`}
              placeholder="ex. 1-3, 5, 8-"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            />
            {rangeError && <small className="text-error">{rangeError}</small>}
          </label>
        )}

        <label className="studio-field">
          <span>Compression</span>
          <select className="select select-sm w-full" value={compress} onChange={(e) => setCompress(e.target.value as CompressLevel | '')}>
            <option value="">Aucune (qualité d’origine)</option>
            {(Object.keys(COMPRESS_LEVELS) as CompressLevel[]).map((k) => (
              <option key={k} value={k}>{COMPRESS_LEVELS[k].label}</option>
            ))}
          </select>
        </label>

        <label className="studio-field">
          <span>Taille maximale par fichier</span>
          <select className="select select-sm w-full" value={maxMb} onChange={(e) => setMaxMb(Number(e.target.value))}>
            <option value={0}>Pas de limite</option>
            <option value={5}>5 Mo (MEG)</option>
            <option value={10}>10 Mo</option>
            <option value={20}>20 Mo (pièce jointe e-mail)</option>
          </select>
          {maxMb > 0 && (
            <small className="studio-hint">
              Si besoin : compression renforcée, puis pages converties en images (texte conservé), puis découpage en plusieurs fichiers.
            </small>
          )}
        </label>

        <div className="studio-checks">
          <label><input type="checkbox" className="checkbox checkbox-sm" checked={nativeComments} onChange={(e) => setNativeComments(e.target.checked)} disabled={!hasComments} /> Commentaires lisibles dans Acrobat / Edge</label>
          <label><input type="checkbox" className="checkbox checkbox-sm" checked={includeOcr} onChange={(e) => setIncludeOcr(e.target.checked)} disabled={!hasOcr} /> Texte OCR invisible (PDF cherchable)</label>
          <label><input type="checkbox" className="checkbox checkbox-sm" checked={withTitle} onChange={(e) => setWithTitle(e.target.checked)} /> Écrire le nom du document dans les propriétés du PDF</label>
          <label><input type="checkbox" className="checkbox checkbox-sm" checked={withWatermark} onChange={(e) => setWithWatermark(e.target.checked)} disabled={!watermark?.text} /> Filigrane {watermark?.text ? `« ${watermark.text} »` : '(aucun)'}</label>
        </div>
        <p className="studio-hint">
          Les zones masquées et les corrections de texte sur fond opaque sont aplaties : le texte d’origine situé dessous
          est réellement supprimé du fichier (la page devient une image, son texte reste cherchable).
        </p>
      </div>
    </Modal>
  )
}

export function NewDocDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const newDocument = useStudio((s) => s.newDocument)
  const hasPages = useStudio((s) => s.pages.length > 0)
  const [format, setFormat] = useState<PageFormatId>('A4')
  const [landscape, setLandscape] = useState(false)
  const [count, setCount] = useState(1)
  const [docName, setDocName] = useState('nouveau-document')

  function create() {
    if (hasPages && !window.confirm('Fermer le document ouvert et en créer un nouveau ?')) return
    const f = PAGE_FORMATS[format]
    newDocument(landscape ? { width: f.height, height: f.width } : { width: f.width, height: f.height }, count, docName.trim() || 'nouveau-document')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouveau document"
      actions={
        <>
          <button className="btn btn-ghost rounded-full" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary rounded-full" onClick={create}>Créer</button>
        </>
      }
    >
      <div className="studio-form">
        <label className="studio-field">
          <span>Nom</span>
          <input className="input input-sm w-full" value={docName} onChange={(e) => setDocName(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="studio-field">
            <span>Format</span>
            <select className="select select-sm w-full" value={format} onChange={(e) => setFormat(e.target.value as PageFormatId)}>
              {(Object.keys(PAGE_FORMATS) as PageFormatId[]).map((k) => <option key={k} value={k}>{PAGE_FORMATS[k].label}</option>)}
            </select>
          </label>
          <label className="studio-field">
            <span>Nombre de pages</span>
            <input type="number" min={1} max={200} className="input input-sm w-full" value={count} onChange={(e) => setCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
          </label>
        </div>
        <div className="studio-radio-row">
          <label><input type="radio" className="radio radio-sm" checked={!landscape} onChange={() => setLandscape(false)} /> Portrait</label>
          <label><input type="radio" className="radio radio-sm" checked={landscape} onChange={() => setLandscape(true)} /> Paysage</label>
        </div>
      </div>
    </Modal>
  )
}
