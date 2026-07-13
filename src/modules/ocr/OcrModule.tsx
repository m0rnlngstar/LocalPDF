import { useRef, useState } from 'react'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { openPdf } from '../../lib/pdfjs'
import { recognizeCanvas, type OcrWord } from '../../lib/ocr'
import { downloadBytes } from '../create/exportPdf'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { toast } from '../../components/ui/Toast'
import { IconDownload, IconUpload, IconX } from '../../components/ui/icons'

/**
 * OCR autonome : PDF ou image → texte éditable (tesseract.js, fra+eng).
 * Export .txt, ou PDF « cherchable » : le document d'origine + une couche de
 * texte INVISIBLE positionnée mot à mot (technique de l'OCR layer).
 */

interface OcrPageResult {
  thumb: string
  text: string
  words: OcrWord[]
  /** Dimensions de la page de sortie en points PDF. */
  widthPts: number
  heightPts: number
  /** Pixels de l'image analysée par point PDF. */
  pxPerPt: number
}

interface OcrSource {
  kind: 'pdf' | 'image'
  name: string
  bytes?: ArrayBuffer
  dataUrl?: string
}

interface Progress {
  page: number
  totalPages: number
  pct: number
  phase: 'render' | 'ocr' | 'model'
}

export default function OcrModule() {
  const [source, setSource] = useState<OcrSource | null>(null)
  const [pages, setPages] = useState<OcrPageResult[]>([])
  const [progress, setProgress] = useState<Progress | null>(null)
  const [running, setRunning] = useState(false)
  const cancelRef = useRef(false)

  async function runOcr(files: File[]) {
    const file = files[0]
    if (!file) return
    cancelRef.current = false
    setRunning(true)
    setPages([])
    try {
      const results: OcrPageResult[] = []

      async function processCanvas(
        canvas: HTMLCanvasElement,
        widthPts: number,
        heightPts: number,
        pageNum: number,
        totalPages: number
      ) {
        setProgress({ page: pageNum, totalPages, pct: 0, phase: 'model' })
        const { text, words } = await recognizeCanvas(canvas, (p) =>
          setProgress({ page: pageNum, totalPages, pct: p, phase: 'ocr' })
        )
        // miniature réduite pour l'affichage
        const thumb = document.createElement('canvas')
        const tScale = 130 / canvas.width
        thumb.width = 130
        thumb.height = Math.round(canvas.height * tScale)
        thumb.getContext('2d')!.drawImage(canvas, 0, 0, thumb.width, thumb.height)
        results.push({
          thumb: thumb.toDataURL(),
          text,
          words,
          widthPts,
          heightPts,
          pxPerPt: canvas.width / widthPts,
        })
        setPages([...results])
      }

      if (file.type === 'application/pdf') {
        const bytes = await file.arrayBuffer()
        setSource({ kind: 'pdf', name: file.name.replace(/\.pdf$/i, ''), bytes })
        const pdf = await openPdf(bytes)
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelRef.current) return
          setProgress({ page: i, totalPages: pdf.numPages, pct: 0, phase: 'render' })
          const page = await pdf.getPage(i)
          const vp0 = page.getViewport({ scale: 1 })
          // ~1600 px de large : bon compromis précision / mémoire
          const scale = Math.min(1600 / vp0.width, 3)
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
          await processCanvas(canvas, vp0.width, vp0.height, i, pdf.numPages)
        }
      } else {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(r.result as string)
          r.onerror = reject
          r.readAsDataURL(file)
        })
        setSource({ kind: 'image', name: file.name.replace(/\.[^.]+$/, ''), dataUrl })
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image()
          i.onload = () => resolve(i)
          i.onerror = reject
          i.src = dataUrl
        })
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        canvas.getContext('2d')!.drawImage(img, 0, 0)
        // page de sortie : taille image plafonnée à la largeur A4
        const ratio = Math.min(1, 595.28 / img.width)
        await processCanvas(canvas, img.width * ratio, img.height * ratio, 1, 1)
      }
      toast.success('OCR terminé !')
    } catch (err) {
      console.error(err)
      toast.error("Échec de l'OCR")
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  function exportTxt() {
    const text = pages
      .map((p, i) => (pages.length > 1 ? `----- Page ${i + 1} -----\n\n${p.text.trim()}` : p.text.trim()))
      .join('\n\n')
    downloadBytes(new TextEncoder().encode(text), `${source?.name ?? 'ocr'}.txt`, 'text/plain')
    toast.success('Texte exporté !')
  }

  async function exportSearchablePdf() {
    if (!source) return
    try {
      let doc: PDFDocument
      if (source.kind === 'pdf' && source.bytes) {
        doc = await PDFDocument.load(source.bytes)
      } else {
        doc = await PDFDocument.create()
        const bytes = await fetch(source.dataUrl!).then((r) => r.arrayBuffer())
        const image = source.dataUrl!.startsWith('data:image/png')
          ? await doc.embedPng(bytes)
          : await doc.embedJpg(bytes)
        const p = pages[0]
        const page = doc.addPage([p.widthPts, p.heightPts])
        page.drawImage(image, { x: 0, y: 0, width: p.widthPts, height: p.heightPts })
      }
      const font = await doc.embedFont(StandardFonts.Helvetica)
      const pdfPages = doc.getPages()
      pages.forEach((p, i) => {
        const page = pdfPages[i]
        if (!page) return
        // Couche de texte invisible : chaque mot à sa position détectée
        for (const w of p.words) {
          const fontSize = Math.max(4, (w.y1 - w.y0) / p.pxPerPt)
          page.drawText(w.text, {
            x: w.x0 / p.pxPerPt,
            y: p.heightPts - w.y1 / p.pxPerPt,
            size: fontSize,
            font,
            color: rgb(0, 0, 0),
            opacity: 0,
          })
        }
      })
      downloadBytes(await doc.save(), `${source.name}-cherchable.pdf`)
      toast.success('PDF cherchable exporté !')
    } catch (err) {
      console.error(err)
      toast.error("Échec de l'export")
    }
  }

  if (!source && !running) {
    return (
      <div className="max-w-xl mx-auto mt-6 sm:mt-16">
        <FileDropzone
          accept="application/pdf,image/png,image/jpeg"
          onFiles={(files) => void runOcr(files)}
          className="bg-base-100 shadow-xl py-16"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="text-primary"><IconUpload /></div>
            <p className="font-semibold">Déposez un PDF scanné ou une image</p>
            <p className="text-sm text-base-content/60">
              Reconnaissance français + anglais, entièrement dans votre navigateur
              (premier lancement : chargement du modèle ~2,5 Mo, ensuite en cache)
            </p>
          </div>
        </FileDropzone>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{source?.name}</span>
        <span className="badge badge-ghost badge-sm">fra + eng</span>
        <div className="ml-auto flex gap-2">
          <button
            className="btn btn-sm btn-ghost rounded-full gap-1"
            onClick={() => {
              cancelRef.current = true
              setSource(null)
              setPages([])
            }}
          >
            <IconX /> Fermer
          </button>
          <button
            className="btn btn-sm btn-soft rounded-full gap-1.5"
            onClick={exportTxt}
            disabled={running || pages.length === 0}
          >
            <IconDownload /> .txt
          </button>
          <button
            className="btn btn-sm btn-primary rounded-full shadow-md gap-1.5"
            onClick={() => void exportSearchablePdf()}
            disabled={running || pages.length === 0}
          >
            <IconDownload /> PDF cherchable
          </button>
        </div>
      </div>

      {progress && (
        <div className="card bg-base-100 border border-base-300/50 shadow-sm">
          <div className="card-body p-3 gap-2">
            <div className="flex justify-between text-sm">
              <span>
                {progress.phase === 'render' && 'Rendu de la page…'}
                {progress.phase === 'model' && 'Préparation du moteur OCR…'}
                {progress.phase === 'ocr' && 'Reconnaissance en cours…'}
                {' '}Page {progress.page} / {progress.totalPages}
              </span>
              <span className="font-mono">
                {Math.round(((progress.page - 1 + progress.pct) / progress.totalPages) * 100)}%
              </span>
            </div>
            <progress
              className="progress progress-primary w-full"
              value={(progress.page - 1 + progress.pct) * 100}
              max={progress.totalPages * 100}
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {pages.map((p, i) => (
          <div key={i} className="card bg-base-100 border border-base-300/50 shadow-sm">
            <div className="card-body p-3 flex-row gap-3 items-start">
              <div className="hidden sm:block shrink-0">
                <img src={p.thumb} alt="" className="border border-base-300 bg-white" style={{ width: 90 }} />
                <p className="text-[11px] text-center text-base-content/50 mt-1">p. {i + 1}</p>
              </div>
              <textarea
                className="textarea w-full font-mono text-xs leading-relaxed"
                rows={Math.min(14, Math.max(5, p.text.split('\n').length))}
                value={p.text}
                onChange={(e) =>
                  setPages((prev) =>
                    prev.map((pp, j) => (j === i ? { ...pp, text: e.target.value } : pp))
                  )
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
