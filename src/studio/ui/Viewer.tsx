import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStudio } from '../store'
import { displaySize } from '../types'
import { PageCanvas } from './PageCanvas'

/**
 * Lecteur : toutes les pages en défilement continu. Seules les pages proches
 * de la zone visible sont réellement rendues (fond + couche Konva), les autres
 * sont de simples emplacements dimensionnés.
 */

const PAD = 28
const GAP = 34
/** 100 % = taille réelle à l'écran (1 pt = 1/72 de pouce, 96 px CSS par pouce). */
export const PT_TO_PX = 96 / 72
const OVERSCAN = 900

export function Viewer() {
  const pages = useStudio((s) => s.pages)
  const zoom = useStudio((s) => s.zoom)
  const tool = useStudio((s) => s.tool)
  const scrollRequest = useStudio((s) => s.scrollRequest)
  const setCurrentPage = useStudio((s) => s.setCurrentPage)
  const setZoom = useStudio((s) => s.setZoom)

  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 800, height: 600 })
  const [scrollTop, setScrollTop] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    setBox({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const sizes = useMemo(() => pages.map(displaySize), [pages])
  const maxW = Math.max(1, ...sizes.map((s) => s.width))
  const maxH = Math.max(1, ...sizes.map((s) => s.height))

  const scale = useMemo(() => {
    const fitW = (box.width - PAD * 2) / maxW
    if (zoom === 'fit-width') return Math.max(0.1, Math.min(fitW, 4 * PT_TO_PX))
    if (zoom === 'fit-page') return Math.max(0.1, Math.min(fitW, (box.height - PAD * 2) / maxH))
    return zoom * PT_TO_PX
  }, [zoom, box, maxW, maxH])

  useEffect(() => {
    useStudio.setState({ viewScale: scale })
  }, [scale])

  // Positions verticales de chaque page
  const tops = useMemo(() => {
    const t: number[] = []
    let y = PAD
    for (const s of sizes) {
      t.push(y)
      y += s.height * scale + GAP
    }
    t.push(y - GAP + PAD)
    return t
  }, [sizes, scale])
  const totalHeight = tops[tops.length - 1] ?? 0

  const pageAt = useCallback(
    (y: number) => {
      let i = 0
      while (i < sizes.length - 1 && tops[i + 1] <= y) i++
      return i
    },
    [sizes.length, tops]
  )

  // Conserve la position de lecture quand l'échelle change
  const anchor = useRef<{ index: number; within: number } | null>(null)
  const lastScale = useRef(scale)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || lastScale.current === scale) return
    const a = anchor.current
    if (a && tops[a.index] !== undefined) el.scrollTop = tops[a.index] + a.within * scale - 8
    lastScale.current = scale
  }, [scale, tops])

  function onScroll() {
    const el = ref.current
    if (!el) return
    setScrollTop(el.scrollTop)
    const probe = el.scrollTop + el.clientHeight * 0.3
    const i = pageAt(probe)
    anchor.current = { index: i, within: (el.scrollTop + 8 - tops[i]) / scale }
    if (pages[i]) setCurrentPage(pages[i].id)
  }

  // Demandes de défilement (miniatures, recherche, commentaires…)
  useEffect(() => {
    const el = ref.current
    if (!el || !scrollRequest) return
    const i = pages.findIndex((p) => p.id === scrollRequest.pageId)
    if (i < 0) return
    const y = scrollRequest.y !== undefined
      ? tops[i] + scrollRequest.y * scale - el.clientHeight / 3
      : tops[i] - 12
    const far = Math.abs(el.scrollTop - y) > el.clientHeight * 3
    el.scrollTo({ top: Math.max(0, y), behavior: far ? 'auto' : 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest])

  // Ctrl + molette : zoom
  useEffect(() => {
    const el = ref.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const cur = useStudio.getState().viewScale / PT_TO_PX
      const next = Math.min(4, Math.max(0.25, cur * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
      setZoom(Math.round(next * 100) / 100)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setZoom])

  // Outil main : glisser pour faire défiler (aussi au clic molette)
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  function onMouseDown(e: React.MouseEvent) {
    const el = ref.current
    if (!el) return
    if (tool === 'hand' || e.button === 1) {
      e.preventDefault()
      pan.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
      el.classList.add('is-panning')
    }
  }
  useEffect(() => {
    function move(e: MouseEvent) {
      const el = ref.current
      if (!pan.current || !el) return
      el.scrollLeft = pan.current.left - (e.clientX - pan.current.x)
      el.scrollTop = pan.current.top - (e.clientY - pan.current.y)
    }
    function up() {
      pan.current = null
      ref.current?.classList.remove('is-panning')
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  const viewTop = scrollTop - OVERSCAN
  const viewBottom = scrollTop + box.height + OVERSCAN

  return (
    <div ref={ref} className="studio-viewer" onScroll={onScroll} onMouseDown={onMouseDown}>
      <div className="studio-viewer-track" style={{ height: totalHeight, minWidth: maxW * scale + PAD * 2 }}>
        {pages.map((page, i) => {
          const top = tops[i]
          const h = sizes[i].height * scale
          const visible = top + h >= viewTop && top <= viewBottom
          return (
            <div key={page.id} className="studio-page-slot" style={{ top }}>
              <PageCanvas page={page} scale={scale} visible={visible} index={i} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
