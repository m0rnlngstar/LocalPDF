import type { RenderedPage } from './types'
import { canvasToPage, releaseCanvas } from './raster'
import { sanitizeHtml } from './sanitize'

/** 96 dpi (CSS px) / 72 dpi (points PDF). */
const PT_TO_PX = 4 / 3

export interface PageBox {
  widthPt: number
  heightPt: number
}

export const A4_PAGE: PageBox = { widthPt: 595.28, heightPt: 841.89 }

/** Styles par défaut pour un rendu lisible des DOCX/Markdown/texte convertis. */
const BASE_STYLE = `
  h1,h2,h3,h4,h5,h6 { margin: 0.6em 0 0.35em; line-height: 1.25; font-weight: 600; }
  h1 { font-size: 1.6em; } h2 { font-size: 1.35em; } h3 { font-size: 1.15em; }
  p { margin: 0 0 0.7em; }
  ul, ol { margin: 0 0 0.7em; padding-left: 1.4em; }
  table { border-collapse: collapse; margin: 0 0 0.7em; width: 100%; }
  td, th { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  img { max-width: 100%; }
  blockquote { margin: 0 0 0.7em; padding-left: 0.8em; border-left: 3px solid #ccc; color: #555; }
  a { color: inherit; }
`

/**
 * Rend un fragment HTML en une séquence de pages-image de taille fixe (A4 par
 * défaut), en découpant le rendu complet par tranches de hauteur de page.
 * Utilisé pour DOCX/TXT/MD : donne un aperçu visuellement fidèle (polices,
 * couleurs, images) au prix d'un texte non sélectionnable dans le PDF final —
 * il n'existe pas de moteur de pagination fidèle à Word en pur client-side.
 */
export async function renderHtmlToPages(html: string, page: PageBox = A4_PAGE): Promise<RenderedPage[]> {
  const { default: html2canvas } = await import('html2canvas')
  const scale = 2
  const pagePxW = Math.round(page.widthPt * PT_TO_PX)
  const pagePxH = Math.round(page.heightPt * PT_TO_PX)
  const marginPx = 48

  /*
   * Rendu dans un cadre isolé (iframe sandbox SANS scripts) :
   * - le contenu importé, déjà nettoyé, ne peut de toute façon rien exécuter ;
   * - il ne reçoit pas les styles de l'application (dont les couleurs oklab
   *   du thème, que html2canvas ne sait pas lire).
   */
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  Object.assign(frame.style, {
    position: 'fixed', top: '0', left: '-99999px', width: `${pagePxW}px`, height: '100px', border: '0',
  })
  const bodyStyle = [
    'margin:0', `width:${pagePxW}px`, 'box-sizing:border-box', `padding:${marginPx}px`,
    'background:#ffffff', 'color:#111111', 'font-family:"Segoe UI", Arial, sans-serif',
    'font-size:15px', 'line-height:1.5',
  ].join(';')
  const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }))
  // HTML issu d'un fichier importé : nettoyé (scripts, ressources externes) avant insertion
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_STYLE}</style></head>`
    + `<body style='${bodyStyle}'>${sanitizeHtml(html)}</body></html>`
  document.body.appendChild(frame)

  try {
    await loaded
    const doc = frame.contentDocument
    if (!doc?.body) throw new Error('Rendu du document impossible')
    // Hauteur réelle du contenu, pour que html2canvas capture tout
    frame.style.height = `${Math.max(pagePxH, doc.documentElement.scrollHeight)}px`
    const fullCanvas = await html2canvas(doc.body, {
      scale,
      backgroundColor: '#ffffff',
      windowWidth: pagePxW,
    })

    const pageCanvasH = pagePxH * scale
    const totalH = fullCanvas.height
    const pageCount = Math.max(1, Math.ceil(totalH / pageCanvasH))
    const pages: RenderedPage[] = []

    for (let i = 0; i < pageCount; i++) {
      const sliceH = Math.min(pageCanvasH, totalH - i * pageCanvasH)
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = fullCanvas.width
      pageCanvas.height = pageCanvasH
      const ctx = pageCanvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
      ctx.drawImage(
        fullCanvas,
        0, i * pageCanvasH, fullCanvas.width, sliceH,
        0, 0, fullCanvas.width, sliceH
      )
      pages.push(await canvasToPage(pageCanvas, page.widthPt, page.heightPt))
    }
    releaseCanvas(fullCanvas)
    return pages
  } finally {
    frame.remove()
  }
}
