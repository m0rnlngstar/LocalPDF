import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { takeHandoff } from '../../studio/handoff'
import { openProtected, PasswordRequiredError } from '../../studio/passwords'
import type { PdfJsDocument } from '../../lib/pdfjs'
import { downloadBytes } from '../../lib/pdfExport'
import { extractTable, findSuspectCells, parseCell, toTsv, type TableGrid } from '../../lib/tableExtract'
import { buildXlsx, type XlsxCell, type XlsxSheet } from '../../lib/xlsxWriter'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { toast } from '../../components/ui/Toast'
import {
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDownload,
  IconPlus,
  IconTrash,
  IconX,
} from '../../components/ui/icons'
import { ocrPageText, readPageText, type PageText } from './pageText'

/**
 * Extraction de tableaux vers Excel : on trace un cadre autour du tableau (et
 * seulement du tableau), les colonnes sont détectées à partir de la couche
 * texte du PDF et restent corrigibles à la main avant l'export.
 */

/** Zone tracée ; coordonnées en fraction de la page (0..1). */
interface Zone {
  id: string
  /** Zones issues d'une même répétition sur plusieurs pages. */
  group: string
  page: number
  x: number
  y: number
  width: number
  height: number
  /** Séparations de colonnes imposées (fraction de la largeur de page) ; null = automatique. */
  separators: number[] | null
}

type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw'

interface Interaction {
  kind: 'create' | 'move' | 'resize' | 'separator'
  zoneId: string
  startClientX: number
  startClientY: number
  startZone: Zone
  handle?: ResizeHandle
  separatorIndex?: number
}

type Sensitivity = 'wide' | 'normal' | 'fine'

/** Écart minimal entre deux colonnes, en fraction de la hauteur des caractères. */
const GAP_EM: Record<Sensitivity, number> = { wide: 1, normal: 0.5, fine: 0.35 }

const MIN_ZONE_SIZE = 0.02
const MIN_SEPARATOR_GAP = 0.004
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PREVIEW_ROWS = 300

interface LoadedDoc {
  name: string
  pdf: PdfJsDocument
  pageCount: number
}

interface Options {
  sensitivity: Sensitivity
  convert: boolean
  mergeContinuations: boolean
  singleSheet: boolean
  dropRepeatedHeaders: boolean
  highlight: boolean
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value))
}

function zoneGrid(zone: Zone, text: PageText, options: Options): TableGrid {
  return extractTable(
    text.words,
    {
      x0: zone.x * text.width,
      y0: zone.y * text.height,
      x1: (zone.x + zone.width) * text.width,
      y1: (zone.y + zone.height) * text.height,
    },
    {
      separators: zone.separators ? zone.separators.map((s) => s * text.width) : null,
      gapEm: GAP_EM[options.sensitivity],
      mergeContinuations: options.mergeContinuations,
      tightBoxes: text.source === 'ocr',
    }
  )
}

function columnLetter(index: number): string {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  }
  return name
}

/** Cellules Excel typées (nombres, dates) ; les cellules douteuses sont surlignées. */
function toSheetRows(rows: string[][], options: Options): XlsxCell[][] {
  const flags = findSuspectCells(rows)
  return rows.map((row, r) =>
    row.map((cell, c): XlsxCell => {
      const text = cell.trim()
      if (!text) return null
      if (!options.convert) return text
      const value = parseCell(text)
      if (value.kind === 'number') {
        return { v: value.value, s: value.percent ? 'percent' : value.decimals === 2 ? 'amount' : 'general' }
      }
      if (value.kind === 'date') return { v: value.serial, s: 'date' }
      return options.highlight && flags[r][c] ? { v: text, s: 'warn' } : text
    })
  )
}

export default function TableExtractModule() {
  const [doc, setDoc] = useState<LoadedDoc | null>(null)
  const [busy, setBusy] = useState(false)
  const [thumbs, setThumbs] = useState<string[]>([])
  const [pageIndex, setPageIndex] = useState(0)
  const [pagePreview, setPagePreview] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [zones, setZones] = useState<Zone[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [texts, setTexts] = useState<Record<number, PageText>>({})
  const [ocr, setOcr] = useState<{ page: number; progress: number } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [options, setOptions] = useState<Options>({
    sensitivity: 'normal',
    convert: true,
    mergeContinuations: false,
    singleSheet: true,
    dropRepeatedHeaders: true,
    highlight: true,
  })

  const pageCanvasRef = useRef<HTMLDivElement>(null)
  const interactionRef = useRef<Interaction | null>(null)
  const zonesRef = useRef(zones)
  const textsRef = useRef(texts)
  const docRef = useRef<LoadedDoc | null>(null)
  /** Séparations affichées de la zone sélectionnée (fractions de page). */
  const separatorsRef = useRef<number[]>([])
  // pdf.js : les opérations sur un même document sont sérialisées (rendus
  // concurrents = glyphes perdus).
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queueRef.current.then(task, task)
    queueRef.current = run.catch(() => {})
    return run
  }, [])

  const commitZones = useCallback((next: Zone[]) => {
    zonesRef.current = next
    setZones(next)
  }, [])

  const storeText = useCallback((page: number, text: PageText) => {
    textsRef.current = { ...textsRef.current, [page]: text }
    setTexts(textsRef.current)
  }, [])

  // Document transmis par l'éditeur
  useEffect(() => {
    const files = takeHandoff('table-extract')
    if (files?.length) void handleFiles(files)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => void docRef.current?.pdf.loadingTask.destroy(), [])

  async function handleFiles(files: File[]) {
    const file = files[0]
    if (!file) return
    setBusy(true)
    try {
      const bytes = await file.arrayBuffer()
      const { doc: pdf } = await openProtected(bytes, file.name)
      void docRef.current?.pdf.loadingTask.destroy()
      const loaded: LoadedDoc = { name: file.name.replace(/\.pdf$/i, ''), pdf, pageCount: pdf.numPages }
      docRef.current = loaded
      textsRef.current = {}
      setTexts({})
      commitZones([])
      setSelectedId(null)
      setPageIndex(0)
      setThumbs([])
      setDoc(loaded)
      void renderThumbs(loaded)
    } catch (err) {
      if (!(err instanceof PasswordRequiredError)) {
        console.error(err)
        toast.error('Impossible de lire ce PDF')
      }
    } finally {
      setBusy(false)
    }
  }

  /** Miniatures rendues une à une ; abandonnées si le document change. */
  async function renderThumbs(loaded: LoadedDoc) {
    const list: string[] = []
    for (let i = 1; i <= loaded.pageCount; i++) {
      if (docRef.current !== loaded) return
      try {
        const url = await enqueue(async () => {
          const page = await loaded.pdf.getPage(i)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: 110 / base.width })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
          return canvas.toDataURL('image/jpeg', 0.7)
        })
        list.push(url)
      } catch {
        list.push('')
      }
      if (docRef.current === loaded) setThumbs([...list])
    }
  }

  function closeDocument() {
    void docRef.current?.pdf.loadingTask.destroy()
    docRef.current = null
    setDoc(null)
    commitZones([])
    setSelectedId(null)
  }

  // Aperçu de la page courante
  useEffect(() => {
    if (!doc) return
    let active = true
    let objectUrl: string | null = null
    setPreviewLoading(true)
    setPagePreview(null)
    void enqueue(async () => {
      if (!active) return null
      const page = await doc.pdf.getPage(pageIndex + 1)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(2.35, Math.max(1.35, 1500 / Math.max(base.width, base.height)))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
      return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    })
      .then((blob) => {
        if (!active || !blob) return
        objectUrl = URL.createObjectURL(blob)
        setPagePreview(objectUrl)
      })
      .catch((error) => {
        console.error(error)
        if (active) toast.error("Impossible d'afficher cette page")
      })
      .finally(() => {
        if (active) setPreviewLoading(false)
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [doc, pageIndex, enqueue])

  /** Couche texte d'une page, lue une seule fois. */
  const ensureText = useCallback(
    async (page: number): Promise<PageText | null> => {
      const loaded = docRef.current
      if (!loaded) return null
      if (textsRef.current[page]) return textsRef.current[page]
      const text = await enqueue(() => readPageText(loaded.pdf, page))
      if (docRef.current !== loaded) return null
      if (!textsRef.current[page]) storeText(page, text)
      return textsRef.current[page]
    },
    [enqueue, storeText]
  )

  useEffect(() => {
    if (!doc) return
    ensureText(pageIndex).catch((error) => {
      console.error(error)
      toast.error('Impossible de lire le texte de cette page')
    })
  }, [doc, pageIndex, ensureText])

  const pageText = texts[pageIndex]
  const currentZones = useMemo(() => zones.filter((zone) => zone.page === pageIndex), [zones, pageIndex])
  const selectedZone = zones.find((zone) => zone.id === selectedId) ?? null
  const selectedText = selectedZone ? texts[selectedZone.page] : undefined

  const selectedGrid = useMemo(
    () => (selectedZone && selectedText ? zoneGrid(selectedZone, selectedText, options) : null),
    [selectedZone, selectedText, options]
  )
  const selectedFlags = useMemo(() => (selectedGrid ? findSuspectCells(selectedGrid.rows) : []), [selectedGrid])
  const suspectCount = useMemo(() => selectedFlags.flat().filter(Boolean).length, [selectedFlags])

  const selectedSeparators = useMemo(
    () => (selectedGrid && selectedText ? selectedGrid.separators.map((s) => s / selectedText.width) : []),
    [selectedGrid, selectedText]
  )
  useEffect(() => {
    separatorsRef.current = selectedSeparators
  }, [selectedSeparators])

  /** Mots repris dans la zone sélectionnée, affichés en surimpression. */
  const capturedWords = useMemo(() => {
    if (!selectedZone || !pageText || selectedZone.page !== pageIndex) return []
    const { x, y, width, height } = selectedZone
    const inside = pageText.words.filter((w) => {
      const cx = (w.x0 + w.x1) / 2 / pageText.width
      const cy = (w.y0 + w.y1) / 2 / pageText.height
      return cx >= x && cx <= x + width && cy >= y && cy <= y + height
    })
    return inside.length > 2500 ? [] : inside
  }, [selectedZone, pageText, pageIndex])

  // ───────────── Interactions à la souris ─────────────

  useEffect(() => {
    function update(zoneId: string, change: (zone: Zone) => Zone) {
      commitZones(zonesRef.current.map((zone) => (zone.id === zoneId ? change(zone) : zone)))
    }

    function onPointerMove(event: PointerEvent) {
      const interaction = interactionRef.current
      const element = pageCanvasRef.current
      if (!interaction || !element) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const toX = (clientX: number) => clamp((clientX - rect.left) / Math.max(1, rect.width))
      const toY = (clientY: number) => clamp((clientY - rect.top) / Math.max(1, rect.height))
      const dx = (event.clientX - interaction.startClientX) / Math.max(1, rect.width)
      const dy = (event.clientY - interaction.startClientY) / Math.max(1, rect.height)
      const start = interaction.startZone

      if (interaction.kind === 'create') {
        const x0 = toX(interaction.startClientX)
        const y0 = toY(interaction.startClientY)
        const x1 = toX(event.clientX)
        const y1 = toY(event.clientY)
        update(interaction.zoneId, (zone) => ({
          ...zone,
          x: Math.min(x0, x1),
          y: Math.min(y0, y1),
          width: Math.abs(x1 - x0),
          height: Math.abs(y1 - y0),
        }))
        return
      }

      if (interaction.kind === 'move') {
        const x = clamp(start.x + dx, 0, 1 - start.width)
        const y = clamp(start.y + dy, 0, 1 - start.height)
        update(interaction.zoneId, (zone) => ({
          ...zone,
          x,
          y,
          // Les séparations imposées suivent le cadre
          separators: start.separators ? start.separators.map((s) => s + (x - start.x)) : null,
        }))
        return
      }

      if (interaction.kind === 'separator') {
        const list = start.separators ?? []
        const index = interaction.separatorIndex ?? 0
        const lower = (index > 0 ? list[index - 1] : start.x) + MIN_SEPARATOR_GAP
        const upper = (index < list.length - 1 ? list[index + 1] : start.x + start.width) - MIN_SEPARATOR_GAP
        const value = clamp(list[index] + dx, lower, Math.max(lower, upper))
        update(interaction.zoneId, (zone) => ({
          ...zone,
          separators: list.map((s, i) => (i === index ? value : s)),
        }))
        return
      }

      let left = start.x
      let top = start.y
      let right = start.x + start.width
      let bottom = start.y + start.height
      if (interaction.handle?.includes('w')) left = clamp(start.x + dx, 0, right - MIN_ZONE_SIZE)
      if (interaction.handle?.includes('e')) right = clamp(right + dx, left + MIN_ZONE_SIZE, 1)
      if (interaction.handle?.includes('n')) top = clamp(start.y + dy, 0, bottom - MIN_ZONE_SIZE)
      if (interaction.handle?.includes('s')) bottom = clamp(bottom + dy, top + MIN_ZONE_SIZE, 1)
      update(interaction.zoneId, (zone) => ({ ...zone, x: left, y: top, width: right - left, height: bottom - top }))
    }

    function onPointerUp() {
      const interaction = interactionRef.current
      if (!interaction) return
      interactionRef.current = null
      document.body.classList.remove('split-zone-dragging')
      if (interaction.kind !== 'create') return
      const created = zonesRef.current.find((zone) => zone.id === interaction.zoneId)
      if (created && (created.width < MIN_ZONE_SIZE || created.height < MIN_ZONE_SIZE)) {
        commitZones(zonesRef.current.filter((zone) => zone.id !== interaction.zoneId))
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
  }, [commitZones])

  function startInteraction(event: ReactPointerEvent, interaction: Omit<Interaction, 'startClientX' | 'startClientY'>) {
    interactionRef.current = { ...interaction, startClientX: event.clientX, startClientY: event.clientY }
    document.body.classList.add('split-zone-dragging')
  }

  function beginCreate(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const id = crypto.randomUUID()
    const zone: Zone = {
      id,
      group: id,
      page: pageIndex,
      x: clamp((event.clientX - rect.left) / Math.max(1, rect.width)),
      y: clamp((event.clientY - rect.top) / Math.max(1, rect.height)),
      width: 0,
      height: 0,
      separators: null,
    }
    commitZones([...zonesRef.current, zone])
    setSelectedId(id)
    startInteraction(event, { kind: 'create', zoneId: id, startZone: zone })
  }

  function beginMove(event: ReactPointerEvent, zone: Zone) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    setSelectedId(zone.id)
    startInteraction(event, { kind: 'move', zoneId: zone.id, startZone: { ...zone } })
  }

  function beginResize(event: ReactPointerEvent, zone: Zone, handle: ResizeHandle) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    setSelectedId(zone.id)
    startInteraction(event, { kind: 'resize', zoneId: zone.id, handle, startZone: { ...zone } })
  }

  /** Déplacer une séparation fige les colonnes de la zone (elles ne sont plus recalculées). */
  function beginSeparator(event: ReactPointerEvent, zone: Zone, index: number) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const frozen = { ...zone, separators: [...separatorsRef.current] }
    startInteraction(event, { kind: 'separator', zoneId: zone.id, separatorIndex: index, startZone: frozen })
  }

  function setSeparators(zoneId: string, separators: number[] | null) {
    commitZones(zonesRef.current.map((zone) => (zone.id === zoneId ? { ...zone, separators } : zone)))
  }

  function addSeparator(event: ReactMouseEvent, zone: Zone) {
    const element = pageCanvasRef.current
    if (!element || zone.id !== selectedId) return
    const rect = element.getBoundingClientRect()
    const x = (event.clientX - rect.left) / Math.max(1, rect.width)
    if (x <= zone.x + MIN_SEPARATOR_GAP || x >= zone.x + zone.width - MIN_SEPARATOR_GAP) return
    if (separatorsRef.current.some((s) => Math.abs(s - x) < MIN_SEPARATOR_GAP)) return
    setSeparators(zone.id, [...separatorsRef.current, x].sort((a, b) => a - b))
  }

  function removeSeparator(event: ReactMouseEvent, zone: Zone, index: number) {
    event.stopPropagation()
    setSeparators(zone.id, separatorsRef.current.filter((_, i) => i !== index))
  }

  function addFullPageZone() {
    const id = crypto.randomUUID()
    const zone: Zone = { id, group: id, page: pageIndex, x: 0.03, y: 0.03, width: 0.94, height: 0.94, separators: null }
    commitZones([...zonesRef.current, zone])
    setSelectedId(id)
  }

  const deleteZone = useCallback(
    (zoneId: string) => {
      commitZones(zonesRef.current.filter((zone) => zone.id !== zoneId))
      setSelectedId((current) => (current === zoneId ? null : current))
    },
    [commitZones]
  )

  // Suppr : retire la zone sélectionnée
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Delete' || !selectedId) return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      deleteZone(selectedId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, deleteZone])

  /**
   * Même cadre et mêmes colonnes sur toutes les pages suivantes (relevé ou
   * grand livre sur plusieurs pages). Les colonnes sont figées pour que toutes
   * les pages s'empilent dans les mêmes colonnes Excel.
   */
  function repeatOnNextPages() {
    if (!doc || !selectedZone || !selectedGrid) return
    const frozen = selectedZone.separators ?? [...separatorsRef.current]
    const kept = zonesRef.current
      .filter((zone) => !(zone.group === selectedZone.group && zone.page > selectedZone.page))
      .map((zone) => (zone.id === selectedZone.id ? { ...zone, separators: frozen } : zone))
    const copies: Zone[] = []
    for (let page = selectedZone.page + 1; page < doc.pageCount; page++) {
      copies.push({ ...selectedZone, id: crypto.randomUUID(), page, separators: [...frozen] })
    }
    commitZones([...kept, ...copies])
    toast.success(`Zone répétée sur ${copies.length} page${copies.length > 1 ? 's' : ''} — vérifiez la dernière`)
  }

  async function runOcr(page: number) {
    const loaded = docRef.current
    if (!loaded || ocr) return
    setOcr({ page, progress: 0 })
    try {
      const text = await enqueue(() => ocrPageText(loaded.pdf, page, (progress) => setOcr({ page, progress })))
      if (docRef.current !== loaded) return
      storeText(page, text)
      if (!text.words.length) toast.error('L’OCR n’a trouvé aucun texte sur cette page')
    } catch (error) {
      console.error(error)
      toast.error('Échec de l’OCR')
    } finally {
      setOcr(null)
    }
  }

  async function restorePdfText(page: number) {
    const loaded = docRef.current
    if (!loaded) return
    try {
      const text = await enqueue(() => readPageText(loaded.pdf, page))
      if (docRef.current === loaded) storeText(page, text)
    } catch (error) {
      console.error(error)
      toast.error('Impossible de lire le texte de cette page')
    }
  }

  // ───────────── Export ─────────────

  /** Grilles de toutes les zones, dans l'ordre de lecture (page, puis haut → bas). */
  async function collectTables() {
    const ordered = [...zonesRef.current].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
    const tables: { zone: Zone; rows: string[][] }[] = []
    const emptyPages = new Set<number>()
    for (const zone of ordered) {
      const text = await ensureText(zone.page)
      if (!text) continue
      const grid = zoneGrid(zone, text, options)
      if (grid.rows.length) tables.push({ zone, rows: grid.rows })
      else emptyPages.add(zone.page + 1)
    }
    return { tables, emptyPages: [...emptyPages] }
  }

  /** Toutes les zones à la suite ; l'en-tête répété d'une page à l'autre est retiré. */
  function stackRows(tables: { rows: string[][] }[]): string[][] {
    const header = tables[0]?.rows[0]?.join('\u0001')
    const stacked: string[][] = []
    tables.forEach((table, index) => {
      const skip = options.dropRepeatedHeaders && index > 0 && table.rows[0]?.join('\u0001') === header
      stacked.push(...(skip ? table.rows.slice(1) : table.rows))
    })
    const columns = Math.max(0, ...stacked.map((row) => row.length))
    return stacked.map((row) => (row.length < columns ? [...row, ...Array<string>(columns - row.length).fill('')] : row))
  }

  function warnEmpty(emptyPages: number[]) {
    if (!emptyPages.length) return
    toast.info(
      `Aucun texte dans la zone de la page ${emptyPages.join(', ')} : lancez l’OCR sur ${emptyPages.length > 1 ? 'ces pages' : 'cette page'}.`
    )
  }

  async function handleExport() {
    if (!doc || !zones.length || exporting) return
    setExporting(true)
    try {
      const { tables, emptyPages } = await collectTables()
      if (!tables.length) {
        toast.error('Aucun texte dans les zones tracées — lancez l’OCR sur la page.')
        return
      }
      const sheets: XlsxSheet[] = options.singleSheet
        ? [{ name: 'Tableau', rows: toSheetRows(stackRows(tables), options) }]
        : tables.map((table, index) => ({
            name: `Tableau ${index + 1} (p. ${table.zone.page + 1})`,
            rows: toSheetRows(table.rows, options),
          }))
      downloadBytes(await buildXlsx(sheets), `${doc.name}-tableau.xlsx`, XLSX_MIME)
      toast.success('Fichier Excel exporté')
      warnEmpty(emptyPages)
    } catch (error) {
      console.error(error)
      toast.error("Échec de l'export Excel")
    } finally {
      setExporting(false)
    }
  }

  async function handleCopy() {
    if (!zones.length) return
    try {
      const { tables, emptyPages } = await collectTables()
      if (!tables.length) {
        toast.error('Aucun texte dans les zones tracées — lancez l’OCR sur la page.')
        return
      }
      await navigator.clipboard.writeText(toTsv(stackRows(tables), options.convert))
      toast.success('Tableau copié — collez-le dans Excel')
      warnEmpty(emptyPages)
    } catch (error) {
      console.error(error)
      toast.error('Copie impossible')
    }
  }

  function goToPage(index: number) {
    setPageIndex(index)
    setSelectedId(zonesRef.current.find((zone) => zone.page === index)?.id ?? null)
  }

  function setOption<K extends keyof Options>(key: K, value: Options[K]) {
    setOptions((current) => ({ ...current, [key]: value }))
  }

  if (!doc) {
    return (
      <div className="max-w-xl mx-auto mt-6 sm:mt-16">
        <FileDropzone
          accept="application/pdf"
          onFiles={(files) => void handleFiles(files)}
          className="bg-base-100 shadow-xl py-16"
          title="Déposez le PDF contenant le tableau"
          description="Tracez un cadre autour du tableau : seul son contenu part dans Excel. Rien ne quitte votre navigateur."
          footer={busy && <span className="loading loading-spinner text-primary" />}
        />
      </div>
    )
  }

  const noTextOnPage = !!pageText && pageText.words.length === 0
  const ocrRunning = ocr?.page === pageIndex

  return (
    <div className="split-zone-editor">
      <section className="split-zone-toolbar">
        <div>
          <span className="section-kicker">Extraction vers Excel</span>
          <h2>Tracez un cadre autour du tableau</h2>
          <p>
            Seul le contenu du cadre est repris. Les traits verticaux sont les colonnes détectées : faites-les glisser,
            double-cliquez dans le cadre pour en ajouter un, double-cliquez sur un trait pour le retirer.
          </p>
        </div>
        <div className="split-zone-toolbar-actions">
          <button type="button" className="btn btn-sm btn-ghost" onClick={closeDocument}>
            <IconX /> Fermer
          </button>
          <button type="button" className="btn btn-sm" onClick={addFullPageZone}>
            <IconPlus /> Page entière
          </button>
          <button type="button" className="btn btn-sm btn-soft" onClick={() => void handleCopy()} disabled={!zones.length}>
            <IconCopy /> Copier
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => void handleExport()}
            disabled={!zones.length || exporting}
          >
            {exporting ? <span className="loading loading-spinner loading-xs" /> : <IconDownload />}
            Exporter en Excel
          </button>
        </div>
      </section>

      <div className="split-zone-workspace tx-workspace">
        <aside className="split-zone-pages" aria-label="Pages du document">
          <div className="split-zone-aside-head">
            <strong>Pages</strong>
            <span>{doc.pageCount}</span>
          </div>
          <div className="split-zone-page-list">
            {Array.from({ length: doc.pageCount }, (_, index) => {
              const count = zones.filter((zone) => zone.page === index).length
              return (
                <button
                  type="button"
                  key={index}
                  className={`split-zone-page-thumb ${index === pageIndex ? 'is-active' : ''}`}
                  onClick={() => goToPage(index)}
                >
                  {thumbs[index] ? <img src={thumbs[index]} alt="" /> : <span className="skeleton" />}
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
              onClick={() => goToPage(pageIndex - 1)}
            >
              <IconChevronLeft />
            </button>
            <strong>
              Page {pageIndex + 1} sur {doc.pageCount}
            </strong>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              aria-label="Page suivante"
              disabled={pageIndex === doc.pageCount - 1}
              onClick={() => goToPage(pageIndex + 1)}
            >
              <IconChevronRight />
            </button>
            <span className="split-zone-draw-hint">
              {pageText?.source === 'ocr' ? 'Texte relu par l’OCR intégré · ' : ''}
              Cliquez-glissez pour tracer une zone
            </span>
          </div>

          {noTextOnPage && (
            <div className="tx-banner" role="status">
              <IconAlertTriangle />
              <span>Cette page n’a pas de couche texte (scan non reconnu) : rien ne peut être extrait en l’état.</span>
              <button type="button" className="btn btn-xs btn-primary" disabled={!!ocr} onClick={() => void runOcr(pageIndex)}>
                {ocrRunning ? `OCR… ${Math.round((ocr?.progress ?? 0) * 100)} %` : 'Lancer l’OCR sur cette page'}
              </button>
            </div>
          )}

          <div className="split-zone-stage">
            {previewLoading && <span className="loading loading-spinner loading-lg text-primary" />}
            {pagePreview && (
              <div className="split-zone-page-canvas" ref={pageCanvasRef}>
                <img src={pagePreview} alt={`Page ${pageIndex + 1}`} draggable={false} />
                <div className="split-zone-overlay" onPointerDown={beginCreate}>
                  {pageText &&
                    capturedWords.map((word, index) => (
                      <span
                        key={index}
                        className="tx-word"
                        style={{
                          left: `${(word.x0 / pageText.width) * 100}%`,
                          top: `${(word.y0 / pageText.height) * 100}%`,
                          width: `${((word.x1 - word.x0) / pageText.width) * 100}%`,
                          height: `${((word.y1 - word.y0) / pageText.height) * 100}%`,
                        }}
                      />
                    ))}
                  {currentZones.map((zone) => {
                    const zoneNumber = zones.findIndex((candidate) => candidate.id === zone.id) + 1
                    const selected = selectedId === zone.id
                    return (
                      <div
                        key={zone.id}
                        className={`split-crop-zone tx-zone ${selected ? 'is-selected' : ''}`}
                        style={{
                          left: `${zone.x * 100}%`,
                          top: `${zone.y * 100}%`,
                          width: `${zone.width * 100}%`,
                          height: `${zone.height * 100}%`,
                        }}
                        onPointerDown={(event) => beginMove(event, zone)}
                        onDoubleClick={(event) => addSeparator(event, zone)}
                      >
                        <span className="split-crop-zone-label">Tableau {zoneNumber}</span>
                        {selected &&
                          zone.width > 0 &&
                          selectedSeparators.map((separator, index) => (
                            <span
                              key={index}
                              className={`tx-separator ${zone.separators ? 'is-manual' : ''}`}
                              style={{ left: `${((separator - zone.x) / zone.width) * 100}%` }}
                              title="Glisser pour déplacer · double-clic pour retirer"
                              onPointerDown={(event) => beginSeparator(event, zone, index)}
                              onDoubleClick={(event) => removeSeparator(event, zone, index)}
                            />
                          ))}
                        {(['nw', 'ne', 'se', 'sw'] as ResizeHandle[]).map((handle) => (
                          <button
                            type="button"
                            key={handle}
                            className={`split-crop-handle handle-${handle}`}
                            aria-label={`Redimensionner le tableau ${zoneNumber}`}
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

        <aside className="split-zone-list-panel tx-panel" aria-label="Zones et réglages">
          <div className="split-zone-aside-head">
            <strong>Tableaux</strong>
            <span>{zones.length}</span>
          </div>
          {zones.length === 0 ? (
            <div className="split-zone-empty-list">
              <IconPlus />
              <p>Tracez un cadre autour du tableau à extraire.</p>
            </div>
          ) : (
            <div className="split-zone-list tx-zone-list">
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
                      <strong>Tableau {index + 1}</strong>
                      <small>
                        Page {zone.page + 1} · colonnes {zone.separators ? 'fixées' : 'automatiques'}
                      </small>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="split-zone-delete"
                    aria-label={`Supprimer le tableau ${index + 1}`}
                    onClick={() => deleteZone(zone.id)}
                  >
                    <IconTrash />
                  </button>
                </div>
              ))}
            </div>
          )}

          {selectedZone && (
            <div className="tx-section">
              <strong>Zone sélectionnée</strong>
              <button
                type="button"
                className="btn btn-xs"
                disabled={!selectedZone.separators}
                onClick={() => setSeparators(selectedZone.id, null)}
              >
                Colonnes automatiques
              </button>
              <button
                type="button"
                className="btn btn-xs"
                disabled={!selectedGrid || selectedZone.page >= doc.pageCount - 1}
                title="Même cadre et mêmes colonnes sur toutes les pages suivantes"
                onClick={repeatOnNextPages}
              >
                Répéter sur les pages suivantes
              </button>
            </div>
          )}

          <div className="tx-section">
            <strong>Réglages</strong>
            <label className="tx-field">
              <span>Détection des colonnes</span>
              <select
                className="select select-xs"
                value={options.sensitivity}
                onChange={(event) => setOption('sensitivity', event.target.value as Sensitivity)}
              >
                <option value="wide">Large (colonnes bien espacées)</option>
                <option value="normal">Normale</option>
                <option value="fine">Fine (colonnes serrées)</option>
              </select>
            </label>
            <label className="tx-check">
              <input type="checkbox" className="checkbox checkbox-xs" checked={options.convert}
                onChange={(event) => setOption('convert', event.target.checked)} />
              <span>Convertir montants et dates (1 234,56 → nombre)</span>
            </label>
            <label className="tx-check">
              <input type="checkbox" className="checkbox checkbox-xs" checked={options.highlight}
                disabled={!options.convert}
                onChange={(event) => setOption('highlight', event.target.checked)} />
              <span>Surligner dans Excel les cellules à vérifier</span>
            </label>
            <label className="tx-check">
              <input type="checkbox" className="checkbox checkbox-xs" checked={options.mergeContinuations}
                onChange={(event) => setOption('mergeContinuations', event.target.checked)} />
              <span>Rattacher les libellés sur deux lignes</span>
            </label>
            <label className="tx-check">
              <input type="checkbox" className="checkbox checkbox-xs" checked={options.singleSheet}
                onChange={(event) => setOption('singleSheet', event.target.checked)} />
              <span>Toutes les zones dans une seule feuille</span>
            </label>
            <label className="tx-check">
              <input type="checkbox" className="checkbox checkbox-xs" checked={options.dropRepeatedHeaders}
                disabled={!options.singleSheet}
                onChange={(event) => setOption('dropRepeatedHeaders', event.target.checked)} />
              <span>Retirer l’en-tête répété à chaque page</span>
            </label>
          </div>

          {pageText && !noTextOnPage && (
            <div className="tx-section">
              <strong>Texte de la page</strong>
              {pageText.source === 'ocr' ? (
                <button type="button" className="btn btn-xs" onClick={() => void restorePdfText(pageIndex)}>
                  Revenir au texte du PDF
                </button>
              ) : (
                <button type="button" className="btn btn-xs" disabled={!!ocr} onClick={() => void runOcr(pageIndex)}>
                  {ocrRunning ? `OCR… ${Math.round((ocr?.progress ?? 0) * 100)} %` : 'Relire la page par OCR'}
                </button>
              )}
              <small>À utiliser si le texte repris ne correspond pas à l’image (couche texte décalée ou erronée).</small>
            </div>
          )}
        </aside>
      </div>

      <section className="tx-preview" aria-label="Aperçu du tableau">
        <header>
          <strong>Aperçu{selectedZone ? ` — tableau ${zones.findIndex((z) => z.id === selectedZone.id) + 1}` : ''}</strong>
          {selectedGrid && selectedGrid.rows.length > 0 && (
            <span>
              {selectedGrid.rows.length} ligne{selectedGrid.rows.length > 1 ? 's' : ''} × {selectedGrid.separators.length + 1}{' '}
              colonne{selectedGrid.separators.length ? 's' : ''}
            </span>
          )}
          {suspectCount > 0 && options.convert && (
            <span className="tx-suspect-count">
              <IconAlertTriangle /> {suspectCount} cellule{suspectCount > 1 ? 's' : ''} à vérifier
            </span>
          )}
        </header>
        {!selectedZone ? (
          <p className="tx-preview-empty">Sélectionnez ou tracez une zone pour voir le tableau qui sera exporté.</p>
        ) : !selectedGrid ? (
          <p className="tx-preview-empty">Lecture du texte de la page…</p>
        ) : selectedGrid.rows.length === 0 ? (
          <p className="tx-preview-empty">
            Aucun texte dans cette zone.{' '}
            {selectedText?.words.length ? 'Agrandissez le cadre.' : 'La page n’a pas de couche texte : lancez l’OCR.'}
          </p>
        ) : (
          <div className="tx-table-wrap">
            <table>
              <thead>
                <tr>
                  <th />
                  {selectedGrid.rows[0].map((_, c) => (
                    <th key={c}>{columnLetter(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedGrid.rows.slice(0, PREVIEW_ROWS).map((row, r) => (
                  <tr key={r}>
                    <th>{r + 1}</th>
                    {row.map((cell, c) => {
                      const typed = options.convert && parseCell(cell).kind !== 'text'
                      const suspect = options.convert && selectedFlags[r]?.[c]
                      return (
                        <td
                          key={c}
                          className={`${typed ? 'is-typed' : ''} ${suspect ? 'is-suspect' : ''}`}
                          title={suspect ? 'Non reconnu comme un nombre : à vérifier' : undefined}
                        >
                          {cell}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {selectedGrid.rows.length > PREVIEW_ROWS && (
              <p className="tx-preview-empty">
                Aperçu limité aux {PREVIEW_ROWS} premières lignes ; l’export les contient toutes.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
