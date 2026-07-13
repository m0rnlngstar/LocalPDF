/**
 * Détection des capacités de la machine pour recommander un modèle IA local.
 *
 * Le web n'expose pas la VRAM : on s'appuie sur la présence de WebGPU, sur
 * l'extension shader-f16 (requise par les poids q4f16) et sur des indices
 * grossiers (RAM plafonnée à 8 dans navigator.deviceMemory, nombre de cœurs).
 */

import { LLM_MODELS, isWebGpuAvailable } from './llm'

export interface HardwareProfile {
  webgpu: boolean
  /** Extension shader-f16 (nécessaire aux poids q4f16 de Gemma 3/4). */
  f16: boolean
  /** navigator.deviceMemory — plafonné à 8 par les navigateurs. */
  ramGB: number | null
  cores: number | null
  /** Nom de l'adaptateur GPU si le navigateur l'expose (souvent vide). */
  gpuName: string | null
  /**
   * Indice de VRAM (Go) déduit de maxBufferSize — les navigateurs ne
   * l'exposent pas directement et plafonnent souvent cette limite, donc
   * c'est un plancher, pas une mesure.
   */
  vramHintGB: number | null
}

export async function detectHardware(): Promise<HardwareProfile> {
  const profile: HardwareProfile = {
    webgpu: isWebGpuAvailable(),
    f16: false,
    ramGB: (navigator as { deviceMemory?: number }).deviceMemory ?? null,
    cores: navigator.hardwareConcurrency ?? null,
    gpuName: null,
    vramHintGB: null,
  }
  if (profile.webgpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) {
        profile.f16 = adapter.features.has('shader-f16')
        const info = (adapter as { info?: { description?: string; vendor?: string } }).info
        profile.gpuName = info?.description || info?.vendor || null
        const maxBuf = adapter.limits?.maxBufferSize
        if (maxBuf) profile.vramHintGB = Math.round(maxBuf / 2 ** 30)
      } else {
        profile.webgpu = false
      }
    } catch {
      profile.webgpu = false
    }
  }
  return profile
}

/** Statut d'un modèle sur cette machine, pour teinter le sélecteur. */
export type ModelFit = 'recommended' | 'ok' | 'fallback' | 'unavailable'

/**
 * Classe chaque modèle du catalogue selon le profil détecté.
 * - GPU + f16 : Gemma 4 E2B recommandé ; E4B prend l'étoile si l'indice de
 *   VRAM (maxBufferSize) garantit ≥ 8 Go — sinon il reste « ok », à toi de
 *   savoir si ta carte encaisse ses ~8 Go ;
 * - GPU sans f16 : Gemma 2 2B recommandé (variante f32 disponible),
 *   Gemma 4 marchera mais en repli texte automatique ;
 * - pas de GPU : seul SmolVLM (CPU) est utilisable.
 */
export function classifyModels(p: HardwareProfile): Record<string, ModelFit> {
  const fit: Record<string, ModelFit> = {}
  const bigVram = (p.vramHintGB ?? 0) >= 8
  for (const m of LLM_MODELS) {
    const isCpuModel = m.device === 'wasm'
    if (!p.webgpu) {
      // Sans GPU, SmolVLM est la seule option — « utilisable », pas « recommandé » :
      // comptez plusieurs minutes par frontière et des verdicts peu fiables.
      fit[m.id] = isCpuModel ? 'ok' : 'unavailable'
    } else if (!p.f16) {
      // Sans shader-f16, tous les poids q4f16 basculent en variante f32
      if (isCpuModel) fit[m.id] = 'ok'
      else if (m.id.startsWith('gemma-2-2b')) fit[m.id] = 'recommended'
      else fit[m.id] = 'fallback'
    } else if (m.id.includes('gemma-4-E4B')) {
      fit[m.id] = bigVram ? 'recommended' : 'ok'
    } else {
      fit[m.id] = m.id.includes('gemma-4-E2B') && !bigVram ? 'recommended' : 'ok'
    }
  }
  return fit
}
