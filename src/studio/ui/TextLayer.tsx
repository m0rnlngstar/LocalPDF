import { memo, useEffect, useState } from 'react'
import { getPageTextItems, type TextItemBox } from '../render'
import { totalRotation, type StudioPage } from '../types'

/**
 * Couche de texte sélectionnable (texte natif du PDF ou texte OCR), posée en
 * transparent sur le rendu de la page : on peut sélectionner et copier le
 * texte, et voir immédiatement si une page scannée a été reconnue.
 */

export type TextKind = 'native' | 'ocr' | 'none'

export interface PageTextInfo {
  items: TextItemBox[]
  kind: TextKind
}

/** Texte de la page et son origine (natif, OCR ou aucun). */
export function usePageText(page: StudioPage, docs: Record<string, ArrayBuffer>, enabled: boolean): PageTextInfo | null {
  const [info, setInfo] = useState<PageTextInfo | null>(null)
  const rotation = totalRotation(page)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    getPageTextItems({ ...page, ocr: undefined }, docs)
      .then((native) => {
        if (cancelled) return
        if (native.length) setInfo({ items: native, kind: 'native' })
        else if (page.ocr?.words.length) setInfo({ items: page.ocr.words, kind: 'ocr' })
        else setInfo({ items: [], kind: 'none' })
      })
      .catch(() => !cancelled && setInfo({ items: [], kind: 'none' }))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, page.ocr, rotation, enabled])
  return info
}

let measureCtx: CanvasRenderingContext2D | null = null
function measure(text: string, fontPx: number): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return 0
  measureCtx.font = `${fontPx}px sans-serif`
  return measureCtx.measureText(text).width
}

/**
 * Modes : `text` (outil Sélectionner du texte : zones teintées), `select`
 * (outil flèche : texte sélectionnable sans teinte), `off` (autres outils).
 */
export const TextLayer = memo(function TextLayer({
  items, scale, mode, onBackgroundDown,
}: {
  items: TextItemBox[]
  scale: number
  mode: 'off' | 'select' | 'text'
  onBackgroundDown?: () => void
}) {
  return (
    <div
      className={`studio-textlayer is-${mode}`}
      aria-hidden={mode === 'off'}
      onMouseDown={() => {
        if (mode !== 'off') onBackgroundDown?.()
      }}
    >
      {items.map((it, i) => {
        const vertical = it.height > it.width * 1.5 && it.text.trim().length > 1
        const fontPx = (vertical ? it.width : it.height) * scale
        const length = (vertical ? it.height : it.width) * scale
        const natural = measure(it.text, fontPx)
        const sx = natural > 0 ? length / natural : 1
        const next = items[i + 1]
        // Retour à la ligne quand l'élément suivant n'est pas sur la même ligne (copier-coller propre)
        const newLine = !next || Math.abs(next.y + next.height / 2 - (it.y + it.height / 2)) > Math.min(it.height, next.height) * 0.5
        return (
          <span key={i}>
            <span
              className="studio-textlayer-item"
              style={{
                left: (vertical ? it.x + it.width : it.x) * scale,
                top: it.y * scale,
                fontSize: fontPx,
                transform: `${vertical ? 'rotate(90deg) ' : ''}scaleX(${sx})`,
              }}
            >
              {newLine ? it.text : `${it.text} `}
            </span>
            {newLine && <br />}
          </span>
        )
      })}
    </div>
  )
})
