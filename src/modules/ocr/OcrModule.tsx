import { useRef, useState } from 'react'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { openPdf } from '../../lib/pdfjs'
import {
  getOcrQuality, recognizeCanvas, setOcrQuality, type OcrQuality, type OcrWord,
} from '../../lib/ocr'
import { preprocessForOcr } from '../../lib/preprocess'
import { downloadBytes } from '../create/exportPdf'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { InfoDialog } from '../../components/ui/InfoDialog'
import { toast } from '../../components/ui/Toast'
import { IconDownload, IconPlay, IconX } from '../../components/ui/icons'

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

const PREPROCESS_KEY = 'ocr-preprocess'

function OcrHelp() {
  return (
    <InfoDialog title="🔍 OCR — comment obtenir un bon résultat">
      <p>
        La reconnaissance (tesseract) fonctionne mieux sur du texte <strong>net, sombre sur
        fond clair, d'au moins ~20 px de hauteur</strong>. Les photos de documents (ombres,
        perspective, faible résolution) sont le cas le plus difficile.
      </p>
      <h4 className="font-semibold mt-1">Les deux options</h4>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>
          <strong>Prétraitement</strong> (activé par défaut) : l'image est agrandie si elle
          est petite, passée en niveaux de gris, son contraste est étiré, puis une
          binarisation adaptative neutralise les ombres et l'éclairage inégal. C'est le
          levier le plus efficace sur les photos — la vignette montre ce que « voit » le
          moteur. Désactivez-le si votre document est déjà propre et que le résultat se
          dégrade (rare).
        </li>
        <li>
          <strong>Modèle haute précision</strong> : remplace le modèle rapide (~2,5 Mo) par
          le modèle complet (~16 Mo, chargé au premier usage puis mis en cache). Plus lent,
          mais nettement plus fiable sur les scans difficiles, les petites tailles de
          police et les accents.
        </li>
      </ul>
      <h4 className="font-semibold mt-1">Conseils de prise de vue</h4>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>Photographiez à plat, de face (la perspective n'est pas corrigée) ;</li>
        <li>évitez les ombres portées et le flou : le moindre bougé coûte cher ;</li>
        <li>préférez un scan 300 dpi quand c'est possible ;</li>
        <li>seuls le français et l'anglais sont reconnus.</li>
      </ul>
      <p className="text-base-content/60">
        Après un premier essai, changez les options puis « Relancer » : le fichier n'a pas
        besoin d'être redéposé.
      </p>
    </InfoDialog>
  )
}

export default function OcrModule() {
  const [source, setSource] = useState<OcrSource | null>(null)
  const [pages, setPages] = useState<OcrPageResult[]>([])
  const [progress, setProgress] = useState<Progress | null>(null)
  const [running, setRunning] = useState(false)
  const [preprocess, setPreprocess] = useState(localStorage.getItem(PREPROCESS_KEY) !== 'off')
  const [quality, setQuality] = useState<OcrQuality>(getOcrQuality())
  const cancelRef = useRef(false)
  /** Dernier fichier traité, pour pouvoir relancer avec d'autres options. */
  const fileRef = useRef<File | null>(null)

  function updatePreprocess(on: boolean) {
    setPreprocess(on)
    localStorage.setItem(PREPROCESS_KEY, on ? 'on' : 'off')
  }

  function updateQuality(q: OcrQuality) {
    setQuality(q)
    setOcrQuality(q)
  }

  async function runOcr(files: File[]) {
    const file = files[0]
    if (!file) return
    fileRef.current = file
    cancelRef.current = false
    setRunning(true)
    setPages([])
    try {
      const results: OcrPageResult[] = []

      async function processCanvas(
        raw: HTMLCanvasElement,
        widthPts: number,
        heightPts: number,
        pageNum: number,
        totalPages: number
      ) {
        setProgress({ page: pageNum, totalPages, pct: 0, phase: 'model' })
        // Le prétraitement aide surtout photos et PDF scannés ; la vignette
        // montre l'image réellement analysée par le moteur.
        const canvas = preprocess ? preprocessForOcr(raw, { binarize: true }) : raw
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
        // createImageBitmap applique l'orientation EXIF (photos de téléphone)
        const img = await createImageBitmap(file, { imageOrientation: 'from-image' })
        const imgW = img.width
        const imgH = img.height
        const canvas = document.createElement('canvas')
        canvas.width = imgW
        canvas.height = imgH
        canvas.getContext('2d')!.drawImage(img, 0, 0)
        img.close()
        // L'export ré-encode le canvas ORIENTÉ (et non le fichier d'origine),
        // sinon le PDF cherchable embarquerait la photo couchée.
        const dataUrl =
          file.type === 'image/png'
            ? canvas.toDataURL('image/png')
            : canvas.toDataURL('image/jpeg', 0.92)
        setSource({ kind: 'image', name: file.name.replace(/\.[^.]+$/, ''), dataUrl })
        // page de sortie : taille image plafonnée à la largeur A4
        const ratio = Math.min(1, 595.28 / imgW)
        await processCanvas(canvas, imgW * ratio, imgH * ratio, 1, 1)
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

  const optionsBar = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          role="switch"
          className="toggle toggle-sm toggle-primary"
          checked={preprocess}
          onChange={(e) => updatePreprocess(e.target.checked)}
          disabled={running}
        />
        Prétraitement (contraste + binarisation)
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          role="switch"
          className="toggle toggle-sm toggle-primary"
          checked={quality === 'best'}
          onChange={(e) => updateQuality(e.target.checked ? 'best' : 'fast')}
          disabled={running}
        />
        Modèle haute précision
        <span className="text-xs text-base-content/50">(~16 Mo au 1ᵉʳ usage, plus lent)</span>
      </label>
    </div>
  )

  if (!source && !running) {
    return (
      <div className="max-w-xl mx-auto mt-6 sm:mt-16 flex flex-col gap-3">
        <FileDropzone
          accept="application/pdf,image/png,image/jpeg"
          onFiles={(files) => void runOcr(files)}
          className="bg-base-100 shadow-xl py-16"
          title="Déposez un PDF scanné ou une image"
          description="Reconnaissance français + anglais, entièrement dans votre navigateur (premier lancement : chargement du modèle, ensuite en cache)"
          footer={
            <span className="text-xs text-base-content/50 flex items-center gap-1">
              Comment ça marche ? <OcrHelp />
            </span>
          }
        />
        <div className="card bg-base-100 border border-base-300/50 shadow-sm">
          <div className="card-body p-3">{optionsBar}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{source?.name}</span>
        <span className="badge badge-ghost badge-sm">fra + eng</span>
        <OcrHelp />
        <div className="ml-auto flex gap-2">
          <button
            className="btn btn-sm btn-soft rounded-full gap-1.5"
            onClick={() => fileRef.current && void runOcr([fileRef.current])}
            disabled={running || !fileRef.current}
            title="Relancer la reconnaissance avec les options actuelles"
          >
            <IconPlay /> Relancer
          </button>
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

      <div className="card bg-base-100 border border-base-300/50 shadow-sm">
        <div className="card-body p-3 flex-row flex-wrap items-center gap-2">
          {optionsBar}
          <span className="text-xs text-base-content/40 ml-auto">
            changez les options puis « Relancer »
          </span>
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
