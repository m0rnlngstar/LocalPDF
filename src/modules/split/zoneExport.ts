import { PDFDocument, type PDFPage } from 'pdf-lib'
import JSZip from 'jszip'
import { downloadBytes } from '../create/exportPdf'

export interface CropZone {
  id: string
  page: number
  x: number
  y: number
  width: number
  height: number
}

interface PdfBox {
  x: number
  y: number
  width: number
  height: number
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

/**
 * Convertit une zone normalisée telle qu'elle est affichée par PDF.js (origine
 * en haut à gauche) vers les coordonnées natives du PDF (origine en bas à
 * gauche). Les quatre rotations standard sont prises en charge.
 */
export function normalizedZoneToPdfBox(page: PDFPage, zone: CropZone): PdfBox {
  const media = page.getMediaBox()
  const rotation = ((page.getRotation().angle % 360) + 360) % 360
  const x = clamp(zone.x, 0, 1)
  const y = clamp(zone.y, 0, 1)
  const width = clamp(zone.width, 0.01, 1 - x)
  const height = clamp(zone.height, 0.01, 1 - y)

  let left: number
  let bottom: number
  let boxWidth: number
  let boxHeight: number

  if (rotation === 90) {
    left = y * media.width
    bottom = x * media.height
    boxWidth = height * media.width
    boxHeight = width * media.height
  } else if (rotation === 180) {
    left = (1 - x - width) * media.width
    bottom = y * media.height
    boxWidth = width * media.width
    boxHeight = height * media.height
  } else if (rotation === 270) {
    left = (1 - y - height) * media.width
    bottom = (1 - x - width) * media.height
    boxWidth = height * media.width
    boxHeight = width * media.height
  } else {
    left = x * media.width
    bottom = (1 - y - height) * media.height
    boxWidth = width * media.width
    boxHeight = height * media.height
  }

  return {
    x: media.x + left,
    y: media.y + bottom,
    width: Math.max(1, boxWidth),
    height: Math.max(1, boxHeight),
  }
}

async function buildZonePdf(source: PDFDocument, zone: CropZone) {
  const output = await PDFDocument.create()
  const [page] = await output.copyPages(source, [zone.page])
  const box = normalizedZoneToPdfBox(page, zone)
  page.setMediaBox(box.x, box.y, box.width, box.height)
  page.setCropBox(box.x, box.y, box.width, box.height)
  page.setBleedBox(box.x, box.y, box.width, box.height)
  page.setTrimBox(box.x, box.y, box.width, box.height)
  page.setArtBox(box.x, box.y, box.width, box.height)
  output.addPage(page)
  return output.save()
}

function zoneFilename(baseName: string, zone: CropZone, index: number) {
  const number = String(index + 1).padStart(2, '0')
  return `${baseName}-ticket-${number}-page-${zone.page + 1}.pdf`
}

export async function exportCropZones(
  sourceBytes: ArrayBuffer,
  zones: CropZone[],
  baseName: string,
  onProgress?: (done: number, total: number) => void
) {
  if (!zones.length) return
  const source = await PDFDocument.load(sourceBytes)

  if (zones.length === 1) {
    downloadBytes(await buildZonePdf(source, zones[0]), zoneFilename(baseName, zones[0], 0))
    onProgress?.(1, 1)
    return
  }

  const zip = new JSZip()
  for (let index = 0; index < zones.length; index++) {
    const zone = zones[index]
    zip.file(zoneFilename(baseName, zone, index), await buildZonePdf(source, zone))
    onProgress?.(index + 1, zones.length)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBytes(
    new Uint8Array(await blob.arrayBuffer()),
    `${baseName}-tickets.zip`,
    'application/zip'
  )
}
