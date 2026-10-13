/**
 * Catalogue des modèles d'IA locale et fonctions sans dépendance lourde :
 * partagé par le moteur réel (llm.ts) et par sa version désactivée
 * (llm.disabled.ts), qui ne charge aucun runtime.
 */

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

export function modelInfo(modelId: string): LlmModelInfo | undefined {
  return LLM_MODELS.find((m) => m.id === modelId)
}

export function runtimeOf(modelId: string): LlmRuntime {
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

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}
