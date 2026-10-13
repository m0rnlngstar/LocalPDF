import {
  BlendMode, LineCapStyle, PDFDocument, PDFName, PDFString, PDFHexString, StandardFonts, degrees, rgb,
  type PDFFont, type PDFPage,
} from 'pdf-lib'
import JSZip from 'jszip'
import { hexToRgb01, type FontFamily } from '../lib/fonts'
import { makeFontLoader, wrapText } from '../lib/pdfExport'
import { compressPdf, type CompressLevel } from '../lib/compress'
import { getPageTextItems, renderPage } from './render'
import { calloutAnchor } from './textMeasure'
import { sanitizePageActions } from './pdfSanitize'
import {
  annBounds, displaySize, totalRotation, ANN_LABELS, CALLOUT_PAD, TEXT_FRAME_PAD,
  type Annotation, type StudioPage, type Watermark,
} from './types'

/**
 * Export du document de travail.
 *
 * Pour chaque page :
 * - page PDF intacte (ni rotation, ni annotation, ni OCR, ni filigrane) →
 *   copie directe (préserve liens, formulaires, métadonnées) ;
 * - page avec masquage → RASTÉRISÉE (le texte sous les zones masquées
 *   disparaît réellement du fichier), annotations redessinées par-dessus ;
 * - sinon → contenu source EMBARQUÉ en vectoriel (embedPage), rotation
 *   appliquée, annotations dessinées dans le repère d'affichage.
 *
 * Repère : annotations en coordonnées d'affichage (origine haut-gauche) ;
 * sur la page exportée W×H (origine bas-gauche), (x, y) devient (x, H − y).
 */

export interface ExportOptions {
  watermark?: Watermark | null
  /** Ajoute les commentaires comme annotations PDF natives (visibles dans Acrobat, Edge…). */
  nativeComments?: boolean
  /** Ajoute la couche texte OCR invisible (PDF cherchable). */
  includeOcr?: boolean
  compress?: CompressLevel | null
  /**
   * Convertit toutes les pages en images JPEG (le texte reste cherchable via
   * une couche invisible). Dernier recours pour tenir une taille maximale.
   */
  rasterize?: { dpi: number; quality: number } | null
  title?: string
  onProgress?: (done: number, total: number) => void
}

function placementFor(rot: number, W: number, H: number) {
  switch (((rot % 360) + 360) % 360) {
    case 90: return { x: 0, y: H, rotate: degrees(-90) }
    case 180: return { x: W, y: H, rotate: degrees(180) }
    case 270: return { x: W, y: 0, rotate: degrees(90) }
    default: return { x: 0, y: 0, rotate: degrees(0) }
  }
}

/** Retire les caractères que la police ne sait pas encoder (évite un échec d'export). */
function safeText(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet())
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (supported.has(cp)) out += ch
    else if (ch === '’' || ch === '‘') out += supported.has(39) ? "'" : ''
    else if (ch === '“' || ch === '”') out += '"'
    else if (ch === '–' || ch === '—') out += '-'
    else if (ch === ' ' || ch === ' ') out += ' '
    else out += supported.has(63) ? '?' : ''
  }
  return out
}

function color(hex: string) {
  const c = hexToRgb01(hex)
  return rgb(c.r, c.g, c.b)
}

async function embedDataUrlImage(out: PDFDocument, dataUrl: string) {
  if (dataUrl.startsWith('data:image/png')) {
    return out.embedPng(await fetch(dataUrl).then((r) => r.arrayBuffer()))
  }
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
    return out.embedJpg(await fetch(dataUrl).then((r) => r.arrayBuffer()))
  }
  // Autres formats (webp, gif, svg…) : ré-encodage PNG via canvas
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || 800
  canvas.height = img.naturalHeight || 600
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  const png = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encodage'))), 'image/png'))
  return out.embedPng(await png.arrayBuffer())
}

type FontGetter = (ann?: { fontFamily?: FontFamily; bold?: boolean; italic?: boolean }) => Promise<PDFFont>

async function drawAnnotation(out: PDFDocument, page: PDFPage, H: number, ann: Annotation, getFont: FontGetter) {
  switch (ann.type) {
    case 'highlight': {
      const rects = ann.rects?.length
        ? ann.rects.map((r) => ({ x: ann.x + r.x, y: ann.y + r.y, width: r.width, height: r.height }))
        : [{ x: ann.x, y: ann.y, width: ann.width, height: ann.height }]
      for (const r of rects) {
        page.drawRectangle({
          x: r.x, y: H - r.y - r.height, width: r.width, height: r.height,
          color: color(ann.color), opacity: 0.45, blendMode: BlendMode.Multiply,
        })
      }
      break
    }
    case 'rect':
      page.drawRectangle({
        x: ann.x, y: H - ann.y - ann.height, width: ann.width, height: ann.height,
        borderColor: color(ann.stroke), borderWidth: ann.strokeWidth,
        ...(ann.fill ? { color: color(ann.fill) } : {}),
      })
      break
    case 'ellipse':
      page.drawEllipse({
        x: ann.x + ann.width / 2, y: H - (ann.y + ann.height / 2),
        xScale: ann.width / 2, yScale: ann.height / 2,
        borderColor: color(ann.stroke), borderWidth: ann.strokeWidth,
        ...(ann.fill ? { color: color(ann.fill) } : {}),
      })
      break
    case 'redact':
      page.drawRectangle({ x: ann.x, y: H - ann.y - ann.height, width: ann.width, height: ann.height, color: color(ann.color) })
      break
    case 'line':
    case 'arrow': {
      const start = { x: ann.x, y: H - ann.y }
      const end = { x: ann.x + ann.dx, y: H - (ann.y + ann.dy) }
      page.drawLine({ start, end, thickness: ann.strokeWidth, color: color(ann.stroke), lineCap: LineCapStyle.Round })
      if (ann.type === 'arrow') {
        const angle = Math.atan2(end.y - start.y, end.x - start.x)
        const len = Math.max(8, ann.strokeWidth * 4)
        for (const side of [-1, 1]) {
          const a = angle + Math.PI - side * (Math.PI / 7)
          page.drawLine({
            start: end,
            end: { x: end.x + len * Math.cos(a), y: end.y + len * Math.sin(a) },
            thickness: ann.strokeWidth, color: color(ann.stroke), lineCap: LineCapStyle.Round,
          })
        }
      }
      break
    }
    case 'ink': {
      if (ann.points.length < 4) break
      let path = `M ${ann.points[0] + ann.x} ${ann.points[1] + ann.y}`
      for (let i = 2; i < ann.points.length; i += 2) path += ` L ${ann.points[i] + ann.x} ${ann.points[i + 1] + ann.y}`
      // drawSvgPath : coordonnées écran (y vers le bas) depuis l'origine donnée
      page.drawSvgPath(path, {
        x: 0, y: H, borderColor: color(ann.stroke), borderWidth: ann.strokeWidth, borderLineCap: LineCapStyle.Round,
      })
      break
    }
    case 'text': {
      const font = await getFont(ann)
      const text = safeText(font, ann.text)
      const lines = wrapText(text, font, ann.fontSize, ann.width)
      if (ann.background || ann.border) {
        // Même cadre qu'à l'écran : marge autour du texte quand il y a une bordure
        const pad = ann.border ? TEXT_FRAME_PAD : 2
        const h = lines.length * ann.fontSize * 1.15
        page.drawRectangle({
          x: ann.x - pad, y: H - ann.y - h - pad, width: ann.width + pad * 2, height: h + pad * 2,
          ...(ann.background ? { color: color(ann.background) } : {}),
          ...(ann.border ? { borderColor: color(ann.border), borderWidth: ann.borderWidth ?? 1.5 } : {}),
        })
      }
      lines.forEach((line, i) => {
        const w = font.widthOfTextAtSize(line, ann.fontSize)
        const dx = ann.align === 'center' ? (ann.width - w) / 2 : ann.align === 'right' ? ann.width - w : 0
        page.drawText(line, {
          x: ann.x + dx, y: H - (ann.y + ann.fontSize * 0.85 + i * ann.fontSize * 1.15),
          size: ann.fontSize, font, color: color(ann.color),
        })
      })
      break
    }
    case 'callout': {
      const font = await getFont()
      const text = safeText(font, ann.text)
      const inner = Math.max(10, ann.width - CALLOUT_PAD * 2)
      const lines = wrapText(text, font, ann.fontSize, inner)
      const h = lines.length * ann.fontSize * 1.15 + CALLOUT_PAD * 2
      const anchor = calloutAnchor({ x: ann.x, y: ann.y, width: ann.width, height: h }, ann.tx, ann.ty)
      if (anchor) {
        const start = { x: anchor.x, y: H - anchor.y }
        const end = { x: ann.tx, y: H - ann.ty }
        const sw = (ann.strokeWidth ?? 1.2) * 1.25
        const head = Math.max(8, (ann.strokeWidth ?? 1.2) * 4)
        page.drawLine({ start, end, thickness: sw, color: color(ann.stroke), lineCap: LineCapStyle.Round })
        const angle = Math.atan2(end.y - start.y, end.x - start.x)
        for (const side of [-1, 1]) {
          const a = angle + Math.PI - side * (Math.PI / 7)
          page.drawLine({
            start: end, end: { x: end.x + head * Math.cos(a), y: end.y + head * Math.sin(a) },
            thickness: sw, color: color(ann.stroke), lineCap: LineCapStyle.Round,
          })
        }
      }
      page.drawRectangle({
        x: ann.x, y: H - ann.y - h, width: ann.width, height: h,
        borderColor: color(ann.stroke), borderWidth: ann.strokeWidth ?? 1.2,
        ...(ann.background ? { color: color(ann.background) } : {}),
      })
      lines.forEach((line, i) => {
        page.drawText(line, {
          x: ann.x + CALLOUT_PAD,
          y: H - (ann.y + CALLOUT_PAD + ann.fontSize * 0.85 + i * ann.fontSize * 1.15),
          size: ann.fontSize, font, color: color(ann.color),
        })
      })
      break
    }
    case 'note': {
      const font = await getFont()
      const bg = hexToRgb01(ann.color)
      page.drawRectangle({
        x: ann.x, y: H - ann.y - ann.height, width: ann.width, height: ann.height,
        color: rgb(bg.r, bg.g, bg.b), borderColor: rgb(bg.r * 0.75, bg.g * 0.75, bg.b * 0.5), borderWidth: 1,
      })
      const pad = 8
      const size = 11
      const lines = wrapText(safeText(font, ann.text), font, size, ann.width - pad * 2)
      const maxLines = Math.floor((ann.height - pad * 2) / (size * 1.15))
      lines.slice(0, maxLines).forEach((line, i) => {
        page.drawText(line, {
          x: ann.x + pad, y: H - (ann.y + pad + size * 0.85 + i * size * 1.15),
          size, font, color: rgb(0.2, 0.2, 0.2),
        })
      })
      break
    }
    case 'stamp': {
      const font = await getFont({ bold: true })
      const text = safeText(font, ann.text)
      const padX = 8
      const padY = 6
      const textWidth = font.widthOfTextAtSize(text, ann.fontSize)
      const h = ann.fontSize + padY * 2
      page.drawRectangle({
        x: ann.x, y: H - ann.y - h, width: textWidth + padX * 2, height: h,
        borderColor: color(ann.color), borderWidth: 2,
      })
      page.drawText(text, {
        x: ann.x + padX, y: H - (ann.y + padY + ann.fontSize * 0.82),
        size: ann.fontSize, font, color: color(ann.color),
      })
      break
    }
    case 'image': {
      const image = await embedDataUrlImage(out, ann.dataUrl)
      page.drawImage(image, { x: ann.x, y: H - ann.y - ann.height, width: ann.width, height: ann.height })
      break
    }
  }
}

function drawWatermark(page: PDFPage, W: number, H: number, wm: Watermark, font: PDFFont) {
  const text = safeText(font, wm.text)
  if (!text.trim()) return
  const size = wm.fontSize
  const w = font.widthOfTextAtSize(text, size)
  const theta = wm.diagonal ? Math.atan2(H, W) : 0
  const cx = W / 2
  const cy = H / 2
  // Point de départ de la ligne de base pour que le texte soit centré après rotation
  const ox = -w / 2
  const oy = -size * 0.35
  page.drawText(text, {
    x: cx + ox * Math.cos(theta) - oy * Math.sin(theta),
    y: cy + ox * Math.sin(theta) + oy * Math.cos(theta),
    size, font, color: color(wm.color), opacity: wm.opacity,
    rotate: degrees((theta * 180) / Math.PI),
  })
}

/** Annotations PDF natives (/Text) pour les commentaires : lisibles dans tout lecteur PDF. */
function addNativeComments(out: PDFDocument, page: PDFPage, H: number, anns: Annotation[]) {
  const ctx = out.context
  const refs = []
  for (const ann of anns) {
    const content = ann.type === 'note' ? ann.text : ann.comment
    if (!content?.trim()) continue
    const b = annBounds(ann)
    const x = b.x + b.width
    const y = H - b.y
    const c = hexToRgb01(ann.type === 'note' ? ann.color : '#facc15')
    const dict = ctx.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [x - 2, y - 20, x + 18, y],
      Contents: PDFHexString.fromText(content),
      T: PDFHexString.fromText(ann.type === 'note' ? 'Commentaire' : ANN_LABELS[ann.type]),
      Name: 'Comment',
      C: [c.r, c.g, c.b],
      F: 4,
      Open: false,
      M: PDFString.fromDate(new Date(ann.createdAt ?? Date.now())),
    })
    refs.push(ctx.register(dict))
  }
  if (!refs.length) return
  const existing = page.node.lookup(PDFName.of('Annots'))
  const arr = existing && 'push' in existing ? existing : ctx.obj([])
  for (const r of refs) (arr as unknown as { push: (v: unknown) => void }).push(r)
  page.node.set(PDFName.of('Annots'), arr)
}

interface Mask {
  x: number
  y: number
  width: number
  height: number
  color: string
}

function intersects(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export async function buildStudioPdf(
  pages: StudioPage[],
  docs: Record<string, ArrayBuffer>,
  opts: ExportOptions = {}
): Promise<Uint8Array> {
  const { watermark, nativeComments = true, includeOcr = true } = opts
  const out = await PDFDocument.create()
  if (opts.title) out.setTitle(opts.title)
  out.setProducer('LocalPDF')
  const loadFont = makeFontLoader(out)
  const getFont: FontGetter = (a) =>
    loadFont(a?.fontFamily ?? 'Helvetica', !!a?.bold, !!a?.italic)
  let ocrFont: PDFFont | null = null
  let wmFont: PDFFont | null = null

  const srcCache = new Map<string, Promise<PDFDocument>>()
  const getSrc = (docId: string) => {
    let p = srcCache.get(docId)
    if (!p) {
      p = PDFDocument.load(docs[docId], { ignoreEncryption: true })
      srcCache.set(docId, p)
    }
    return p
  }
  // Variante « formulaires aplatis » : les valeurs saisies dans les champs
  // restent visibles quand la page est intégrée (embedPage ne garde pas les champs).
  const flatCache = new Map<string, Promise<PDFDocument>>()
  const getFlat = (docId: string) => {
    let p = flatCache.get(docId)
    if (!p) {
      p = PDFDocument.load(docs[docId], { ignoreEncryption: true }).then((d) => {
        try {
          if (d.getForm().getFields().length) d.getForm().flatten()
        } catch {
          // formulaire non aplatissable : on garde la page telle quelle
        }
        return d
      })
      flatCache.set(docId, p)
    }
    return p
  }

  /** Page rendue en image (caviardage, PDF chiffré ou endommagé, réduction de taille). */
  /**
   * Zones à effacer réellement du contenu d'origine : masquages (caviardage)
   * et zones de texte sur fond opaque (« Modifier un texte ») — sans cela,
   * l'ancien texte resterait présent, invisible mais copiable, sous la correction.
   */
  async function eraseZones(pageData: StudioPage): Promise<Mask[]> {
    const zones: Mask[] = []
    for (const a of pageData.annotations) {
      if (a.type === 'redact') zones.push({ x: a.x, y: a.y, width: a.width, height: a.height, color: a.color })
      if (a.type === 'text' && a.background) {
        const font = await getFont(a)
        const lines = wrapText(safeText(font, a.text), font, a.fontSize, a.width)
        const pad = a.border ? TEXT_FRAME_PAD : 2
        zones.push({
          x: a.x - pad, y: a.y - pad, width: a.width + pad * 2,
          height: lines.length * a.fontSize * 1.15 + pad * 2, color: a.background,
        })
      }
    }
    return zones
  }

  async function addRasterPage(pageData: StudioPage, W: number, H: number, masks: Mask[]) {
    const canvas = await renderPage(pageData, docs, (opts.rasterize?.dpi ?? 200) / 72)
    const ctx = canvas.getContext('2d')!
    const k = canvas.width / W
    for (const m of masks) {
      ctx.fillStyle = m.color
      ctx.fillRect(m.x * k, m.y * k, m.width * k, m.height * k)
    }
    const jpg = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encodage'))), 'image/jpeg', opts.rasterize?.quality ?? 0.9))
    const image = await out.embedJpg(await jpg.arrayBuffer())
    const page = out.addPage([W, H])
    page.drawImage(image, { x: 0, y: 0, width: W, height: H })
    return page
  }

  let done = 0
  for (const pageData of pages) {
    opts.onProgress?.(done, pages.length)
    const { width: W, height: H } = displaySize(pageData)
    const src = pageData.source
    const masks = await eraseZones(pageData)
    let hasOcr = includeOcr && !!pageData.ocr?.words.length
    /** Mots à réinjecter en texte invisible (OCR, ou texte natif d'une page aplatie). */
    let words = pageData.ocr?.words ?? []
    let page: PDFPage

    // PDF chiffré : pdf-lib ne sait pas déchiffrer, la page est rendue par pdf.js
    let raster = masks.length > 0 || !!opts.rasterize || (src.kind === 'pdf' && !!src.encrypted)
    let vectorPage: PDFPage | null = null
    if (!raster && src.kind === 'pdf') {
      try {
        const intact = pageData.rotation === 0 && pageData.annotations.length === 0 && !hasOcr && !watermark
        if (intact) {
          // Copie directe : liens, champs de formulaire et métadonnées préservés
          const [copied] = await out.copyPages(await getSrc(src.docId), [src.pageIndex])
          // Actions actives (JavaScript, lancement, envoi de formulaire…) retirées
          sanitizePageActions(copied)
          out.addPage(copied)
          if (nativeComments) addNativeComments(out, copied, H, pageData.annotations)
          done++
          continue
        }
        const [copied] = await out.copyPages(await getFlat(src.docId), [src.pageIndex])
        // embedPage ignore le /Rotate de la page : on applique la rotation TOTALE.
        const embedded = await out.embedPage(copied)
        vectorPage = out.addPage([W, H])
        vectorPage.drawPage(embedded, { ...placementFor(totalRotation(pageData), W, H), width: src.width, height: src.height })
      } catch (err) {
        // PDF endommagé ou non standard : repli sur le rendu pdf.js, plus tolérant
        console.warn('Page exportée en image (source non copiable) :', err)
        if (vectorPage) out.removePage(out.getPageCount() - 1)
        vectorPage = null
        raster = true
      }
    }

    if (raster) {
      page = await addRasterPage(pageData, W, H, masks)
      // La page aplatie reste cherchable : texte natif réinjecté hors zones masquées
      if (!hasOcr) {
        words = await getPageTextItems(pageData, docs)
        hasOcr = words.length > 0
      }
    } else if (vectorPage) {
      page = vectorPage
    } else {
      page = out.addPage([W, H])
      if (src.kind === 'blank' && src.background && src.background.toLowerCase() !== '#ffffff') {
        page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: color(src.background) })
      }
      if (src.kind === 'image') {
        const image = await embedDataUrlImage(out, src.dataUrl)
        page.drawImage(image, { ...placementFor(totalRotation(pageData), W, H), width: src.width, height: src.height })
      }
    }

    // Couche texte invisible (OCR) — sauf sous les zones caviardées
    if (hasOcr) {
      ocrFont ??= await out.embedFont(StandardFonts.Helvetica)
      for (const w of words) {
        if (masks.some((m) => intersects(w, m))) continue
        const text = safeText(ocrFont, w.text)
        if (!text) continue
        // Taille ajustée pour que la largeur du mot corresponde à la zone
        // détectée : la sélection dans un lecteur PDF reste alignée sur l'image
        const unit = ocrFont.widthOfTextAtSize(text, 1)
        const size = Math.max(2, Math.min(unit > 0 ? w.width / unit : w.height, w.height * 1.3, 72))
        try {
          page.drawText(text, { x: w.x, y: H - w.y - w.height * 0.85, size, font: ocrFont, opacity: 0 })
        } catch {
          // mot ignoré
        }
      }
    }

    for (const ann of pageData.annotations) {
      if (ann.type === 'redact') continue
      await drawAnnotation(out, page, H, ann, getFont)
    }

    if (watermark?.text) {
      wmFont ??= await out.embedFont(StandardFonts.HelveticaBold)
      drawWatermark(page, W, H, watermark, wmFont)
    }

    if (nativeComments) addNativeComments(out, page, H, pageData.annotations)
    done++
  }
  opts.onProgress?.(pages.length, pages.length)

  let bytes = await out.save()
  if (opts.compress) {
    const r = await compressPdf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, opts.compress)
    if (r.bytes.byteLength < bytes.byteLength) bytes = r.bytes
  }
  return bytes
}

/* ------------------------------------------------------------------------- */
/* Taille maximale par fichier (ex. 5 Mo pour MEG)                            */
/* ------------------------------------------------------------------------- */

export interface SizedPart {
  pages: StudioPage[]
  bytes: Uint8Array
}

export interface LimitResult {
  parts: SizedPart[]
  /** Moyen utilisé pour tenir la limite (null = rien à faire). */
  method: 'compress' | 'rasterize' | null
  /** Une page seule dépasse encore la limite. */
  overLimit: boolean
}

/** Paliers successifs, du plus fidèle au plus léger. */
const LIMIT_STEPS: Pick<ExportOptions, 'compress' | 'rasterize'>[] = [
  { compress: 'medium' },
  { compress: 'high' },
  { compress: 'high', rasterize: { dpi: 150, quality: 0.72 } },
  { compress: 'high', rasterize: { dpi: 110, quality: 0.6 } },
]

/**
 * Produit un ou plusieurs PDF de `maxBytes` au plus : export normal, puis
 * compression renforcée, puis pages converties en images ; si cela ne suffit
 * pas, le document est découpé en plusieurs fichiers (pages consécutives).
 */
export async function buildWithinLimit(
  pages: StudioPage[],
  docs: Record<string, ArrayBuffer>,
  opts: ExportOptions,
  maxBytes: number,
  onStep?: (label: string) => void
): Promise<LimitResult> {
  const base = { ...opts, onProgress: undefined }
  onStep?.('Export…')
  let bytes = await buildStudioPdf(pages, docs, base)
  if (bytes.byteLength <= maxBytes) return { parts: [{ pages, bytes }], method: null, overLimit: false }

  let step: Pick<ExportOptions, 'compress' | 'rasterize'> = {}
  for (const st of LIMIT_STEPS) {
    step = st
    onStep?.(st.rasterize ? 'Conversion des pages en images allégées…' : 'Compression renforcée…')
    bytes = await buildStudioPdf(pages, docs, { ...base, ...st })
    if (bytes.byteLength <= maxBytes) {
      return { parts: [{ pages, bytes }], method: st.rasterize ? 'rasterize' : 'compress', overLimit: false }
    }
  }

  // Découpage : moitiés successives avec les réglages les plus légers
  const parts: SizedPart[] = []
  let overLimit = false
  const split = async (group: StudioPage[], groupBytes: Uint8Array | null) => {
    const b = groupBytes ?? (await buildStudioPdf(group, docs, { ...base, ...step }))
    if (b.byteLength <= maxBytes || group.length === 1) {
      if (b.byteLength > maxBytes) overLimit = true
      parts.push({ pages: group, bytes: b })
      return
    }
    const mid = Math.ceil(group.length / 2)
    await split(group.slice(0, mid), null)
    await split(group.slice(mid), null)
  }
  onStep?.('Découpage en plusieurs fichiers…')
  await split(pages, bytes)
  return { parts, method: 'rasterize', overLimit }
}

/** Archive .zip à partir de fichiers déjà produits. */
export async function zipFiles(files: { name: string; bytes: Uint8Array }[]): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const f of files) zip.file(f.name, f.bytes)
  const blob = await zip.generateAsync({ type: 'blob' })
  return new Uint8Array(await blob.arrayBuffer())
}
