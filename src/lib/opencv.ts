/**
 * Chargement paresseux d'OpenCV.js (WebAssembly, ~10 Mo), partagé par le
 * scanner (détection de document) et l'éditeur (netteté, isolement des tickets).
 * Rien n'est chargé tant qu'aucun de ces outils n'est utilisé.
 */

export type OpenCvRuntime = typeof import('@techstark/opencv-js')

interface OpenCvModuleShape {
  default?: unknown
  Mat?: unknown
  onRuntimeInitialized?: () => void
}

let runtimePromise: Promise<OpenCvRuntime> | null = null

function hasOpenCvRuntime(value: unknown): value is OpenCvRuntime {
  return Boolean(value && typeof value === 'object' && 'Mat' in value && 'findContours' in value)
}

async function initializeOpenCv(): Promise<OpenCvRuntime> {
  const imported = await import('@techstark/opencv-js')
  const moduleShape = imported as OpenCvModuleShape
  const candidate = await Promise.resolve(moduleShape.default ?? imported)
  if (hasOpenCvRuntime(candidate)) return candidate

  const pending = candidate as OpenCvModuleShape
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("OpenCV n'a pas pu démarrer")), 20_000)
    const previous = pending.onRuntimeInitialized
    pending.onRuntimeInitialized = () => {
      previous?.()
      window.clearTimeout(timeout)
      if (hasOpenCvRuntime(pending)) resolve(pending)
      else reject(new Error('Runtime OpenCV incomplet'))
    }
  })
}

export function getOpenCvRuntime(): Promise<OpenCvRuntime> {
  runtimePromise ??= initializeOpenCv()
  // Échec (réseau, mémoire) : on autorise une nouvelle tentative
  runtimePromise.catch(() => { runtimePromise = null })
  return runtimePromise
}
