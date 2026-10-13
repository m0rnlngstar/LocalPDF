import { useEffect, useState } from 'react'
import { renderPage } from '../render'
import { totalRotation, type StudioPage } from '../types'

/**
 * Cache LRU des rendus de pages (fond sans annotations). La clé dépend de la
 * source, de la rotation et d'une échelle arrondie : zoomer réutilise un
 * rendu proche tant que la netteté reste suffisante.
 */

const MAX_ENTRIES = 48
const cache = new Map<string, Promise<HTMLCanvasElement>>()

function sourceKey(page: StudioPage): string {
  const s = page.source
  if (s.kind === 'pdf') return `pdf:${s.docId}:${s.pageIndex}`
  if (s.kind === 'image') return `img:${page.id}`
  return `blank:${s.width}x${s.height}:${s.background ?? ''}`
}

/** Arrondit l'échelle vers le haut par paliers (moins de re-rendus en zoomant). */
function bucket(scale: number): number {
  const steps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]
  return steps.find((s) => s >= scale) ?? 4
}

export function getPageBitmap(page: StudioPage, docs: Record<string, ArrayBuffer>, scale: number) {
  const b = bucket(scale)
  const key = `${sourceKey(page)}|${totalRotation(page)}|${b}`
  let p = cache.get(key)
  if (p) {
    // Rafraîchit la position LRU
    cache.delete(key)
    cache.set(key, p)
    return p
  }
  p = renderPage(page, docs, b)
  p.catch(() => cache.delete(key))
  cache.set(key, p)
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  return p
}

/** Rendu d'une page à l'échelle demandée (pixels écran par point PDF × dpr). */
export function usePageBitmap(page: StudioPage, docs: Record<string, ArrayBuffer>, scale: number, enabled = true) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const key = `${sourceKey(page)}|${totalRotation(page)}|${bucket(scale)}`
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    getPageBitmap(page, docs, scale)
      .then((c) => {
        if (!cancelled) setCanvas(c)
      })
      .catch((err) => console.error(err))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  return canvas
}
