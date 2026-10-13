import * as pdfjsLib from 'pdfjs-dist'
import { openPdf, type PdfJsDocument } from '../lib/pdfjs'
import { displaySize, totalRotation, type StudioPage } from './types'

/**
 * Rendu des pages de travail (PDF, vierge, image) et extraction de leur texte.
 * Les documents pdf.js sont mis en cache par docId pour ne pas re-parser les
 * octets à chaque rendu.
 */

const docCache = new Map<string, Promise<PdfJsDocument>>()

export function getPdfDoc(docId: string, bytes: ArrayBuffer, password?: string): Promise<PdfJsDocument> {
  let doc = docCache.get(docId)
  if (!doc) {
    doc = openPdf(bytes, password)
    docCache.set(docId, doc)
  }
  return doc
}

const imageCache = new Map<string, Promise<HTMLImageElement>>()

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  let p = imageCache.get(dataUrl)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = dataUrl
    })
    imageCache.set(dataUrl, p)
  }
  return p
}

/**
 * Les rendus d'un même document sont sérialisés : pdf.js perd des glyphes
 * quand une même page est rendue simultanément à deux échelles (lecteur +
 * miniature, export…) pendant le chargement des polices.
 */
const queues = new Map<string, Promise<unknown>>()
function enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  const run = prev.then(job, job)
  queues.set(key, run.catch(() => {}))
  return run
}

/** Rend la page à l'échelle donnée (1 = taille réelle en points PDF). */
export function renderPage(
  page: StudioPage,
  docs: Record<string, ArrayBuffer>,
  scale: number
): Promise<HTMLCanvasElement> {
  return page.source.kind === 'pdf'
    ? enqueue(page.source.docId, () => renderPageNow(page, docs, scale))
    : renderPageNow(page, docs, scale)
}

async function renderPageNow(
  page: StudioPage,
  docs: Record<string, ArrayBuffer>,
  scale: number
): Promise<HTMLCanvasElement> {
  const { width, height } = displaySize(page)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const ctx = canvas.getContext('2d')!

  if (page.source.kind === 'pdf') {
    const bytes = docs[page.source.docId]
    if (!bytes) throw new Error('Document source introuvable')
    const doc = await getPdfDoc(page.source.docId, bytes, page.source.password)
    const pdfPage = await doc.getPage(page.source.pageIndex + 1)
    // pdf.js : le paramètre rotation est ABSOLU (remplace la rotation propre)
    const viewport = pdfPage.getViewport({ scale, rotation: totalRotation(page) })
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise
    return canvas
  }

  ctx.fillStyle = page.source.kind === 'blank' ? (page.source.background ?? '#ffffff') : '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  if (page.source.kind === 'image') {
    const img = await loadImage(page.source.dataUrl)
    const rot = totalRotation(page)
    ctx.save()
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((rot * Math.PI) / 180)
    const w = page.source.width * scale
    const h = page.source.height * scale
    ctx.drawImage(img, -w / 2, -h / 2, w, h)
    ctx.restore()
  }

  return canvas
}

/* ------------------------------------------------------------------------- */
/* Texte de la page (couche texte PDF ou OCR), en points d'affichage           */
/* ------------------------------------------------------------------------- */

export interface TextItemBox {
  text: string
  x: number
  y: number
  width: number
  height: number
}

const textCache = new Map<string, Promise<TextItemBox[]>>()

/** Éléments de texte d'une page, positionnés dans le repère d'affichage. */
export function getPageTextItems(page: StudioPage, docs: Record<string, ArrayBuffer>): Promise<TextItemBox[]> {
  if (page.source.kind !== 'pdf') {
    return Promise.resolve(ocrItems(page))
  }
  const src = page.source
  const key = `${src.docId}:${src.pageIndex}:${totalRotation(page)}`
  let p = textCache.get(key)
  if (!p) {
    p = (async () => {
      const doc = await getPdfDoc(src.docId, docs[src.docId], src.password)
      const pdfPage = await doc.getPage(src.pageIndex + 1)
      const viewport = pdfPage.getViewport({ scale: 1, rotation: totalRotation(page) })
      const content = await pdfPage.getTextContent()
      const boxes: TextItemBox[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform)
        const fontH = Math.hypot(tx[2], tx[3])
        const vertical = Math.abs(tx[1]) > Math.abs(tx[0])
        const len = item.width * viewport.scale
        if (vertical) {
          // Texte tourné de ±90° à l'affichage
          const dir = Math.sign(tx[1]) || 1
          boxes.push({
            text: item.str,
            x: dir > 0 ? tx[4] - fontH * 0.2 : tx[4] - fontH * 0.8,
            y: dir > 0 ? tx[5] : tx[5] - len,
            width: fontH,
            height: len,
          })
        } else {
          const dir = Math.sign(tx[0]) || 1
          boxes.push({
            text: item.str,
            x: dir > 0 ? tx[4] : tx[4] - len,
            y: dir > 0 ? tx[5] - fontH * 0.85 : tx[5] - fontH * 0.15,
            width: len,
            height: fontH,
          })
        }
      }
      return boxes
    })()
    textCache.set(key, p)
  }
  // La couche OCR complète le texte natif (pages scannées)
  return p.then((boxes) => (boxes.length ? boxes : ocrItems(page)))
}

function ocrItems(page: StudioPage): TextItemBox[] {
  return page.ocr?.words.map((w) => ({ text: w.text, x: w.x, y: w.y, width: w.width, height: w.height })) ?? []
}

/** Texte brut d'une page (natif, ou OCR à défaut). */
export async function getPageText(page: StudioPage, docs: Record<string, ArrayBuffer>): Promise<string> {
  const items = await getPageTextItems(page, docs)
  return items.map((i) => i.text).join(' ')
}

/**
 * Surlignage « texte » : rectangles des éléments de texte recoupant la zone
 * tirée, fusionnés par ligne. Retourne null si aucun texte n'est sous la zone.
 */
export function textRectsInZone(
  items: TextItemBox[],
  zone: { x: number; y: number; width: number; height: number }
): { rects: { x: number; y: number; width: number; height: number }[]; quote: string } | null {
  const hits = items.filter((i) => {
    const ix = Math.max(0, Math.min(i.x + i.width, zone.x + zone.width) - Math.max(i.x, zone.x))
    const iy = Math.max(0, Math.min(i.y + i.height, zone.y + zone.height) - Math.max(i.y, zone.y))
    return ix > 0 && iy > i.height * 0.3
  })
  if (!hits.length) return null

  // Regroupe par ligne (centres verticaux proches)
  hits.sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2) || a.x - b.x)
  const lines: TextItemBox[][] = []
  for (const h of hits) {
    const last = lines[lines.length - 1]
    const ref = last?.[0]
    if (ref && Math.abs(ref.y + ref.height / 2 - (h.y + h.height / 2)) < ref.height * 0.5) last.push(h)
    else lines.push([h])
  }
  const rects = lines.map((line) => {
    // On rogne horizontalement à la zone tirée : surlignage partiel d'une ligne
    const x0 = Math.max(Math.min(...line.map((i) => i.x)), zone.x)
    const x1 = Math.min(Math.max(...line.map((i) => i.x + i.width)), zone.x + zone.width)
    const y0 = Math.min(...line.map((i) => i.y))
    const y1 = Math.max(...line.map((i) => i.y + i.height))
    return { x: x0, y: y0, width: Math.max(2, x1 - x0), height: y1 - y0 }
  })
  // Citation : portion de chaque élément couverte par la zone (au prorata des caractères)
  const part = (i: TextItemBox) => {
    if (!i.text.length || i.width <= 0) return i.text
    const k = i.text.length / i.width
    const a = Math.max(0, Math.floor((zone.x - i.x) * k))
    const b = Math.min(i.text.length, Math.ceil((zone.x + zone.width - i.x) * k))
    return i.text.slice(a, b)
  }
  const quote = lines.map((l) => l.sort((a, b) => a.x - b.x).map(part).join(' ')).join(' ')
  return { rects, quote: quote.trim() }
}
