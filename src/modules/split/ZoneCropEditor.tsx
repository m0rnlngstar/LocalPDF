import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { openPdf } from '../../lib/pdfjs'
import { toast } from '../../components/ui/Toast'
import {
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconGrid,
  IconPlus,
  IconTrash,
} from '../../components/ui/icons'
import { exportCropZones, type CropZone } from './zoneExport'

interface ZoneCropEditorProps {
  name: string
  bytes: ArrayBuffer
  pageCount: number
  thumbs: string[]
  zones: CropZone[]
  onZonesChange: (zones: CropZone[]) => void
}

type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw'

interface PointerInteraction {
  kind: 'create' | 'move' | 'resize'
  zoneId: string
  page: number
  startClientX: number
  startClientY: number
  startZone: CropZone
  handle?: ResizeHandle
}

const MIN_ZONE_SIZE = 0.035

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value))
}

function canvasPoint(element: HTMLDivElement, clientX: number, clientY: number) {
  const rect = element.getBoundingClientRect()
  return {
    x: clamp((clientX - rect.left) / Math.max(1, rect.width)),
    y: clamp((clientY - rect.top) / Math.max(1, rect.height)),
  }
}

function canvasDelta(element: HTMLDivElement, clientX: number, clientY: number, startX: number, startY: number) {
  const rect = element.getBoundingClientRect()
  return {
    x: (clientX - startX) / Math.max(1, rect.width),
    y: (clientY - startY) / Math.max(1, rect.height),
  }
}

export default function ZoneCropEditor({
  name,
  bytes,
  pageCount,
  thumbs,
  zones,
  onZonesChange,
}: ZoneCropEditorProps) {
  const [pageIndex, setPageIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(zones[0]?.id ?? null)
  const [pagePreview, setPagePreview] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const pageCanvasRef = useRef<HTMLDivElement>(null)
  const interactionRef = useRef<PointerInteraction | null>(null)
  const zonesRef = useRef(zones)

  const currentZones = useMemo(
    () => zones.filter((zone) => zone.page === pageIndex),
    [zones, pageIndex]
  )
  const selectedZone = zones.find((zone) => zone.id === selectedId) ?? null

  useEffect(() => {
    zonesRef.current = zones
  }, [zones])

  useEffect(() => {
    if (pageIndex < pageCount) return
    setPageIndex(Math.max(0, pageCount - 1))
  }, [pageCount, pageIndex])

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setPreviewLoading(true)
    setPagePreview(null)

    void (async () => {
      try {
        const pdf = await openPdf(bytes)
        const page = await pdf.getPage(pageIndex + 1)
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(2.35, Math.max(1.35, 1500 / Math.max(base.width, base.height)))
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        if (!active || !blob) return
        objectUrl = URL.createObjectURL(blob)
        setPagePreview(objectUrl)
      } catch (error) {
        console.error(error)
        if (active) toast.error("Impossible d'afficher cette page")
      } finally {
        if (active) setPreviewLoading(false)
      }
    })()

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [bytes, pageIndex])

  useEffect(() => {
    function updateZone(zoneId: string, update: (zone: CropZone) => CropZone) {
      const next = zonesRef.current.map((zone) => zone.id === zoneId ? update(zone) : zone)
      zonesRef.current = next
      onZonesChange(next)
    }

    function onPointerMove(event: PointerEvent) {
      const interaction = interactionRef.current
      const element = pageCanvasRef.current
      if (!interaction || !element) return
      event.preventDefault()

      if (interaction.kind === 'create') {
        const start = canvasPoint(element, interaction.startClientX, interaction.startClientY)
        const current = canvasPoint(element, event.clientX, event.clientY)
        updateZone(interaction.zoneId, (zone) => ({
          ...zone,
          x: Math.min(start.x, current.x),
          y: Math.min(start.y, current.y),
          width: Math.abs(current.x - start.x),
          height: Math.abs(current.y - start.y),
        }))
        return
      }

      const delta = canvasDelta(
        element,
        event.clientX,
        event.clientY,
        interaction.startClientX,
        interaction.startClientY
      )
      const start = interaction.startZone

      if (interaction.kind === 'move') {
        updateZone(interaction.zoneId, (zone) => ({
          ...zone,
          x: clamp(start.x + delta.x, 0, 1 - start.width),
          y: clamp(start.y + delta.y, 0, 1 - start.height),
        }))
        return
      }

      let left = start.x
      let top = start.y
      let right = start.x + start.width
      let bottom = start.y + start.height
      if (interaction.handle?.includes('w')) left = clamp(start.x + delta.x, 0, right - MIN_ZONE_SIZE)
      if (interaction.handle?.includes('e')) right = clamp(start.x + start.width + delta.x, left + MIN_ZONE_SIZE, 1)
      if (interaction.handle?.includes('n')) top = clamp(start.y + delta.y, 0, bottom - MIN_ZONE_SIZE)
      if (interaction.handle?.includes('s')) bottom = clamp(start.y + start.height + delta.y, top + MIN_ZONE_SIZE, 1)
      updateZone(interaction.zoneId, (zone) => ({
        ...zone,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      }))
    }

    function onPointerUp() {
      const interaction = interactionRef.current
      if (!interaction) return
      interactionRef.current = null
      document.body.classList.remove('split-zone-dragging')
      if (interaction.kind !== 'create') return
      const created = zonesRef.current.find((zone) => zone.id === interaction.zoneId)
      if (created && (created.width < MIN_ZONE_SIZE || created.height < MIN_ZONE_SIZE)) {
        const next = zonesRef.current.filter((zone) => zone.id !== interaction.zoneId)
        zonesRef.current = next
        onZonesChange(next)
        setSelectedId(null)
      }
    }

    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      document.body.classList.remove('split-zone-dragging')
    }
  }, [onZonesChange])

  function beginCreate(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    event.preventDefault()
    const point = canvasPoint(event.currentTarget, event.clientX, event.clientY)
    const zone: CropZone = {
      id: crypto.randomUUID(),
      page: pageIndex,
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
    }
    const next = [...zonesRef.current, zone]
    zonesRef.current = next
    onZonesChange(next)
    setSelectedId(zone.id)
    interactionRef.current = {
      kind: 'create',
      zoneId: zone.id,
      page: pageIndex,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startZone: zone,
    }
    document.body.classList.add('split-zone-dragging')
  }

  function beginMove(event: ReactPointerEvent, zone: CropZone) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    setSelectedId(zone.id)
    interactionRef.current = {
      kind: 'move',
      zoneId: zone.id,
      page: zone.page,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startZone: { ...zone },
    }
    document.body.classList.add('split-zone-dragging')
  }

  function beginResize(event: ReactPointerEvent, zone: CropZone, handle: ResizeHandle) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    setSelectedId(zone.id)
    interactionRef.current = {
      kind: 'resize',
      zoneId: zone.id,
      page: zone.page,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startZone: { ...zone },
    }
    document.body.classList.add('split-zone-dragging')
  }

  function addDefaultZone() {
    const offset = (currentZones.length % 4) * 0.035
    const zone: CropZone = {
      id: crypto.randomUUID(),
      page: pageIndex,
      x: 0.14 + offset,
      y: 0.14 + offset,
      width: 0.52,
      height: 0.28,
    }
    const next = [...zonesRef.current, zone]
    zonesRef.current = next
    onZonesChange(next)
    setSelectedId(zone.id)
  }

  function createGrid() {
    const inset = 0.025
    const gap = 0.018
    const cellWidth = (1 - inset * 2 - gap) / 2
    const cellHeight = (1 - inset * 2 - gap) / 2
    const grid = [
      [inset, inset],
      [inset + cellWidth + gap, inset],
      [inset, inset + cellHeight + gap],
      [inset + cellWidth + gap, inset + cellHeight + gap],
    ].map(([x, y]) => ({
      id: crypto.randomUUID(),
      page: pageIndex,
      x,
      y,
      width: cellWidth,
      height: cellHeight,
    }))
    const next = [...zonesRef.current.filter((zone) => zone.page !== pageIndex), ...grid]
    zonesRef.current = next
    onZonesChange(next)
    setSelectedId(grid[0].id)
  }

  function deleteZone(zoneId: string) {
    const next = zonesRef.current.filter((zone) => zone.id !== zoneId)
    zonesRef.current = next
    onZonesChange(next)
    setSelectedId((current) => current === zoneId ? null : current)
  }

  function clearCurrentPage() {
    const next = zonesRef.current.filter((zone) => zone.page !== pageIndex)
    zonesRef.current = next
    onZonesChange(next)
    setSelectedId(null)
  }

  async function handleExport() {
    if (!zones.length || exporting) return
    setExporting(true)
    setProgress({ done: 0, total: zones.length })
    try {
      const ordered = [...zones].sort((a, b) => a.page - b.page)
      await exportCropZones(bytes, ordered, name, (done, total) => setProgress({ done, total }))
      toast.success(zones.length === 1 ? 'Zone exportée en PDF' : `${zones.length} tickets exportés en ZIP`)
    } catch (error) {
      console.error(error)
      toast.error("Impossible d'exporter les zones")
    } finally {
      setExporting(false)
      setProgress(null)
    }
  }

  return (
    <div className="split-zone-editor">
      <section className="split-zone-toolbar">
        <div>
          <span className="section-kicker">Découpage dans la page</span>
          <h2>Isolez chaque ticket avec un cadre</h2>
          <p>Tracez un rectangle sur la feuille, puis ajustez ses coins. Chaque cadre crée un PDF indépendant.</p>
        </div>
        <div className="split-zone-toolbar-actions">
          <button type="button" className="btn btn-sm" onClick={addDefaultZone}>
            <IconPlus /> Ajouter une zone
          </button>
          <button type="button" className="btn btn-sm btn-soft" onClick={createGrid}>
            <IconGrid /> Grille 2 × 2
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => void handleExport()}
            disabled={!zones.length || exporting}
          >
            {exporting ? <span className="loading loading-spinner loading-xs" /> : <IconDownload />}
            {zones.length > 1 ? `Exporter ${zones.length} tickets` : 'Exporter la zone'}
          </button>
        </div>
      </section>

      {progress && (
        <div className="split-zone-progress" role="status">
          <span>Création des PDF · {progress.done}/{progress.total}</span>
          <progress className="progress progress-primary" value={progress.done} max={progress.total} />
        </div>
      )}

      <div className="split-zone-workspace">
        <aside className="split-zone-pages" aria-label="Pages du document">
          <div className="split-zone-aside-head">
            <strong>Pages</strong>
            <span>{pageCount}</span>
          </div>
          <div className="split-zone-page-list">
            {Array.from({ length: pageCount }, (_, index) => {
              const count = zones.filter((zone) => zone.page === index).length
              return (
                <button
                  type="button"
                  key={index}
                  className={`split-zone-page-thumb ${index === pageIndex ? 'is-active' : ''}`}
                  onClick={() => {
                    setPageIndex(index)
                    setSelectedId(zones.find((zone) => zone.page === index)?.id ?? null)
                  }}
                >
                  {thumbs[index]
                    ? <img src={thumbs[index]} alt="" />
                    : <span className="skeleton" />}
                  <span>Page {index + 1}</span>
                  {count > 0 && <strong>{count}</strong>}
                </button>
              )
            })}
          </div>
        </aside>

        <main className="split-zone-main">
          <div className="split-zone-page-navigation">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              aria-label="Page précédente"
              disabled={pageIndex === 0}
              onClick={() => setPageIndex((page) => Math.max(0, page - 1))}
            >
              <IconChevronLeft />
            </button>
            <strong>Page {pageIndex + 1} sur {pageCount}</strong>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              aria-label="Page suivante"
              disabled={pageIndex === pageCount - 1}
              onClick={() => setPageIndex((page) => Math.min(pageCount - 1, page + 1))}
            >
              <IconChevronRight />
            </button>
            <span className="split-zone-draw-hint">Cliquez-glissez pour tracer une zone</span>
          </div>

          <div className="split-zone-stage">
            {previewLoading && <span className="loading loading-spinner loading-lg text-primary" />}
            {pagePreview && (
              <div className="split-zone-page-canvas" ref={pageCanvasRef}>
                <img src={pagePreview} alt={`Page ${pageIndex + 1}`} draggable={false} />
                <div className="split-zone-overlay" onPointerDown={beginCreate}>
                  {currentZones.map((zone) => {
                    const zoneNumber = zones.findIndex((candidate) => candidate.id === zone.id) + 1
                    const selected = selectedId === zone.id
                    return (
                      <div
                        key={zone.id}
                        className={`split-crop-zone ${selected ? 'is-selected' : ''}`}
                        style={{
                          left: `${zone.x * 100}%`,
                          top: `${zone.y * 100}%`,
                          width: `${zone.width * 100}%`,
                          height: `${zone.height * 100}%`,
                        }}
                        onPointerDown={(event) => beginMove(event, zone)}
                      >
                        <span className="split-crop-zone-label">Ticket {zoneNumber}</span>
                        {(['nw', 'ne', 'se', 'sw'] as ResizeHandle[]).map((handle) => (
                          <button
                            type="button"
                            key={handle}
                            className={`split-crop-handle handle-${handle}`}
                            aria-label={`Redimensionner la zone ${zoneNumber}`}
                            onPointerDown={(event) => beginResize(event, zone, handle)}
                          />
                        ))}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </main>

        <aside className="split-zone-list-panel" aria-label="Zones sélectionnées">
          <div className="split-zone-aside-head">
            <strong>Tickets</strong>
            <span>{zones.length}</span>
          </div>
          {zones.length === 0 ? (
            <div className="split-zone-empty-list">
              <IconPlus />
              <p>Tracez votre premier cadre sur le document.</p>
            </div>
          ) : (
            <div className="split-zone-list">
              {zones.map((zone, index) => (
                <div className="split-zone-list-row" key={zone.id}>
                  <button
                    type="button"
                    className={`split-zone-list-item ${selectedId === zone.id ? 'is-active' : ''}`}
                    onClick={() => {
                      setPageIndex(zone.page)
                      setSelectedId(zone.id)
                    }}
                  >
                    <span>{index + 1}</span>
                    <div>
                      <strong>Ticket {index + 1}</strong>
                      <small>Page {zone.page + 1} · {Math.round(zone.width * 100)} × {Math.round(zone.height * 100)} %</small>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="split-zone-delete"
                    aria-label={`Supprimer le ticket ${index + 1}`}
                    onClick={() => deleteZone(zone.id)}
                  >
                    <IconTrash />
                  </button>
                </div>
              ))}
            </div>
          )}
          {currentZones.length > 0 && (
            <button type="button" className="btn btn-sm btn-ghost split-zone-clear" onClick={clearCurrentPage}>
              <IconTrash /> Effacer les zones de cette page
            </button>
          )}
          {selectedZone && (
            <p className="split-zone-selection-note">
              Le cadre violet est sélectionné : faites-le glisser ou utilisez ses quatre poignées.
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}
