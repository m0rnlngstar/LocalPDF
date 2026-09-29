import { lazy } from 'react'
import type { ModuleId } from '../store/appStore'

// Chaque module est chargé en lazy : on ne paie pdf.js/tesseract qu'à l'usage.
const moduleImporters: Record<ModuleId, () => Promise<{ default: React.ComponentType }>> = {
  home: () => import('./home/Dashboard'),
  scanner: () => import('./scanner/ScannerModule'),
  docchat: () => import('./docchat/DocChatModule'),
  create: () => import('./create/CreateModule'),
  convert: () => import('./convert/ConvertModule'),
  edit: () => import('./edit/EditModule'),
  merge: () => import('./merge/MergeModule'),
  split: () => import('./split/SplitModule'),
  compress: () => import('./compress/CompressModule'),
  'smart-split': () => import('./smart-split/SmartSplitModule'),
  'smart-merge': () => import('./smart-merge/SmartMergeModule'),
  ocr: () => import('./ocr/OcrModule'),
  facturx: () => import('./facturx/FacturXModule'),
}

export const moduleComponents = Object.fromEntries(
  (Object.keys(moduleImporters) as ModuleId[]).map((id) => [id, lazy(moduleImporters[id])])
) as Record<ModuleId, React.LazyExoticComponent<React.ComponentType>>

// Résout le chunk d'un module avant de basculer dessus : AnimatePresence ne
// supporte pas qu'un enfant suspende pendant sa transition (le montage du
// nouvel enfant reste alors bloqué indéfiniment, page blanche à l'appui) —
// on s'assure donc que l'import est déjà résolu avant de changer activeModule.
const modulePreloads: Partial<Record<ModuleId, Promise<unknown>>> = {}
export function preloadModule(id: ModuleId) {
  return (modulePreloads[id] ??= moduleImporters[id]())
}
