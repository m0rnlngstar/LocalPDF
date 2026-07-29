import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  analyzeItems,
  proposeOrder,
  DEFAULT_CONFIG,
  type AnalysisProgress,
  type ItemAnalysis,
  type SmartMergeConfig,
} from './pipeline'
import { readFilesAsMergeItems, buildMergedPdf, type MergeItem } from '../merge/store'
import { openPdf } from '../../lib/pdfjs'
import { downloadBytes } from '../create/exportPdf'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { SmartMergeHelp } from './HelpDialog'
import { createLlmVerifier, setMergeVerifier } from './hooks'
import {
  canRunLlm, LLM_MODELS, onLlmActivity, onLlmLoadProgress, type LlmLoadProgress,
} from '../../lib/llm'
import {
  classifyModels, detectHardware, type HardwareProfile, type ModelFit,
} from '../../lib/hardware'
import { toast } from '../../components/ui/Toast'
import { LlmLoadCard } from '../../components/ui/LlmLoadCard'
import { IconDownload, IconImage, IconPlay, IconPlus, IconX } from '../../components/ui/icons'

/**
 * Fusion intelligente : OCR + heuristiques pour proposer un ordre de fusion
 * (numéros de page détectés, à défaut chaînage visuel), que l'utilisateur
 * ajuste (glisser-déposer) avant export. La vérification LLM (optionnelle)
 * confirme ou signale chaque jointure — voir hooks.ts.
 */

const CONFIG_KEY = 'smart-merge-config'

function loadConfig(): SmartMergeConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch { /* config corrompue : on repart des défauts */ }
  return DEFAULT_CONFIG
}

const FIT_BADGE: Record<ModelFit, { label: string; cls: string } | null> = {
  recommended: { label: 'recommandé pour votre machine', cls: 'badge-success' },
  ok: null,
  fallback: { label: 'basculera en mode texte (pas de fp16)', cls: 'badge-warning' },
  unavailable: { label: 'indisponible sans GPU', cls: 'badge-error' },
}

const METHOD_LABEL: Record<'numbers' | 'visual' | 'filename', string> = {
  numbers: '🔢 numéros de page détectés',
  visual: '🖼️ chaînage visuel',
  filename: '🔤 ordre alphabétique (aucun signal fiable)',
}

/** Miniature de la première page d'un fichier (cache module, réutilisée tant que l'analyse n'a pas tourné). */
const thumbCache = new Map<string, Promise<string>>()

function onDemandThumb(item: MergeItem): Promise<string> {
  let p = thumbCache.get(item.id)
  if (!p) {
    p = (async () => {
      if (item.kind === 'image') return item.dataUrl!
      const doc = await openPdf(item.bytes!)
      const page = await doc.getPage(1)
      const vp0 = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: 130 / vp0.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
      return canvas.toDataURL()
    })()
    thumbCache.set(item.id, p)
  }
  return p
}

function ItemThumb({ item, analyzed }: { item: MergeItem; analyzed?: ItemAnalysis }) {
  const [src, setSrc] = useState<string | null>(analyzed?.firstThumb ?? null)

  useEffect(() => {
    if (analyzed?.firstThumb) {
      setSrc(analyzed.firstThumb)
      return
    }
    let cancelled = false
    onDemandThumb(item)
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch(console.error)
    return () => {
      cancelled = true
    }
  }, [item, analyzed])

  return src ? (
    <img
      src={src}
      alt=""
      className="border border-base-300 shadow-sm bg-white"
      style={{ width: 130, height: 170, objectFit: 'contain' }}
      draggable={false}
    />
  ) : (
    <div className="skeleton" style={{ width: 130, height: 170 }} />
  )
}

export default function SmartMergeModule() {
  const [items, setItems] = useState<MergeItem[]>([])
  const [config, setConfig] = useState<SmartMergeConfig>(loadConfig)
  const [analysis, setAnalysis] = useState<Map<string, ItemAnalysis> | null>(null)
  const [reasons, setReasons] = useState<Map<string, string[]>>(new Map())
  const [method, setMethod] = useState<'numbers' | 'visual' | 'filename' | null>(null)
  const [progress, setProgress] = useState<AnalysisProgress | null>(null)
  const [llmLoad, setLlmLoad] = useState<LlmLoadProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hardware, setHardware] = useState<HardwareProfile | null>(null)
  const [llmLog, setLlmLog] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)
  const cancelRef = useRef(false)
  const addInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void detectHardware().then(setHardware)
  }, [])
  const modelFit = useMemo(() => (hardware ? classifyModels(hardware) : null), [hardware])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  )

  function updateConfig(patch: Partial<SmartMergeConfig>) {
    const next = { ...config, ...patch }
    setConfig(next)
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next))
  }

  async function handleFiles(files: File[]) {
    setBusy(true)
    try {
      const newItems = await readFilesAsMergeItems(files)
      setItems((prev) => [...prev, ...newItems])
      toast.success(`${newItems.length} fichier${newItems.length > 1 ? 's' : ''} ajouté${newItems.length > 1 ? 's' : ''}`)
    } catch (err) {
      console.error(err)
      toast.error("Impossible de lire l'un des fichiers")
    } finally {
      setBusy(false)
    }
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id))
    setReasons((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setItems((prev) => {
      const from = prev.findIndex((i) => i.id === active.id)
      const to = prev.findIndex((i) => i.id === over.id)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    // L'ordre proposé n'est plus fidèle une fois ajusté à la main
    setReasons(new Map())
    setMethod(null)
  }

  async function runAnalysis() {
    if (items.length < 2) {
      toast.error('Ajoutez au moins deux fichiers pour proposer un ordre')
      return
    }
    cancelRef.current = false
    setRunning(true)
    setAnalysis(null)
    setReasons(new Map())
    setMethod(null)
    if (config.useLlm && canRunLlm(config.llmModel)) {
      setMergeVerifier(createLlmVerifier(config.llmModel))
      onLlmLoadProgress((p) => setLlmLoad(p.progress >= 1 ? null : p))
      setLlmLog([])
      onLlmActivity((line) => {
        const stamp = new Date().toLocaleTimeString('fr-FR')
        setLlmLog((prev) => [...prev.slice(-40), `${stamp}  ${line}`])
      })
    } else {
      setMergeVerifier(null)
      if (config.useLlm) {
        toast.error('Ce modèle exige un GPU (WebGPU) : vérification IA ignorée — choisissez SmolVLM (CPU)')
      }
    }
    try {
      const analyzed = await analyzeItems(items, config, setProgress, () => cancelRef.current)
      if (cancelRef.current) return
      setAnalysis(analyzed)
      const result = await proposeOrder(items, analyzed, config, setProgress)
      const orderedItems = result.order
        .map((id) => items.find((it) => it.id === id))
        .filter((it): it is MergeItem => !!it)
      setItems(orderedItems)
      setReasons(result.reasons)
      setMethod(result.method)
      if (result.llm?.failed) {
        toast.error(`Vérification IA interrompue : ${result.llm.failed}`)
      } else if (result.llm) {
        toast.info(
          `IA : ${result.llm.examined} jointure${result.llm.examined > 1 ? 's' : ''} examinée${result.llm.examined > 1 ? 's' : ''} — ` +
          `${result.llm.confirmed} confirmée${result.llm.confirmed > 1 ? 's' : ''}, ${result.llm.flagged} signalée${result.llm.flagged > 1 ? 's' : ''}`
        )
      }
      toast.success(`Ordre proposé : ${METHOD_LABEL[result.method]}`)
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

  async function handleExport() {
    if (items.length === 0) return
    setExporting(true)
    try {
      const bytes = await buildMergedPdf(items)
      downloadBytes(bytes, 'fusion-intelligente.pdf')
      toast.success('PDF fusionné exporté !')
    } catch (err) {
      console.error(err)
      toast.error('Échec de la fusion')
    } finally {
      setExporting(false)
    }
  }

  if (items.length === 0) {
    return (
      <div className="max-w-xl mx-auto mt-6 sm:mt-16">
        <FileDropzone
          accept="application/pdf,image/png,image/jpeg"
          multiple
          onFiles={(files) => void handleFiles(files)}
          className="bg-base-100 shadow-xl py-16"
          title="Déposez des PDF et des images ici"
          description="L'app propose un ordre de fusion (numéros de page, chaînage visuel), à ajuster avant export"
          footer={
            <span className="text-xs text-base-content/50 flex items-center gap-1">
              {busy && <span className="loading loading-spinner loading-xs" />}
              Comment ça marche ? <SmartMergeHelp />
            </span>
          }
        />
      </div>
    )
  }

  const totalPages = items.reduce((n, i) => n + i.pageCount, 0)

  return (
    <div className="flex flex-col gap-3">
      {/* Barre d'actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn btn-sm btn-soft rounded-full gap-1"
          onClick={() => addInputRef.current?.click()}
        >
          <IconPlus /> Ajouter des fichiers
        </button>
        <span className="text-sm text-base-content/60">
          {items.length} fichier{items.length > 1 ? 's' : ''} · {totalPages} page{totalPages > 1 ? 's' : ''}
        </span>
        <SmartMergeHelp />
        {busy && <span className="loading loading-spinner loading-xs" />}
        {method && !running && (
          <span className="text-sm text-base-content/60">— ordre : {METHOD_LABEL[method]}</span>
        )}
        <div className="ml-auto flex gap-2">
          <button
            className="btn btn-sm btn-ghost rounded-full"
            onClick={() => {
              if (window.confirm('Vider la liste de fusion ?')) {
                cancelRef.current = true
                setItems([])
                setAnalysis(null)
                setReasons(new Map())
                setMethod(null)
              }
            }}
          >
            <IconX /> Vider
          </button>
          <button
            className="btn btn-sm btn-soft rounded-full gap-1.5"
            onClick={() => void runAnalysis()}
            disabled={running || items.length < 2}
          >
            {running ? <span className="loading loading-spinner loading-xs" /> : <IconPlay />}
            Analyser l'ordre
          </button>
          <button
            className="btn btn-sm btn-primary rounded-full shadow-md gap-1.5"
            onClick={() => void handleExport()}
            disabled={exporting || items.length === 0}
          >
            {exporting ? <span className="loading loading-spinner loading-xs" /> : <IconDownload />}
            Fusionner
          </button>
        </div>
      </div>

      <input
        ref={addInputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : []
          void handleFiles(files)
          e.target.value = ''
        }}
      />

      {/* Explication du fonctionnement, tant qu'aucune analyse n'a tourné */}
      {!method && !running && (
        <div className="alert alert-soft text-sm">
          <span>
            💡 Cliquez sur <strong>Analyser l'ordre</strong> : chaque fichier est lu (OCR) pour
            repérer un numéro de page, ou à défaut chaîné visuellement au suivant. Glissez
            ensuite les cartes pour ajuster l'ordre avant d'exporter.
          </span>
        </div>
      )}

      {/* Réglages avancés : les défauts conviennent à la plupart des cas */}
      <div className="collapse collapse-arrow bg-base-100 border border-base-300/50 shadow-sm">
        <input type="checkbox" />
        <div className="collapse-title text-sm font-medium py-2 min-h-0">
          🛠️ Réglages avancés
          <span className="text-base-content/50 font-normal"> — motifs de numérotation, chaînage</span>
        </div>
        <div className="collapse-content flex flex-col gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              role="switch"
              className="toggle toggle-sm toggle-primary"
              checked={config.usePageNumbers}
              onChange={(e) => updateConfig({ usePageNumbers: e.target.checked })}
            />
            Numéros de page (regex à 2 groupes : numéro, total — une par ligne)
          </label>
          {config.usePageNumbers && (
            <textarea
              className="textarea textarea-sm font-mono w-full max-w-md"
              rows={2}
              value={config.patterns.join('\n')}
              onChange={(e) => updateConfig({ patterns: e.target.value.split('\n') })}
              placeholder={'Page\\s*(\\d+)\\s*\\/\\s*(\\d+)'}
            />
          )}
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                role="switch"
                className="toggle toggle-sm toggle-primary"
                checked={config.useVisualChaining}
                onChange={(e) => updateConfig({ useVisualChaining: e.target.checked })}
              />
              Chaînage visuel (si aucun numéro exploitable)
            </label>
            {config.useVisualChaining && (
              <label className="flex items-center gap-2">
                Seuil de confiance
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
              🧩 Vérification des jointures par IA locale
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
          {config.useLlm && (
            <p className="text-xs text-base-content/50">
              Le modèle tourne entièrement dans votre navigateur. Il compare la fin d'un fichier et
              le début du suivant pour chaque jointure proposée, et n'affiche qu'un badge indicatif
              — il ne modifie jamais l'ordre lui-même.
            </p>
          )}
        </div>
      </div>

      {/* Chargement du modèle IA (premier usage) */}
      {llmLoad && (
        <LlmLoadCard
          load={llmLoad}
          footnote="Avec la vérification IA, l'analyse prend plus de temps : chaque jointure proposée est soumise au modèle."
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
                  {progress.phase === 'render' && 'Rendu des fichiers…'}
                  {progress.phase === 'ocr' && 'OCR en cours…'}
                  {progress.phase === 'verify' && 'Vérification des jointures par IA…'}
                </p>
                <p className="text-xs text-base-content/50 font-mono tabular-nums">
                  {progress.phase === 'verify'
                    ? `Jointure ${progress.index}/${progress.total} — durée selon le modèle et la machine`
                    : `Fichier ${progress.index + 1} / ${progress.total}`}
                  {llmLog.length > 0 && !showLog && '  ·  🖥️ survolez pour voir l’activité'}
                </p>
              </div>
              <span className="font-mono text-lg font-semibold tabular-nums">
                {Math.round(((progress.index + progress.pct) / Math.max(1, progress.total)) * 100)}%
              </span>
            </div>
            <progress
              className="progress progress-primary w-full h-1.5"
              value={(progress.index + progress.pct) * 100}
              max={progress.total * 100}
              aria-label="Progression de l'analyse"
            />
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

      <p className="text-xs text-base-content/50">
        Glissez les cartes pour ajuster l'ordre final du document fusionné.
      </p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {items.map((item, i) => (
              <SortableFileCard
                key={item.id}
                item={item}
                index={i}
                reasons={reasons.get(item.id) ?? []}
                analyzed={analysis?.get(item.id)}
                onRemove={removeItem}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function SortableFileCard({
  item, index, reasons, analyzed, onRemove,
}: {
  item: MergeItem
  index: number
  reasons: string[]
  analyzed?: ItemAnalysis
  onRemove: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
      {...attributes}
      {...listeners}
      className={`card card-border bg-base-100 cursor-grab active:cursor-grabbing select-none touch-none ${
        isDragging ? 'shadow-xl' : ''
      }`}
    >
      <div className="card-body p-2 items-center gap-1.5">
        <div className="relative">
          <ItemThumb item={item} analyzed={analyzed} />
          <span className="badge badge-neutral badge-sm absolute top-1 left-1">{index + 1}</span>
        </div>
        <span className="text-xs font-medium truncate max-w-[130px]" title={item.name}>
          {item.name}
        </span>
        <div className="flex items-center gap-1">
          <span className="badge badge-ghost badge-xs gap-1">
            {item.kind === 'image' ? <IconImage /> : null}
            {item.pageCount} p.
          </span>
          <button
            className="btn btn-ghost btn-xs text-error"
            title="Retirer de la fusion"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(item.id)
            }}
          >
            <IconX />
          </button>
        </div>
        {reasons.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1">
            {reasons.map((r, i) => (
              <span
                key={i}
                className={`badge badge-xs ${r.includes('rupture possible') ? 'badge-warning' : 'badge-soft badge-primary'}`}
                title={r}
              >
                {r.length > 26 ? `${r.slice(0, 24)}…` : r}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
