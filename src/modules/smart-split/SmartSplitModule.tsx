import { useMemo, useRef, useState } from 'react'
import {
  analyzeDocument,
  buildSegments,
  proposeCuts,
  DEFAULT_CONFIG,
  type AnalysisProgress,
  type CutInfo,
  type PageAnalysis,
  type SmartSplitConfig,
} from './pipeline'
import { exportSegments } from '../split/splitExport'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { toast } from '../../components/ui/Toast'
import {
  IconDownload, IconPlay, IconScissors, IconUpload, IconX,
} from '../../components/ui/icons'

/**
 * Splitteur intelligent : OCR + heuristiques pour proposer des coupures,
 * que l'utilisateur valide/ajuste avant export en .zip.
 * (La vérification LLM est un point d'extension non branché — voir hooks.ts.)
 */

const CONFIG_KEY = 'smart-split-config'

function loadConfig(): SmartSplitConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch { /* config corrompue : on repart des défauts */ }
  return DEFAULT_CONFIG
}

const SEGMENT_COLORS = [
  'ring-blue-500', 'ring-emerald-500', 'ring-amber-500',
  'ring-pink-500', 'ring-violet-500', 'ring-cyan-500',
]

export default function SmartSplitModule() {
  const [doc, setDoc] = useState<{ name: string; bytes: ArrayBuffer } | null>(null)
  const [config, setConfig] = useState<SmartSplitConfig>(loadConfig)
  const [pages, setPages] = useState<PageAnalysis[] | null>(null)
  const [cuts, setCuts] = useState<CutInfo[]>([])
  const [progress, setProgress] = useState<AnalysisProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const cancelRef = useRef(false)

  function updateConfig(patch: Partial<SmartSplitConfig>) {
    const next = { ...config, ...patch }
    setConfig(next)
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next))
  }

  async function handleFiles(files: File[]) {
    const file = files[0]
    if (!file) return
    setDoc({ name: file.name.replace(/\.pdf$/i, ''), bytes: await file.arrayBuffer() })
    setPages(null)
    setCuts([])
  }

  async function runAnalysis() {
    if (!doc) return
    cancelRef.current = false
    setRunning(true)
    setPages(null)
    setCuts([])
    try {
      const analyzed = await analyzeDocument(
        doc.bytes,
        config,
        setProgress,
        () => cancelRef.current
      )
      if (cancelRef.current) return
      setPages(analyzed)
      const proposed = await proposeCuts(analyzed, config, setProgress)
      setCuts(proposed)
      toast.success(
        proposed.length
          ? `${proposed.length} coupure${proposed.length > 1 ? 's' : ''} proposée${proposed.length > 1 ? 's' : ''}`
          : 'Aucune coupure détectée — ajustez les critères ou coupez manuellement'
      )
    } catch (err) {
      console.error(err)
      toast.error("Échec de l'analyse")
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  function toggleCut(beforePage: number) {
    setCuts((prev) => {
      const existing = prev.find((c) => c.beforePage === beforePage)
      if (existing) return prev.filter((c) => c.beforePage !== beforePage)
      return [...prev, { beforePage, reasons: ['Manuel'], manual: true }].sort(
        (a, b) => a.beforePage - b.beforePage
      )
    })
  }

  const segments = useMemo(
    () => (pages ? buildSegments(pages, cuts, config.excludeBlank) : []),
    [pages, cuts, config.excludeBlank]
  )

  /** Segment de chaque page (couleur), -1 si exclue. */
  const pageSegment = useMemo(() => {
    if (!pages) return []
    const map = new Array<number>(pages.length).fill(-1)
    segments.forEach((seg, si) => {
      for (const p of seg) map[p] = si
    })
    return map
  }, [pages, segments])

  async function handleExport() {
    if (!doc || segments.length === 0) return
    setExporting(true)
    try {
      await exportSegments(
        doc.bytes,
        segments.map((seg, i) => ({
          pages: seg,
          name: `${doc.name}-doc-${String(i + 1).padStart(2, '0')}`,
        })),
        `${doc.name}-decoupe.zip`
      )
      toast.success(`${segments.length} document${segments.length > 1 ? 's' : ''} exporté${segments.length > 1 ? 's' : ''}`)
    } catch (err) {
      console.error(err)
      toast.error("Échec de l'export")
    } finally {
      setExporting(false)
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
            <p className="font-semibold">Déposez un PDF multi-documents</p>
            <p className="text-sm text-base-content/60">
              OCR + détection de motifs, pages blanches et ruptures visuelles
              pour retrouver les documents individuels
            </p>
          </div>
        </FileDropzone>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Barre d'actions */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{doc.name}.pdf</span>
        {pages && (
          <span className="text-sm text-base-content/60">
            {pages.length} pages → <span className="font-semibold">{segments.length} document{segments.length > 1 ? 's' : ''}</span>
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button
            className="btn btn-sm btn-ghost rounded-full gap-1"
            onClick={() => {
              cancelRef.current = true
              setDoc(null)
              setPages(null)
              setCuts([])
            }}
          >
            <IconX /> Fermer
          </button>
          <button
            className="btn btn-sm btn-soft rounded-full gap-1.5"
            onClick={() => void runAnalysis()}
            disabled={running}
          >
            {running ? <span className="loading loading-spinner loading-xs" /> : <IconPlay />}
            Analyser
          </button>
          <button
            className="btn btn-sm btn-primary rounded-full shadow-md gap-1.5"
            onClick={() => void handleExport()}
            disabled={exporting || segments.length === 0}
          >
            {exporting ? <span className="loading loading-spinner loading-xs" /> : <IconDownload />}
            Exporter ({segments.length || '–'})
          </button>
        </div>
      </div>

      {/* Configuration des signaux */}
      <div className="collapse collapse-arrow bg-base-100 border border-base-300/50 shadow-sm">
        <input type="checkbox" defaultChecked={!pages} />
        <div className="collapse-title text-sm font-medium py-2 min-h-0">
          ⚙️ Critères de détection
        </div>
        <div className="collapse-content flex flex-col gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="toggle toggle-sm toggle-primary"
              checked={config.usePatterns}
              onChange={(e) => updateConfig({ usePatterns: e.target.checked })}
            />
            Motifs de début de document (regex, une par ligne, insensibles à la casse)
          </label>
          {config.usePatterns && (
            <textarea
              className="textarea textarea-sm font-mono w-full max-w-md"
              rows={3}
              value={config.patterns.join('\n')}
              onChange={(e) => updateConfig({ patterns: e.target.value.split('\n') })}
              placeholder={'Facture\\s+n[°o]\nDossier\\s+\\d+'}
            />
          )}
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="toggle toggle-sm toggle-primary"
                checked={config.useBlank}
                onChange={(e) => updateConfig({ useBlank: e.target.checked })}
              />
              Pages blanches comme séparateurs
            </label>
            {config.useBlank && (
              <label className="flex items-center gap-2">
                Seuil d'encre
                <input
                  type="range" min={0.02} max={1} step={0.02}
                  className="range range-primary range-xs w-32"
                  value={config.blankInkPct}
                  onChange={(e) => updateConfig({ blankInkPct: Number(e.target.value) })}
                />
                <span className="font-mono text-xs">{config.blankInkPct.toFixed(2)}%</span>
              </label>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={config.excludeBlank}
                onChange={(e) => updateConfig({ excludeBlank: e.target.checked })}
              />
              Exclure les pages blanches de l'export
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="toggle toggle-sm toggle-primary"
                checked={config.useVisual}
                onChange={(e) => updateConfig({ useVisual: e.target.checked })}
              />
              Rupture de similarité visuelle (signal secondaire)
            </label>
            {config.useVisual && (
              <label className="flex items-center gap-2">
                Sensibilité
                <input
                  type="range" min={8} max={40} step={1}
                  className="range range-primary range-xs w-32"
                  value={config.visualThreshold}
                  onChange={(e) => updateConfig({ visualThreshold: Number(e.target.value) })}
                />
                <span className="font-mono text-xs">d &gt; {config.visualThreshold}</span>
              </label>
            )}
          </div>
          <p className="text-xs text-base-content/50">
            🧩 Vérification des coupures par LLM local : point d'extension prévu
            (<code>verifySplitBoundary</code> dans <code>hooks.ts</code>), non branché à ce stade.
          </p>
        </div>
      </div>

      {/* Progression de l'analyse */}
      {progress && (
        <div className="card bg-base-100 border border-base-300/50 shadow-sm">
          <div className="card-body p-3 gap-2">
            <div className="flex justify-between text-sm">
              <span>
                {progress.phase === 'render' && 'Rendu…'}
                {progress.phase === 'analyse' && 'Analyse visuelle…'}
                {progress.phase === 'ocr' && 'OCR en cours…'}
                {progress.phase === 'verify' && 'Vérification…'}
                {' '}Page {progress.page} / {progress.totalPages}
              </span>
              <span className="font-mono">
                {Math.round(((progress.page - 1 + progress.pct) / progress.totalPages) * 100)}%
              </span>
            </div>
            <progress
              className="progress progress-primary w-full"
              value={(progress.page - 1 + progress.pct) * 100}
              max={progress.totalPages * 100}
            />
          </div>
        </div>
      )}

      {/* Résultats : pages + séparateurs cliquables */}
      {pages && (
        <>
          <p className="text-xs text-base-content/50">
            Cliquez sur les ciseaux entre deux pages pour ajouter ou retirer une coupure.
          </p>
          <div className="flex flex-wrap items-stretch gap-y-4">
            {pages.map((p, i) => {
              const cut = cuts.find((c) => c.beforePage === i)
              const si = pageSegment[i]
              return (
                <div key={p.index} className="flex items-stretch">
                  {i > 0 && (
                    <div className="flex flex-col items-center justify-center px-0.5">
                      <div
                        className={`tooltip ${cut ? 'tooltip-open-never' : ''}`}
                        data-tip={cut ? cut.reasons.join(' · ') : 'Couper ici'}
                      >
                        <button
                          className={`btn btn-xs btn-circle ${
                            cut ? 'btn-primary' : 'btn-ghost opacity-40 hover:opacity-100'
                          }`}
                          onClick={() => toggleCut(i)}
                        >
                          <IconScissors />
                        </button>
                      </div>
                      <div
                        className={`flex-1 w-0.5 ${cut ? 'bg-primary' : 'bg-transparent'}`}
                      />
                    </div>
                  )}
                  <div className="flex flex-col items-center gap-1 w-[104px]">
                    <div
                      className={`relative bg-white border border-base-300 rounded-sm ${
                        si >= 0 ? `ring-2 ${SEGMENT_COLORS[si % SEGMENT_COLORS.length]}` : 'opacity-40'
                      }`}
                    >
                      <img src={p.thumb} alt="" className="w-full object-contain" style={{ maxHeight: 140 }} />
                      {si >= 0 && (
                        <span className="badge badge-neutral badge-xs absolute top-1 left-1">{si + 1}</span>
                      )}
                      {p.isBlank && (
                        <span className="badge badge-warning badge-xs absolute bottom-1 left-1">blanche</span>
                      )}
                      {p.matchedPattern && (
                        <span className="badge badge-success badge-xs absolute bottom-1 right-1" title={`Motif : ${p.matchedPattern}`}>
                          motif
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-base-content/60">p. {i + 1}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Récapitulatif des documents détectés */}
          {segments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {segments.map((seg, i) => (
                <span key={i} className="badge badge-soft badge-primary">
                  doc {i + 1} : p. {seg[0] + 1}
                  {seg.length > 1 ? `–${seg[seg.length - 1] + 1}` : ''}
                  {' '}({seg.length} p.)
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
