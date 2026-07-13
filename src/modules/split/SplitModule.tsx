import { useEffect, useMemo, useState } from 'react'
import { openPdf } from '../../lib/pdfjs'
import { exportSegments, parseRanges, type Segment } from './splitExport'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { toast } from '../../components/ui/Toast'
import { IconDownload, IconUpload, IconX } from '../../components/ui/icons'

/**
 * Éclateur : découpe un PDF en plusieurs fichiers.
 * - mode "plages" : saisie manuelle type "1-3, 5, 7-9" → un fichier par plage
 * - mode "1 page = 1 fichier"
 * Export .zip (jszip) dès qu'il y a plusieurs fichiers.
 */

const SEGMENT_COLORS = [
  'ring-blue-500', 'ring-emerald-500', 'ring-amber-500',
  'ring-pink-500', 'ring-violet-500', 'ring-cyan-500',
]

interface LoadedDoc {
  name: string
  bytes: ArrayBuffer
  pageCount: number
  thumbs: string[]
}

export default function SplitModule() {
  const [doc, setDoc] = useState<LoadedDoc | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'ranges' | 'each'>('ranges')
  const [rangesInput, setRangesInput] = useState('')
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  async function handleFiles(files: File[]) {
    const file = files[0]
    if (!file) return
    setBusy(true)
    try {
      const bytes = await file.arrayBuffer()
      const pdf = await openPdf(bytes)
      const thumbs: string[] = []
      setDoc({ name: file.name.replace(/\.pdf$/i, ''), bytes, pageCount: pdf.numPages, thumbs: [] })
      setRangesInput(`1-${pdf.numPages}`)
      // Miniatures rendues progressivement
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const vp0 = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: 110 / vp0.width })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
        thumbs.push(canvas.toDataURL())
        setDoc((d) => (d ? { ...d, thumbs: [...thumbs] } : d))
      }
    } catch (err) {
      console.error(err)
      toast.error('Impossible de lire ce PDF')
      setDoc(null)
    } finally {
      setBusy(false)
    }
  }

  // Segments courants selon le mode ; erreur de saisie affichée sous le champ
  const { segments, error } = useMemo((): { segments: Segment[]; error: string | null } => {
    if (!doc) return { segments: [], error: null }
    if (mode === 'each') {
      return {
        segments: Array.from({ length: doc.pageCount }, (_, i) => ({
          pages: [i],
          name: `${doc.name}-page-${String(i + 1).padStart(2, '0')}`,
        })),
        error: null,
      }
    }
    try {
      const segs = parseRanges(rangesInput, doc.pageCount).map((s) => ({
        ...s,
        name: `${doc.name}-${s.name}`,
      }))
      return { segments: segs, error: null }
    } catch (e) {
      return { segments: [], error: (e as Error).message }
    }
  }, [doc, mode, rangesInput])

  /** Pour chaque page : index du segment auquel elle appartient (ou -1). */
  const pageSegment = useMemo(() => {
    if (!doc) return []
    const map = new Array<number>(doc.pageCount).fill(-1)
    segments.forEach((seg, si) => {
      for (const p of seg.pages) map[p] = si
    })
    return map
  }, [doc, segments])

  useEffect(() => {
    setProgress(null)
  }, [doc, mode, rangesInput])

  async function handleExport() {
    if (!doc || segments.length === 0) return
    setExporting(true)
    setProgress(null)
    try {
      await exportSegments(
        doc.bytes,
        segments,
        `${doc.name}-eclate.zip`,
        (done, total) => setProgress({ done, total })
      )
      toast.success(
        segments.length === 1 ? 'PDF exporté !' : `${segments.length} fichiers exportés en .zip`
      )
    } catch (err) {
      console.error(err)
      toast.error("Échec de l'export")
    } finally {
      setExporting(false)
      setProgress(null)
    }
  }

  if (!doc) {
    return (
      <div className="max-w-xl mx-auto mt-6 sm:mt-16">
        <FileDropzone
          accept="application/pdf"
          onFiles={(files) => void handleFiles(files)}
          className="bg-base-100 shadow-xl py-16"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="text-primary"><IconUpload /></div>
            <p className="font-semibold">Déposez le PDF à découper</p>
            <p className="text-sm text-base-content/60">
              Par plages de pages ou une page par fichier — tout reste dans votre navigateur
            </p>
            {busy && <span className="loading loading-spinner text-primary" />}
          </div>
        </FileDropzone>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="tabs tabs-box tabs-sm">
          <button
            className={`tab ${mode === 'ranges' ? 'tab-active' : ''}`}
            onClick={() => setMode('ranges')}
          >
            Par plages
          </button>
          <button
            className={`tab ${mode === 'each' ? 'tab-active' : ''}`}
            onClick={() => setMode('each')}
          >
            1 page = 1 fichier
          </button>
        </div>

        {mode === 'ranges' && (
          <input
            type="text"
            className={`input input-sm w-64 font-mono ${error ? 'input-error' : ''}`}
            placeholder="ex. 1-3, 5, 7-9"
            value={rangesInput}
            onChange={(e) => setRangesInput(e.target.value)}
          />
        )}

        <span className="text-sm text-base-content/60">
          {doc.name}.pdf · {doc.pageCount} pages →{' '}
          <span className="font-semibold">{segments.length || '?'} fichier{segments.length > 1 ? 's' : ''}</span>
        </span>

        <div className="ml-auto flex gap-2">
          <button className="btn btn-sm btn-ghost rounded-full gap-1" onClick={() => setDoc(null)}>
            <IconX /> Fermer
          </button>
          <button
            className="btn btn-sm btn-primary rounded-full shadow-md gap-1.5"
            onClick={handleExport}
            disabled={exporting || segments.length === 0}
          >
            {exporting ? <span className="loading loading-spinner loading-xs" /> : <IconDownload />}
            {segments.length > 1 ? 'Exporter le .zip' : 'Exporter'}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {progress && (
        <progress className="progress progress-primary w-64" value={progress.done} max={progress.total} />
      )}

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8 gap-3">
        {Array.from({ length: doc.pageCount }, (_, i) => {
          const si = pageSegment[i]
          return (
            <div key={i} className="flex flex-col items-center gap-1">
              <div
                className={`relative bg-white border border-base-300 ${
                  si >= 0 ? `ring-2 ${SEGMENT_COLORS[si % SEGMENT_COLORS.length]}` : 'opacity-40'
                } rounded-sm`}
              >
                {doc.thumbs[i] ? (
                  <img src={doc.thumbs[i]} alt="" className="w-full object-contain" style={{ maxHeight: 150 }} />
                ) : (
                  <div className="skeleton" style={{ width: 100, height: 140 }} />
                )}
                {si >= 0 && (
                  <span className="badge badge-neutral badge-xs absolute top-1 left-1">
                    {si + 1}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-base-content/60">p. {i + 1}</span>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-base-content/50">
        Le numéro sur chaque page indique le fichier de destination ; les pages grisées ne seront pas exportées.
      </p>
    </div>
  )
}
