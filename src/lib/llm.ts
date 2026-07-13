/**
 * LLM local dans le navigateur (WebGPU), deux runtimes derrière une même API :
 *
 * - WebLLM (MLC) pour Gemma 2/3 — son catalogue s'arrête à Gemma 3 1B ;
 * - transformers.js (ONNX Runtime) pour Gemma 4, que WebLLM ne connaît pas.
 *
 * Utilisé par le Splitteur intelligent pour vérifier les coupures proposées.
 * L'inférence est 100% locale ; seul le téléchargement du modèle (au premier
 * usage, ensuite mis en cache par le navigateur) passe par le CDN (MLC ou
 * Hugging Face) — aucun contenu du document n'est jamais envoyé nulle part.
 *
 * Les runtimes sont importés en lazy (code-splitting) et vivent dans des Web
 * Workers : rien n'est chargé tant que la vérification IA n'est pas activée.
 */

import type { WebWorkerMLCEngine } from '@mlc-ai/web-llm'

export type LlmRuntime = 'webllm' | 'transformers'

export interface LlmModelInfo {
  id: string
  label: string
  runtime: LlmRuntime
  /** Taille approximative des poids en Mo (téléchargement au premier usage). */
  sizeMB?: number
  /** runtime 'transformers' uniquement : où tourne le modèle. */
  device?: 'webgpu' | 'wasm'
  dtype?: string
  /** Famille d'API du processeur (signatures différentes). */
  family?: 'gemma4' | 'generic'
  /**
   * Modèle trop petit pour qu'on lui laisse contredire les heuristiques :
   * ses verdicts « même document » sont ignorés (il ne retire jamais une
   * coupure, il peut seulement en suggérer).
   */
  lowTrust?: boolean
}

export const LLM_MODELS: LlmModelInfo[] = [
  {
    id: 'HuggingFaceTB/SmolVLM-256M-Instruct',
    label: 'SmolVLM 256M (~260 Mo — CPU sans GPU : très très lent, verdicts peu fiables)',
    runtime: 'transformers',
    sizeMB: 260,
    device: 'wasm',
    dtype: 'q8',
    family: 'generic',
    lowTrust: true,
  },
  { id: 'gemma3-1b-it-q4f16_1-MLC', label: 'Gemma 3 1B (texte seul, ~700 Mo)', runtime: 'webllm' },
  { id: 'gemma-2-2b-it-q4f16_1-MLC', label: 'Gemma 2 2B (texte seul, ~1,9 Go)', runtime: 'webllm' },
  {
    id: 'onnx-community/gemma-4-E2B-it-ONNX',
    label: 'Gemma 4 E2B (multimodal, ~3,4 Go, ≈5 Go de VRAM)',
    runtime: 'transformers',
    sizeMB: 3400,
    device: 'webgpu',
    dtype: 'q4f16',
    family: 'gemma4',
  },
  {
    id: 'onnx-community/gemma-4-E4B-it-ONNX',
    label: 'Gemma 4 E4B (multimodal, plus précis mais lourd, ~5,2 Go, ≈8 Go de VRAM)',
    runtime: 'transformers',
    sizeMB: 5200,
    device: 'webgpu',
    dtype: 'q4f16',
    family: 'gemma4',
  },
]

function modelInfo(modelId: string): LlmModelInfo | undefined {
  return LLM_MODELS.find((m) => m.id === modelId)
}

function runtimeOf(modelId: string): LlmRuntime {
  return modelInfo(modelId)?.runtime ?? 'webllm'
}

/** Les modèles du runtime transformers (Gemma 4, SmolVLM) acceptent des images. */
export function isMultimodalLlm(modelId: string): boolean {
  return runtimeOf(modelId) === 'transformers'
}

/** Un modèle CPU (wasm) tourne partout ; les autres exigent WebGPU. */
export function canRunLlm(modelId: string): boolean {
  return modelInfo(modelId)?.device === 'wasm' || isWebGpuAvailable()
}

/** Vrai si le modèle ne doit pas pouvoir retirer une coupure heuristique. */
export function isLowTrustLlm(modelId: string): boolean {
  return modelInfo(modelId)?.lowTrust === true
}

export interface LlmLoadProgress {
  /** 0..1 (téléchargement + compilation des shaders). */
  progress: number
  text: string
  /** Étape en cours, déduite du texte de progression de WebLLM. */
  phase: 'download' | 'cache' | 'gpu'
  /** Mo téléchargés (ou lus depuis le cache), si présents dans le texte. */
  fetchedMB: number | null
  /** Vitesse de téléchargement en Mo/s (fenêtre glissante), null hors téléchargement. */
  speedMBps: number | null
  /** Estimation du temps restant en secondes. */
  etaSec: number | null
  /** Début du chargement (epoch ms) — permet un chrono côté UI. */
  startedAt: number
}

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

let enginePromise: Promise<WebWorkerMLCEngine> | null = null
let engineWorker: Worker | null = null
let engineModel: string | null = null
let loadProgressCb: ((p: LlmLoadProgress) => void) | null = null
let loadStartedAt = 0
let speedSamples: { t: number; mb: number }[] = []

/** Abonne l'UI à la progression du chargement du modèle en cours. */
export function onLlmLoadProgress(cb: ((p: LlmLoadProgress) => void) | null) {
  loadProgressCb = cb
}

// Journal d'activité de la passe IA (une ligne par événement), pour la
// mini-console de l'UI. Émis par le vérificateur (hooks.ts).
let activityCb: ((line: string) => void) | null = null

export function onLlmActivity(cb: ((line: string) => void) | null) {
  activityCb = cb
}

export function emitLlmActivity(line: string) {
  activityCb?.(line)
}

/**
 * Enrichit le rapport brut de WebLLM (progress + texte libre) : le nombre de
 * Mo téléchargés est parsé depuis le texte (« 1234MB fetched »), la vitesse
 * est lissée sur une fenêtre glissante de 8 s.
 */
function enrichProgress(p: { progress: number; text: string }): LlmLoadProgress {
  const now = Date.now()
  const phase: LlmLoadProgress['phase'] = /shader|gpu/i.test(p.text)
    ? 'gpu'
    : /from cache/i.test(p.text)
      ? 'cache'
      : 'download'
  const mbMatch = p.text.match(/([\d.]+)\s*MB\s+(?:fetched|loaded)/i)
  const fetchedMB = mbMatch ? Number(mbMatch[1]) : null
  let speedMBps: number | null = null
  if (phase === 'download' && fetchedMB !== null) {
    speedSamples.push({ t: now, mb: fetchedMB })
    speedSamples = speedSamples.filter((s) => now - s.t < 8000)
    const first = speedSamples[0]
    if (now - first.t > 500 && fetchedMB > first.mb) {
      speedMBps = ((fetchedMB - first.mb) / (now - first.t)) * 1000
    }
  }
  const elapsedSec = (now - loadStartedAt) / 1000
  const etaSec =
    p.progress > 0.02 && p.progress < 1 && elapsedSec > 3
      ? (elapsedSec * (1 - p.progress)) / p.progress
      : null
  return {
    progress: p.progress,
    text: p.text,
    phase,
    fetchedMB,
    speedMBps,
    etaSec,
    startedAt: loadStartedAt,
  }
}

/**
 * Charge (ou réutilise) le moteur pour le modèle demandé. L'inférence tourne
 * dans un Web Worker : le thread principal (UI) n'est jamais bloqué.
 */
function releaseWebLlm() {
  if (!enginePromise) return
  const old = enginePromise
  const oldWorker = engineWorker
  enginePromise = null
  engineWorker = null
  engineModel = null
  void old
    .then((e) => e.unload())
    .catch(() => {})
    .finally(() => oldWorker?.terminate())
}

export async function getLlmEngine(modelId: string): Promise<WebWorkerMLCEngine> {
  if (enginePromise && engineModel === modelId) return enginePromise
  // Changement de modèle : on libère l'autre moteur (VRAM) et son worker
  releaseWebLlm()
  releaseTf()
  engineModel = modelId
  enginePromise = (async () => {
    if (!isWebGpuAvailable()) {
      throw new Error('WebGPU indisponible dans ce navigateur')
    }
    // Les variantes q4f16 exigent l'extension WebGPU shader-f16 ; certains
    // GPU/navigateurs ne l'ont pas → bascule sur une variante f32 équivalente.
    let effectiveModel = modelId
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) throw new Error('Aucun adaptateur WebGPU disponible')
    if (!adapter.features.has('shader-f16') && /q4f16/.test(modelId)) {
      effectiveModel =
        modelId === 'gemma3-1b-it-q4f16_1-MLC'
          ? 'gemma-2-2b-it-q4f32_1-MLC' // pas de variante f32 pour Gemma 3 1B
          : modelId.replace('q4f16_1', 'q4f32_1')
      console.info(`LLM : shader-f16 absent, bascule sur ${effectiveModel}`)
    }
    const { CreateWebWorkerMLCEngine, prebuiltAppConfig } = await import('@mlc-ai/web-llm')
    if (!prebuiltAppConfig.model_list.some((m) => m.model_id === effectiveModel)) {
      throw new Error(`Modèle inconnu de WebLLM : ${effectiveModel}`)
    }
    engineWorker = new Worker(new URL('../workers/llm.worker.ts', import.meta.url), {
      type: 'module',
    })
    loadStartedAt = Date.now()
    speedSamples = []
    return CreateWebWorkerMLCEngine(engineWorker, effectiveModel, {
      initProgressCallback: (p) => loadProgressCb?.(enrichProgress(p)),
    })
  })()
  enginePromise.catch(() => {
    // Échec de chargement : ne pas garder une promesse rejetée en cache
    enginePromise = null
    engineModel = null
    engineWorker?.terminate()
    engineWorker = null
  })
  return enginePromise
}

// ---------- Runtime transformers.js (Gemma 4, absent du catalogue WebLLM) ----------

type TfOutMsg =
  | { type: 'progress'; loadedMB: number; totalMB: number }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string }

let tfPromise: Promise<Worker> | null = null
let tfWorker: Worker | null = null
let tfModel: string | null = null
let tfAskId = 0
const tfPending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>()

function releaseTf() {
  tfWorker?.terminate()
  tfWorker = null
  tfPromise = null
  tfModel = null
  for (const p of tfPending.values()) p.reject(new Error('Moteur LLM déchargé'))
  tfPending.clear()
}

/**
 * Progression transformers.js : on reçoit les octets réels (reçus / total),
 * donc vitesse et temps restant exacts — pas d'extrapolation.
 */
function emitTfProgress(loadedMB: number, totalMB: number) {
  const now = Date.now()
  speedSamples.push({ t: now, mb: loadedMB })
  speedSamples = speedSamples.filter((s) => now - s.t < 8000)
  const first = speedSamples[0]
  let speedMBps: number | null = null
  if (now - first.t > 500 && loadedMB > first.mb) {
    speedMBps = ((loadedMB - first.mb) / (now - first.t)) * 1000
  }
  // La compilation des shaders suit le téléchargement (sans progression) :
  // on plafonne à 95 % et on passe en phase « gpu » une fois les octets reçus.
  const done = loadedMB >= totalMB - 0.5
  loadProgressCb?.({
    progress: Math.min((loadedMB / totalMB) * 0.95, 0.95),
    text: '',
    phase: done ? 'gpu' : 'download',
    fetchedMB: loadedMB,
    speedMBps: done ? null : speedMBps,
    etaSec: !done && speedMBps ? (totalMB - loadedMB) / speedMBps : null,
    startedAt: loadStartedAt,
  })
}

function getTfWorker(modelId: string): Promise<Worker> {
  if (tfPromise && tfModel === modelId) return tfPromise
  // Changement de modèle : on libère l'autre moteur (VRAM) et son worker
  releaseTf()
  releaseWebLlm()
  tfModel = modelId
  loadStartedAt = Date.now()
  speedSamples = []
  tfPromise = new Promise<Worker>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/vlm.worker.ts', import.meta.url), {
      type: 'module',
    })
    tfWorker = worker
    worker.onmessage = (e: MessageEvent<TfOutMsg>) => {
      const m = e.data
      if (m.type === 'progress') {
        emitTfProgress(m.loadedMB, m.totalMB)
      } else if (m.type === 'ready') {
        loadProgressCb?.({
          progress: 1, text: '', phase: 'gpu',
          fetchedMB: null, speedMBps: null, etaSec: null,
          startedAt: loadStartedAt,
        })
        resolve(worker)
      } else if (m.type === 'result') {
        tfPending.get(m.id)?.resolve(m.text)
        tfPending.delete(m.id)
      } else if (m.type === 'error') {
        if (m.id !== undefined) {
          tfPending.get(m.id)?.reject(new Error(m.message))
          tfPending.delete(m.id)
          // Moteur irrécupérable : périphérique GPU perdu (TDR Windows,
          // réinitialisation pilote…) ou piège mémoire wasm (« unaligned
          // accesses », bug onnxruntime-web) — on jette le worker pour que la
          // prochaine question recharge le modèle proprement (depuis le cache).
          if (/Instance reference|device lost|Device is lost|unaligned accesses/i.test(m.message)) {
            releaseTf()
          }
        } else {
          reject(new Error(m.message))
        }
      }
    }
    worker.onerror = (e) => reject(new Error(e.message))
    const info = modelInfo(modelId)
    worker.postMessage({
      type: 'load',
      modelId,
      dtype: info?.dtype ?? 'q4f16',
      device: info?.device ?? 'webgpu',
      family: info?.family ?? 'generic',
      // Plancher du total : évite que la barre recule quand les gros fichiers
      // de poids rejoignent l'agrégat en cours de téléchargement.
      expectedMB: info?.sizeMB ?? 0,
    })
  })
  tfPromise.catch(() => releaseTf())
  return tfPromise
}

async function askTf(
  modelId: string,
  messages: LlmChatMessage[],
  images: string[],
  maxTokens: number
): Promise<string> {
  const worker = await getTfWorker(modelId)
  const id = ++tfAskId
  return new Promise<string>((resolve, reject) => {
    tfPending.set(id, { resolve, reject })
    worker.postMessage({ type: 'ask', id, messages, images, maxTokens })
  })
}

// ---------- API commune ----------

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

async function askWebLlm(
  modelId: string,
  messages: LlmChatMessage[],
  maxTokens: number
): Promise<string> {
  const engine = await getLlmEngine(modelId)
  const res = await engine.chat.completions.create({
    messages,
    temperature: 0,
    max_tokens: maxTokens,
  })
  return res.choices[0]?.message?.content?.trim() ?? ''
}

/**
 * Conversation avec le modèle (génération déterministe). Le runtime est choisi
 * selon le modèle (WebLLM pour Gemma 2/3, transformers.js pour Gemma 4 et les
 * modèles CPU). `images` (data URLs) n'est pris en compte que par les modèles
 * multimodaux, sur le dernier message utilisateur.
 */
export async function askLlmChat(
  modelId: string,
  messages: LlmChatMessage[],
  { images = [], maxTokens = 512 }: { images?: string[]; maxTokens?: number } = {}
): Promise<string> {
  const info = modelInfo(modelId)
  if (info?.runtime === 'transformers') {
    // Les modèles CPU (wasm) tournent partout, sans GPU
    if (info.device === 'wasm') return askTf(modelId, messages, images, maxTokens)
    // Les poids Gemma 4 sont en q4f16 uniquement : sans l'extension
    // shader-f16, repli sur la variante WebLLM f32 la plus proche.
    const adapter = isWebGpuAvailable() ? await navigator.gpu.requestAdapter() : null
    if (!adapter) throw new Error('Aucun adaptateur WebGPU disponible')
    if (!adapter.features.has('shader-f16')) {
      console.info('LLM : shader-f16 absent, bascule sur gemma-2-2b-it-q4f32_1-MLC')
      return askWebLlm('gemma-2-2b-it-q4f32_1-MLC', messages, maxTokens)
    }
    return askTf(modelId, messages, images, maxTokens)
  }
  return askWebLlm(modelId, messages, maxTokens)
}

/**
 * Pose une question fermée au modèle ; retourne la réponse brute (courte,
 * 8 tokens). Utilisé par le vérificateur de coupures du Splitteur intelligent.
 */
export async function askLlm(
  modelId: string,
  system: string,
  user: string,
  images: string[] = []
): Promise<string> {
  return askLlmChat(
    modelId,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { images, maxTokens: 8 }
  )
}
