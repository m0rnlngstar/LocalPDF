import { useEffect, useMemo, useRef, useState } from 'react'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { getOcrQuality, recognizeCanvas, type OcrWord } from '../../lib/ocr'
import { preprocessForOcr } from '../../lib/preprocess'
import { downloadBytes } from '../create/exportPdf'
import { toast } from '../../components/ui/Toast'
import {
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconPlus,
  IconRotate,
  IconTrash,
  IconUpload,
  IconX,
} from '../../components/ui/icons'
import { blobToCanvas, renderScan, type ScanFilter } from './scannerUtils'

interface ScanOcrResult {
  text: string
  words: OcrWord[]
  width: number
  height: number
}

interface ScanPage {
  id: string
  name: string
  source: Blob
  processed: Blob
  previewUrl: string
  width: number
  height: number
  rotation: number
  filter: ScanFilter
  cropApplied: boolean
  ocr?: ScanOcrResult
}

interface OcrProgress {
  page: number
  total: number
  pct: number
}

const FILTER_KEY = 'scanner-filter'
const CROP_KEY = 'scanner-auto-crop'

const filterLabels: Record<ScanFilter, { label: string; description: string }> = {
  color: { label: 'Couleur', description: 'Photo fidèle et optimisée' },
  gray: { label: 'Niveaux de gris', description: 'Contraste renforcé' },
  document: { label: 'Document', description: 'Noir et blanc haute lisibilité' },
}

function CameraIcon({ large = false }: { large?: boolean }) {
  return (
    <svg
      className={large ? 'scanner-icon-large' : undefined}
      width={large ? 34 : 18}
      height={large ? 34 : 18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14.5 5 13 3h-2L9.5 5H6a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3Z" />
      <circle cx="12" cy="12.5" r="4" />
    </svg>
  )
}

function ScanSparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M5 3v4M3 5h4M18 2l.7 2.3L21 5l-2.3.7L18 8l-.7-2.3L15 5l2.3-.7Z" />
      <path d="M7 10H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2M14 10h5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
      <path d="M8 15h10M8 18h7" />
    </svg>
  )
}

function defaultDocumentName() {
  return `scan-${new Date().toISOString().slice(0, 10)}`
}

function safeFilename(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ') || 'scan'
}

export default function ScannerModule() {
  const [pages, setPages] = useState<ScanPage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [documentName, setDocumentName] = useState(defaultDocumentName)
  const [defaultFilter, setDefaultFilter] = useState<ScanFilter>(() => {
    const stored = localStorage.getItem(FILTER_KEY)
    return stored === 'color' || stored === 'gray' || stored === 'document' ? stored : 'document'
  })
  const [autoCrop, setAutoCrop] = useState(localStorage.getItem(CROP_KEY) !== 'off')
  const [processing, setProcessing] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null)
  const [exporting, setExporting] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const captureInputRef = useRef<HTMLInputElement>(null)
  const objectUrlsRef = useRef(new Set<string>())
  const cameraStreamRef = useRef<MediaStream | null>(null)

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedId) ?? pages[0] ?? null,
    [pages, selectedId]
  )
  const selectedIndex = selectedPage ? pages.findIndex((page) => page.id === selectedPage.id) : -1
  const ocrCount = pages.filter((page) => page.ocr).length

  function createPreviewUrl(blob: Blob) {
    const url = URL.createObjectURL(blob)
    objectUrlsRef.current.add(url)
    return url
  }

  function releasePreviewUrl(url: string) {
    URL.revokeObjectURL(url)
    objectUrlsRef.current.delete(url)
  }

  function stopCamera() {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    cameraStreamRef.current = null
    setCameraStream(null)
    setCameraOpen(false)
    setCameraReady(false)
    setCameraError(null)
  }

  useEffect(() => {
    if (!cameraOpen || !cameraStream || !videoRef.current) return
    const video = videoRef.current
    video.srcObject = cameraStream
    const onReady = () => setCameraReady(true)
    video.addEventListener('loadedmetadata', onReady)
    void video.play().catch(() => {})
    return () => video.removeEventListener('loadedmetadata', onReady)
  }, [cameraOpen, cameraStream])

  useEffect(() => () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    objectUrlsRef.current.clear()
  }, [])

  async function addBlobs(items: { blob: Blob; name: string }[]) {
    const images = items.filter(({ blob }) => blob.type.startsWith('image/'))
    if (!images.length) {
      toast.error('Choisissez une ou plusieurs images')
      return
    }
    setProcessing(true)
    try {
      const added: ScanPage[] = []
      for (const { blob, name } of images) {
        const rendered = await renderScan(blob, {
          rotation: 0,
          filter: defaultFilter,
          autoCrop,
        })
        added.push({
          id: crypto.randomUUID(),
          name,
          source: blob,
          processed: rendered.blob,
          previewUrl: createPreviewUrl(rendered.blob),
          width: rendered.width,
          height: rendered.height,
          rotation: 0,
          filter: defaultFilter,
          cropApplied: rendered.cropApplied,
        })
      }
      setPages((current) => [...current, ...added])
      setSelectedId((current) => current ?? added[0]?.id ?? null)
      toast.success(`${added.length} page${added.length > 1 ? 's' : ''} ajoutée${added.length > 1 ? 's' : ''}`)
    } catch (error) {
      console.error(error)
      toast.error("Impossible de préparer l'image")
    } finally {
      setProcessing(false)
    }
  }

  function addFiles(files: File[]) {
    void addBlobs(files.map((file) => ({ blob: file, name: file.name })))
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      captureInputRef.current?.click()
      return
    }
    setCameraOpen(true)
    setCameraError(null)
    setCameraReady(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 2560 },
          height: { ideal: 1920 },
        },
      })
      cameraStreamRef.current = stream
      setCameraStream(stream)
    } catch (error) {
      console.error(error)
      setCameraError("La caméra n'est pas accessible. Autorisez-la ou utilisez l'import photo.")
    }
  }

  async function captureFrame() {
    const video = videoRef.current
    if (!video || !cameraReady || !video.videoWidth || !video.videoHeight) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95))
    if (!blob) {
      toast.error("La photo n'a pas pu être capturée")
      return
    }
    await addBlobs([{ blob, name: `photo-${pages.length + 1}.jpg` }])
  }

  async function updatePage(
    page: ScanPage,
    changes: Partial<Pick<ScanPage, 'rotation' | 'filter'>>,
    crop = autoCrop
  ) {
    setProcessing(true)
    try {
      const rotation = changes.rotation ?? page.rotation
      const filter = changes.filter ?? page.filter
      const rendered = await renderScan(page.source, { rotation, filter, autoCrop: crop })
      const nextUrl = createPreviewUrl(rendered.blob)
      setPages((current) => current.map((item) => item.id === page.id
        ? {
            ...item,
            rotation,
            filter,
            processed: rendered.blob,
            previewUrl: nextUrl,
            width: rendered.width,
            height: rendered.height,
            cropApplied: rendered.cropApplied,
            ocr: undefined,
          }
        : item))
      releasePreviewUrl(page.previewUrl)
    } catch (error) {
      console.error(error)
      toast.error("Impossible d'appliquer la correction")
    } finally {
      setProcessing(false)
    }
  }

  async function applyCropToAll(enabled: boolean) {
    setAutoCrop(enabled)
    localStorage.setItem(CROP_KEY, enabled ? 'on' : 'off')
    if (!pages.length) return
    setProcessing(true)
    try {
      const updated: ScanPage[] = []
      for (const page of pages) {
        const rendered = await renderScan(page.source, {
          rotation: page.rotation,
          filter: page.filter,
          autoCrop: enabled,
        })
        updated.push({
          ...page,
          processed: rendered.blob,
          previewUrl: createPreviewUrl(rendered.blob),
          width: rendered.width,
          height: rendered.height,
          cropApplied: rendered.cropApplied,
          ocr: undefined,
        })
      }
      pages.forEach((page) => releasePreviewUrl(page.previewUrl))
      setPages(updated)
    } catch (error) {
      console.error(error)
      toast.error('Le recadrage automatique a échoué')
    } finally {
      setProcessing(false)
    }
  }

  function changeFilter(filter: ScanFilter) {
    if (!selectedPage || filter === selectedPage.filter) return
    setDefaultFilter(filter)
    localStorage.setItem(FILTER_KEY, filter)
    void updatePage(selectedPage, { filter })
  }

  function rotateSelected() {
    if (!selectedPage) return
    void updatePage(selectedPage, { rotation: (selectedPage.rotation + 90) % 360 })
  }

  function deleteSelected() {
    if (!selectedPage) return
    const nextPages = pages.filter((page) => page.id !== selectedPage.id)
    releasePreviewUrl(selectedPage.previewUrl)
    setPages(nextPages)
    setSelectedId(nextPages[Math.min(selectedIndex, nextPages.length - 1)]?.id ?? null)
  }

  function moveSelected(direction: -1 | 1) {
    if (selectedIndex < 0) return
    const target = selectedIndex + direction
    if (target < 0 || target >= pages.length) return
    setPages((current) => {
      const next = [...current]
      ;[next[selectedIndex], next[target]] = [next[target], next[selectedIndex]]
      return next
    })
  }

  async function runOcr(force = false): Promise<ScanPage[]> {
    setOcrRunning(true)
    let enriched = [...pages]
    try {
      for (let i = 0; i < enriched.length; i++) {
        const page = enriched[i]
        if (page.ocr && !force) continue
        setOcrProgress({ page: i + 1, total: enriched.length, pct: 0 })
        const canvas = await blobToCanvas(page.processed)
        const ocrCanvas = page.filter === 'document'
          ? canvas
          : preprocessForOcr(canvas, { binarize: true })
        const result = await recognizeCanvas(ocrCanvas, (pct) =>
          setOcrProgress({ page: i + 1, total: enriched.length, pct })
        )
        const updated = {
          ...page,
          ocr: {
            text: result.text,
            words: result.words,
            width: ocrCanvas.width,
            height: ocrCanvas.height,
          },
        }
        enriched = enriched.map((item) => item.id === page.id ? updated : item)
        setPages(enriched)
      }
      toast.success('Reconnaissance OCR terminée')
      return enriched
    } catch (error) {
      console.error(error)
      toast.error("Échec de l'OCR")
      throw error
    } finally {
      setOcrRunning(false)
      setOcrProgress(null)
    }
  }

  async function buildPdf(searchable: boolean) {
    if (!pages.length || exporting || ocrRunning) return
    setExporting(true)
    try {
      const exportPages = searchable && pages.some((page) => !page.ocr)
        ? await runOcr()
        : pages
      const doc = await PDFDocument.create()
      const font = searchable ? await doc.embedFont(StandardFonts.Helvetica) : null

      for (const scan of exportPages) {
        const bytes = await scan.processed.arrayBuffer()
        const image = scan.processed.type === 'image/png'
          ? await doc.embedPng(bytes)
          : await doc.embedJpg(bytes)
        const portrait = scan.height >= scan.width
        const pageWidth = portrait ? 595.28 : 841.89
        const pageHeight = portrait ? 841.89 : 595.28
        const page = doc.addPage([pageWidth, pageHeight])
        const scale = Math.min(pageWidth / scan.width, pageHeight / scan.height)
        const drawWidth = scan.width * scale
        const drawHeight = scan.height * scale
        const offsetX = (pageWidth - drawWidth) / 2
        const offsetY = (pageHeight - drawHeight) / 2
        page.drawImage(image, {
          x: offsetX,
          y: offsetY,
          width: drawWidth,
          height: drawHeight,
        })

        if (searchable && font && scan.ocr) {
          const scaleX = drawWidth / scan.ocr.width
          const scaleY = drawHeight / scan.ocr.height
          for (const word of scan.ocr.words) {
            if (!word.text.trim()) continue
            const fontSize = Math.max(4, (word.y1 - word.y0) * scaleY)
            try {
              page.drawText(word.text, {
                x: offsetX + word.x0 * scaleX,
                y: offsetY + drawHeight - word.y1 * scaleY,
                size: fontSize,
                font,
                color: rgb(0, 0, 0),
                opacity: 0,
              })
            } catch {
              // Helvetica ne couvre pas tous les symboles Unicode produits par
              // l'OCR. Un symbole isolé ne doit pas faire échouer tout le scan.
            }
          }
        }
      }

      const suffix = searchable ? '-ocr.pdf' : '.pdf'
      downloadBytes(await doc.save(), `${safeFilename(documentName)}${suffix}`)
      toast.success(searchable ? 'PDF recherchable créé' : 'PDF scan créé')
    } catch (error) {
      console.error(error)
      toast.error("Impossible de créer le PDF")
    } finally {
      setExporting(false)
    }
  }

  function exportText() {
    const text = pages
      .map((page, index) => `----- Page ${index + 1} -----\n\n${page.ocr?.text.trim() ?? ''}`)
      .join('\n\n')
    downloadBytes(
      new TextEncoder().encode(text),
      `${safeFilename(documentName)}.txt`,
      'text/plain'
    )
  }

  const cameraPanel = cameraOpen && (
    <div className="scanner-camera-backdrop" role="dialog" aria-modal="true" aria-label="Prendre des photos">
      <div className="scanner-camera-panel">
        <div className="scanner-camera-head">
          <div>
            <span className="scanner-camera-kicker">Capture locale</span>
            <h3>Cadrez votre document</h3>
          </div>
          <button className="btn btn-circle btn-ghost" onClick={stopCamera} aria-label="Fermer la caméra">
            <IconX />
          </button>
        </div>
        <div className="scanner-camera-viewport">
          {cameraStream && <video ref={videoRef} playsInline muted />}
          {!cameraStream && !cameraError && <span className="loading loading-spinner loading-lg" />}
          {cameraError && (
            <div className="scanner-camera-error">
              <CameraIcon large />
              <p>{cameraError}</p>
              <button className="btn btn-sm" onClick={() => captureInputRef.current?.click()}>
                Ouvrir l'appareil photo
              </button>
            </div>
          )}
          {cameraReady && <span className="scanner-frame-guide" aria-hidden="true" />}
        </div>
        <div className="scanner-camera-actions">
          <span>{pages.length} page{pages.length > 1 ? 's' : ''}</span>
          <button
            className="scanner-shutter"
            onClick={() => void captureFrame()}
            disabled={!cameraReady || processing}
            aria-label="Prendre la photo"
          ><span /></button>
          <button className="btn btn-sm btn-primary" onClick={stopCamera} disabled={!pages.length}>
            Terminer
          </button>
        </div>
      </div>
    </div>
  )

  const hiddenInputs = (
    <>
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
      <input
        ref={captureInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
    </>
  )

  if (!pages.length) {
    return (
      <div className="scanner-shell scanner-empty-shell">
        {hiddenInputs}
        {cameraPanel}
        <section className="scanner-intro">
          <div className="scanner-intro-copy">
            <span className="section-kicker">Nouveau · 100 % local</span>
            <h2>Transformez vos photos en vrai PDF scanné.</h2>
            <p>
              Photographiez plusieurs pages, améliorez leur lisibilité et créez un PDF
              recherchable. Les images et le texte restent uniquement sur cet appareil.
            </p>
          </div>
          <div className="scanner-start-grid">
            <button className="scanner-start-card scanner-camera-card" onClick={() => void openCamera()}>
              <span className="scanner-start-icon"><CameraIcon large /></span>
              <span className="scanner-start-label">Utiliser la caméra</span>
              <span className="scanner-start-description">Téléphone, tablette ou webcam · mode multipage</span>
              <span className="scanner-start-action">Ouvrir la caméra <IconChevronRight /></span>
            </button>
            <button className="scanner-start-card" onClick={() => galleryInputRef.current?.click()}>
              <span className="scanner-start-icon"><IconUpload /></span>
              <span className="scanner-start-label">Importer des photos</span>
              <span className="scanner-start-description">JPEG, PNG ou WebP · sélection multiple</span>
              <span className="scanner-start-action">Choisir des images <IconChevronRight /></span>
            </button>
          </div>
          <div className="scanner-local-note">
            <span><ScanSparkleIcon /></span>
            <div>
              <strong>Numérisation privée par conception</strong>
              <p>Correction, OCR français/anglais et export PDF s'exécutent dans le navigateur.</p>
            </div>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="scanner-shell">
      {hiddenInputs}
      {cameraPanel}

      <div className="scanner-toolbar">
        <label className="scanner-name-field">
          <span>Nom du document</span>
          <input
            className="input input-sm"
            value={documentName}
            onChange={(event) => setDocumentName(event.target.value)}
          />
        </label>
        <div className="scanner-toolbar-actions">
          <button className="btn btn-sm" onClick={() => galleryInputRef.current?.click()} disabled={processing}>
            <IconPlus /> Photos
          </button>
          <button className="btn btn-sm" onClick={() => void openCamera()} disabled={processing}>
            <CameraIcon /> Caméra
          </button>
          <button
            className="btn btn-sm btn-soft"
            onClick={() => void runOcr(ocrCount === pages.length)}
            disabled={ocrRunning || processing || exporting}
          >
            <ScanSparkleIcon /> {ocrCount === pages.length ? 'Relancer l’OCR' : 'Lancer l’OCR'}
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => void buildPdf(true)}
            disabled={ocrRunning || processing || exporting}
          >
            {exporting || ocrRunning ? <span className="loading loading-spinner loading-xs" /> : <IconDownload />}
            PDF recherchable
          </button>
        </div>
      </div>

      {(processing || ocrProgress) && (
        <div className="scanner-progress" role="status">
          <div>
            <span>{processing ? 'Amélioration de l’image…' : `OCR · page ${ocrProgress?.page} sur ${ocrProgress?.total}`}</span>
            <span>{ocrProgress ? `${Math.round(((ocrProgress.page - 1 + ocrProgress.pct) / ocrProgress.total) * 100)} %` : ''}</span>
          </div>
          <progress
            className="progress progress-primary"
            value={ocrProgress ? ocrProgress.page - 1 + ocrProgress.pct : undefined}
            max={ocrProgress?.total ?? 1}
          />
        </div>
      )}

      <div className="scanner-workspace">
        <aside className="scanner-pages" aria-label="Pages du scan">
          <div className="scanner-pages-head">
            <div><strong>Pages</strong><span>{pages.length}</span></div>
            <button className="btn btn-xs btn-ghost" onClick={() => galleryInputRef.current?.click()} aria-label="Ajouter des pages">
              <IconPlus />
            </button>
          </div>
          <div className="scanner-page-list">
            {pages.map((page, index) => (
              <button
                key={page.id}
                className={`scanner-page-thumb ${page.id === selectedPage?.id ? 'is-selected' : ''}`}
                onClick={() => setSelectedId(page.id)}
                aria-label={`Page ${index + 1}`}
              >
                <span className="scanner-thumb-image"><img src={page.previewUrl} alt="" /></span>
                <span className="scanner-thumb-meta">
                  <strong>Page {index + 1}</strong>
                  <span>{page.ocr ? 'OCR prêt' : filterLabels[page.filter].label}</span>
                </span>
                {page.ocr && <span className="scanner-ocr-check">✓</span>}
              </button>
            ))}
          </div>
        </aside>

        <section className="scanner-preview-panel">
          <div className="scanner-preview-toolbar">
            <div className="scanner-filter-group" aria-label="Rendu du scan">
              {(Object.keys(filterLabels) as ScanFilter[]).map((filter) => (
                <button
                  key={filter}
                  className={selectedPage?.filter === filter ? 'is-active' : ''}
                  onClick={() => changeFilter(filter)}
                  disabled={processing}
                  title={filterLabels[filter].description}
                >
                  {filterLabels[filter].label}
                </button>
              ))}
            </div>
            <div className="scanner-page-actions">
              <label className="scanner-crop-toggle" title="Détecte les marges autour de la feuille">
                <input
                  type="checkbox"
                  className="toggle toggle-sm toggle-primary"
                  checked={autoCrop}
                  onChange={(event) => void applyCropToAll(event.target.checked)}
                  disabled={processing}
                />
                Recadrage auto
              </label>
              <button className="btn btn-sm btn-ghost" onClick={() => moveSelected(-1)} disabled={selectedIndex <= 0} aria-label="Déplacer vers la gauche">
                <IconChevronLeft />
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => moveSelected(1)} disabled={selectedIndex >= pages.length - 1} aria-label="Déplacer vers la droite">
                <IconChevronRight />
              </button>
              <button className="btn btn-sm btn-ghost" onClick={rotateSelected} disabled={processing}>
                <IconRotate /> Rotation
              </button>
              <button className="btn btn-sm btn-ghost scanner-delete" onClick={deleteSelected}>
                <IconTrash />
              </button>
            </div>
          </div>

          <div className="scanner-preview-stage">
            {selectedPage && (
              <div className="scanner-paper-wrap">
                <img src={selectedPage.previewUrl} alt={`Aperçu de la page ${selectedIndex + 1}`} />
                <span className="scanner-page-number">{selectedIndex + 1}</span>
                {selectedPage.cropApplied && <span className="scanner-crop-badge">Recadrée</span>}
              </div>
            )}
          </div>

          {selectedPage?.ocr && (
            <div className="scanner-ocr-result">
              <div>
                <strong>Texte reconnu</strong>
                <span>{selectedPage.ocr.words.length} mots détectés</span>
              </div>
              <textarea
                className="textarea"
                rows={5}
                value={selectedPage.ocr.text}
                onChange={(event) => {
                  const value = event.target.value
                  setPages((current) => current.map((page) => page.id === selectedPage.id && page.ocr
                    ? { ...page, ocr: { ...page.ocr, text: value } }
                    : page))
                }}
              />
            </div>
          )}
        </section>
      </div>

      <footer className="scanner-export-bar">
        <div className="scanner-export-status">
          <span className="scanner-private-dot" />
          <div>
            <strong>{pages.length} page{pages.length > 1 ? 's' : ''} · traitement local</strong>
            <span>OCR {getOcrQuality() === 'best' ? 'haute précision' : 'rapide'} · français + anglais</span>
          </div>
        </div>
        <div className="scanner-export-actions">
          {ocrCount > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={exportText} disabled={ocrRunning}>
              <IconDownload /> Texte
            </button>
          )}
          <button className="btn btn-sm btn-soft" onClick={() => void buildPdf(false)} disabled={processing || exporting || ocrRunning}>
            <IconDownload /> PDF scan
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => void buildPdf(true)} disabled={processing || exporting || ocrRunning}>
            {exporting || ocrRunning ? <span className="loading loading-spinner loading-xs" /> : <ScanSparkleIcon />}
            OCR + PDF recherchable
          </button>
        </div>
      </footer>
    </div>
  )
}
