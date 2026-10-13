import { lazy } from 'react'
import type { ModuleId } from '../store/appStore'

// Chaque outil avancé est chargé en lazy : on ne paie tesseract/IA qu'à l'usage.
const moduleImporters: Record<ModuleId, () => Promise<{ default: React.ComponentType }>> = {
  scanner: () => import('./scanner/ScannerModule'),
  docchat: () => import('./docchat/DocChatModule'),
  split: () => import('./split/SplitModule'),
  'smart-split': () => import('./smart-split/SmartSplitModule'),
  'smart-merge': () => import('./smart-merge/SmartMergeModule'),
  facturx: () => import('./facturx/FacturXModule'),
}

export const moduleComponents = Object.fromEntries(
  (Object.keys(moduleImporters) as ModuleId[]).map((id) => [id, lazy(moduleImporters[id])])
) as Record<ModuleId, React.LazyExoticComponent<React.ComponentType>>

const modulePreloads: Partial<Record<ModuleId, Promise<unknown>>> = {}
export function preloadModule(id: ModuleId) {
  return (modulePreloads[id] ??= moduleImporters[id]())
}
