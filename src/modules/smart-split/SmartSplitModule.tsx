import { useEffect, useMemo, useRef, useState } from 'react'
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
import { SmartSplitHelp } from './HelpDialog'
import { createLlmVerifier, setSplitVerifier } from './hooks'
import {
  canRunLlm, LLM_MODELS, onLlmActivity, onLlmLoadProgress, type LlmLoadProgress,
} from '../../lib/llm'
import {
  classifyModels, detectHardware, type HardwareProfile, type ModelFit,
} from '../../lib/hardware'
import { openPdf } from '../../lib/pdfjs'
import { toast } from '../../components/ui/Toast'
import { LlmLoadCard } from '../../components/ui/LlmLoadCard'
import {
  IconDownload, IconPlay, IconScissors, IconX,
} from '../../components/ui/icons'

/**
 * Splitteur intelligent : OCR + heuristiques pour proposer des coupures,
 * que l'utilisateur valide/ajuste avant export en .zip. La vérification LLM
 * (multimodale) confirme, retire ou ajoute des coupures — voir hooks.ts.
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


const FIT_BADGE: Record<ModelFit, { label: string; cls: string } | null> = {
  recommended: { label: 'recommandé pour votre machine', cls: 'badge-success' },
  ok: null,
  fallback: { label: 'basculera en mode texte (pas de fp16)', cls: 'badge-warning' },
  unavailable: { label: 'indisponible sans GPU', cls: 'badge-error' },
}

/**
 * Prévisualisation d'une page au survol de sa miniature : rendu ~900 px à la
 * demande depuis le PDF source (mis en cache), affiché dans un panneau
 * flottant à côté de la vignette — pour vérifier les coupures sans zoomer.
 */
function usePagePreview(bytes: ArrayBuffer | null) {
  const cache = useRef(new Map<number, string>())
  const pdfRef = useRef<Promise<Awaited<ReturnType<typeof openPdf>>> | null>(null)
  const [preview, setPreview] = useState<{ page: number; url: string; x: number; y: number } | null>(null)
  const hoverRef = useRef<number | null>(null)

  // Nouveau document : on repart de zéro
  useEffect(() => {
    cache.current = new Map()
    pdfRef.current = null
    setPreview(null)
  }, [bytes])

  async function renderPage(index: number): Promise<string> {
    const cached = cache.current.get(index)
    if (cached) return cached
    if (!pdfRef.current) {
      if (!bytes) throw new Error('pas de document')
      pdfRef.current = openPdf(bytes.slice(0))
    }
    const pdf = await pdfRef.current
    const page = await pdf.getPage(index + 1)
    const vp0 = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: Math.min(900 / vp0.width, 2) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
    const url = canvas.toDataURL('image/jpeg', 0.85)
    cache.current.set(index, url)
    return url
  }

  function show(index: number, el: HTMLElement) {
    hoverRef.current = index
    const rect = el.getBoundingClientRect()
    void renderPage(index)
      .then((url) => {
        if (hoverRef.current !== index) return // la souris est déjà partie
        setPreview({ page: index, url, x: rect.right, y: rect.top + rect.height / 2 })
      })
      .catch(() => {})
  }

  function hide() {
    hoverRef.current = null
    setPreview(null)
  }

  return { preview, show, hide }
}

function PagePreviewPanel({ preview }: { preview: { page: number; url: string; x: number; y: number } }) {
  // À droite de la vignette si la place le permet, sinon à gauche
  const width = Math.min(420, window.innerWidth - 32)
  const left = preview.x + width + 24 < window.innerWidth ? preview.x + 12 : Math.max(8, preview.x - width - 140)
  const maxH = Math.round(window.innerHeight * 0.85)
  const top = Math.min(Math.max(8, preview.y - maxH / 2), window.innerHeight - maxH - 8)
  return (
    <div
      className="fixed z-50 pointer-events-none rounded-box border border-base-300 bg-base-100 shadow-2xl p-2"
      style={{ left, top, width }}
    >
      <img
        src={preview.url}
        alt={`Aperçu de la page ${preview.page + 1}`}
        className="w-full rounded-sm border border-base-200"
        style={{ maxHeight: maxH - 40, objectFit: 'contain' }}
      />
      <p className="text-center text-xs text-base-content/60 pt-1">page {preview.page + 1}</p>
    </div>
  )
}


export default function SmartSplitModule() {
  const [doc, setDoc] = useState<{ name: string; bytes: ArrayBuffer } | null>(null)
  const [config, setConfig] = useState<SmartSplitConfig>(loadConfig)
  const [pages, setPages] = useState<PageAnalysis[] | null>(null)
  const [cuts, setCuts] = useState<CutInfo[]>([])
  const [progress, setProgress] = useState<AnalysisProgress | null>(null)
  const [llmLoad, setLlmLoad] = useState<LlmLoadProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [hardware, setHardware] = useState<HardwareProfile | null>(null)
  const [llmLog, setLlmLog] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)
  const cancelRef = useRef(false)
  const { preview, show: showPreview, hide: hidePreview } = usePagePreview(doc?.bytes ?? null)

  // Profil machine (une fois) : recommandation de modèle dans les réglages
  useEffect(() => {
    void detectHardware().then(setHardware)
  }, [])
  const modelFit = useMemo(() => (hardware ? classifyModels(hardware) : null), [hardware])

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
    // Branche (ou débranche) le vérificateur LLM selon la config
    if (config.useLlm && canRunLlm(config.llmModel)) {
      setSplitVerifier(createLlmVerifier(config.llmModel))
      onLlmLoadProgress((p) => setLlmLoad(p.progress >= 1 ? null : p))
      setLlmLog([])
      onLlmActivity((line) => {
        const stamp = new Date().toLocaleTimeString('fr-FR')
        setLlmLog((prev) => [...prev.slice(-40), `${stamp}  ${line}`])
      })
    } else {
      setSplitVerifier(null)
      if (config.useLlm) {
        toast.error('Ce modèle exige un GPU (WebGPU) : vérification IA ignorée — choisissez SmolVLM (CPU)')
      }
    }
    try {
      const analyzed = await analyzeDocument(
        doc.bytes,
        config,
        setProgress,
        () => cancelRef.current
      )
      if (cancelRef.current) return
      setPages(analyzed)
      const { cuts: proposed, llm } = await proposeCuts(analyzed, config, setProgress)
      setCuts(proposed)
      // Bilan explicite de la passe IA : l'utilisateur voit si elle a tourné
      if (llm?.failed) {
        toast.error(`Vérification IA interrompue : ${llm.failed}`)
      } else if (llm) {
        toast.info(
          `IA : ${llm.examined} frontière${llm.examined > 1 ? 's' : ''} examinée${llm.examined > 1 ? 's' : ''} — ` +
          `${llm.confirmed} confirmée${llm.confirmed > 1 ? 's' : ''}, ${llm.removed} retirée${llm.removed > 1 ? 's' : ''}, ${llm.added} ajoutée${llm.added > 1 ? 's' : ''}`
        )
      }
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
      setLlmLoad(null)
      onLlmLoadProgress(null)
      onLlmActivity(null)
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
          title="Déposez un PDF multi-documents"
          description="OCR + détection de motifs, pages blanches et ruptures visuelles pour retrouver les documents individuels"
          footer={
            <span className="text-xs text-base-content/50 flex items-center gap-1">
              Comment ça marche ? <SmartSplitHelp />
            </span>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Barre d'actions */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{doc.name}.pdf</span>
        <SmartSplitHelp />
        {/* Compteur affiché une fois l'analyse terminée (les coupures arrivent en dernier) */}
        {pages && !running && (
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

      {/* Explication du fonctionnement, tant qu'aucune analyse n'a tourné */}
      {!pages && !running && (
        <div className="alert alert-soft text-sm">
          <span>
            💡 Cliquez sur <strong>Analyser</strong> : chaque page est lue (OCR) pour repérer
            les débuts de documents (ex. « Facture n° »), et les pages blanches servent de
            séparateurs. Vous validez ensuite les coupures proposées avant l'export.
          </span>
        </div>
      )}

      {/* Réglages avancés : les défauts conviennent à la plupart des cas */}
      <div className="collapse collapse-arrow bg-base-100 border border-base-300/50 shadow-sm">
        <input type="checkbox" />
        <div className="collapse-title text-sm font-medium py-2 min-h-0">
          🛠️ Réglages avancés
          <span className="text-base-content/50 font-normal"> — motifs de détection, seuils</span>
        </div>
        <div className="collapse-content flex flex-col gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              role="switch"
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
                role="switch"
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
                role="switch"
                className="toggle toggle-sm toggle-primary"
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
                role="switch"
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
          <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-base-200">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                role="switch"
                className="toggle toggle-sm toggle-primary"
                checked={config.useLlm}
                onChange={(e) => updateConfig({ useLlm: e.target.checked })}
              />
              🧩 Vérification des coupures par IA locale
            </label>
            {config.useLlm && (
              <select
                className="select select-sm w-fit max-w-full"
                value={config.llmModel}
                onChange={(e) => updateConfig({ llmModel: e.target.value })}
              >
                {LLM_MODELS.map((m) => {
                  const fit = modelFit?.[m.id]
                  return (
                    <option key={m.id} value={m.id} disabled={fit === 'unavailable'}>
                      {fit === 'recommended' ? '⭐ ' : ''}{m.label}
                      {fit === 'unavailable' ? ' — indisponible sans GPU' : ''}
                    </option>
                  )
                })}
              </select>
            )}
          </div>
          {config.useLlm && hardware && modelFit && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
              <span>
                Votre machine : GPU (WebGPU) {hardware.webgpu ? '✓' : '✗'} · fp16{' '}
                {hardware.f16 ? '✓' : '✗'}
                {hardware.cores ? ` · ${hardware.cores} cœurs` : ''}
                {hardware.gpuName ? ` · ${hardware.gpuName}` : ''}
                {hardware.vramHintGB ? ` · VRAM ≥ ${hardware.vramHintGB} Go (indice)` : ''}
              </span>
              {FIT_BADGE[modelFit[config.llmModel] ?? 'ok'] && (
                <span className={`badge badge-soft badge-xs ${FIT_BADGE[modelFit[config.llmModel] ?? 'ok']!.cls}`}>
                  {FIT_BADGE[modelFit[config.llmModel] ?? 'ok']!.label}
                </span>
              )}
            </div>
          )}
          {config.useLlm && !hardware?.webgpu && (
            <p className="text-xs text-warning">
              Pas de GPU accessible (WebGPU) : seul SmolVLM (CPU) peut tourner. Attention,
              c'est très lent (comptez plusieurs minutes par frontière, soit facilement
              15-20 min pour un document de 10 pages) et ses verdicts sont nettement moins
              fiables que ceux de Gemma 4 — les autres signaux (motifs, pages blanches)
              restent vos meilleurs alliés sans GPU.
              {!window.isSecureContext &&
                " Note : la page n'est pas servie en HTTPS (ou localhost), Chrome masque WebGPU hors contexte sécurisé — en https:// les modèles GPU s'activeraient."}
            </p>
          )}
          {config.useLlm && (
            <p className="text-xs text-base-content/50">
              Le modèle tourne entièrement dans votre navigateur. Il est téléchargé au
              premier usage puis mis en cache — vos documents, eux, ne quittent jamais la
              machine. Il examine chaque frontière entre pages : il confirme ou retire les
              coupures proposées par les autres signaux, et peut en ajouter que ceux-ci ont
              manquées. Les modèles multimodaux regardent l'image des pages, pas seulement
              le texte OCR.
            </p>
          )}
        </div>
      </div>

      {/* Chargement du modèle IA (premier usage) */}
      {llmLoad && (
        <LlmLoadCard
          load={llmLoad}
          footnote="Avec la vérification IA, l'analyse prend nettement plus de temps qu'une analyse simple — chaque frontière entre pages est soumise au modèle."
        />
      )}

      {/* Progression de l'analyse */}
      {progress && (
        <div
          className="card bg-base-100 border border-base-300/50 shadow-sm"
          onMouseEnter={() => setShowLog(true)}
          onMouseLeave={() => setShowLog(false)}
        >
          <div className="card-body p-4 gap-3">
            <div className="flex items-center gap-3">
              <div className="grid place-items-center w-9 h-9 rounded-full bg-primary/10 text-primary shrink-0">
                <span className="loading loading-spinner loading-sm" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">
                  {progress.phase === 'render' && 'Rendu des pages…'}
                  {progress.phase === 'analyse' && 'Analyse visuelle…'}
                  {progress.phase === 'ocr' && 'OCR en cours…'}
                  {progress.phase === 'verify' && 'Vérification des coupures par IA…'}
                </p>
                <p className="text-xs text-base-content/50 font-mono tabular-nums">
                  {progress.phase === 'verify'
                    ? `Frontière p.${progress.page}/${progress.totalPages} — durée selon le modèle et la machine`
                    : `Page ${progress.page} / ${progress.totalPages}`}
                  {llmLog.length > 0 && !showLog && '  ·  🖥️ survolez pour voir l’activité'}
                </p>
              </div>
              <span className="font-mono text-lg font-semibold tabular-nums">
                {Math.round(((progress.page - 1 + progress.pct) / progress.totalPages) * 100)}%
              </span>
            </div>
            <progress
              className="progress progress-primary w-full h-1.5"
              value={(progress.page - 1 + progress.pct) * 100}
              max={progress.totalPages * 100}
              aria-label="Progression de l'analyse"
            />
            {/* Mini-console : ce que fait l'IA en arrière-plan, au survol */}
            {showLog && llmLog.length > 0 && (
              <div className="bg-neutral text-neutral-content/90 rounded-lg p-2.5 font-mono text-[11px] leading-relaxed max-h-40 overflow-y-auto flex flex-col-reverse">
                <div>
                  {llmLog.map((line, i) => (
                    <p key={i} className="whitespace-nowrap overflow-hidden text-ellipsis">{line}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Résultats : pages + séparateurs cliquables */}
      {pages && (
        <>
          <p className="text-xs text-base-content/50">
            Cliquez sur les ciseaux entre deux pages pour ajouter ou retirer une coupure.
            Survolez une vignette pour l'agrandir.
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
                      onMouseEnter={(e) => showPreview(i, e.currentTarget)}
                      onMouseLeave={hidePreview}
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

          {/* Aperçu flottant de la page survolée */}
          {preview && <PagePreviewPanel preview={preview} />}
        </>
      )}
    </div>
  )
}
