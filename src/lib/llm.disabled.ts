/**
 * Version désactivée du moteur d'IA locale (voir src/lib/features.ts).
 *
 * Substituée à `llm.ts` au build tant que AI_ENABLED vaut false (plugin
 * « localpdf-no-ai » de vite.config.ts) : les runtimes WebLLM /
 * transformers.js et leurs workers ne sont alors pas du tout livrés.
 * Même API, mais aucun modèle ne peut être chargé.
 */

export * from './llmCatalog'
import type { LlmChatMessage, LlmLoadProgress } from './llmCatalog'

const DISABLED = 'IA locale désactivée'

export function onLlmLoadProgress(cb: ((p: LlmLoadProgress) => void) | null) {
  void cb
}

export function onLlmActivity(cb: ((line: string) => void) | null) {
  void cb
}

export function emitLlmActivity(line: string) {
  void line
}

export async function getLlmEngine(modelId: string): Promise<never> {
  void modelId
  throw new Error(DISABLED)
}

export async function askLlmChat(
  modelId: string,
  messages: LlmChatMessage[],
  options: { images?: string[]; maxTokens?: number } = {}
): Promise<string> {
  void modelId
  void messages
  void options
  throw new Error(DISABLED)
}

export async function askLlm(...args: unknown[]): Promise<string> {
  void args
  throw new Error(DISABLED)
}
