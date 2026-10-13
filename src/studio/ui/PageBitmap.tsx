import { useEffect, useRef } from 'react'
import { usePageBitmap } from './bitmaps'
import type { StudioPage } from '../types'

/**
 * Affiche le rendu (mis en cache) d'une page dans un canvas propre au
 * composant : un même rendu peut ainsi servir à la miniature et au lecteur.
 */
export function PageBitmap({
  page, docs, scale, enabled = true, className = '',
}: {
  page: StudioPage
  docs: Record<string, ArrayBuffer>
  /** Pixels physiques par point PDF. */
  scale: number
  enabled?: boolean
  className?: string
}) {
  const source = usePageBitmap(page, docs, scale, enabled)
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !source) return
    el.width = source.width
    el.height = source.height
    el.getContext('2d')!.drawImage(source, 0, 0)
  }, [source])

  return (
    <>
      <canvas ref={ref} className={`studio-bitmap ${className}`} />
      {!source && <span className="studio-bitmap-loading loading loading-spinner loading-sm" />}
    </>
  )
}
