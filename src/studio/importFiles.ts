import { openProtected, PasswordRequiredError } from './passwords'
import { convertFile } from '../lib/convert/converters'
import { sniffFormat } from '../lib/convert/formats'
import { newId, type StudioPage } from './types'

/** Formats acceptés à l'ouverture / à l'insertion (le contenu est de toute façon vérifié). */
export const ACCEPT = [
  'application/pdf', '.pdf',
  'image/*',
  '.jpg', '.jpeg', '.jpe', '.jfif', '.pjpeg', '.pjp', '.png', '.apng', '.gif', '.webp', '.avif', '.bmp', '.dib',
  '.ico', '.cur', '.svg', '.tif', '.tiff', '.heic', '.heif', '.hif', '.jxl', '.jp2', '.j2k', '.jpf', '.jpx', '.jpm',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx',
  'text/plain', '.txt',
  'text/markdown', '.md', '.markdown',
].join(',')

export interface ImportResult {
  pages: StudioPage[]
  docs: Record<string, ArrayBuffer>
  errors: string[]
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * PDF chiffré (mot de passe d'ouverture ou simples restrictions, fréquent sur
 * les relevés bancaires) : repéré par la clé /Encrypt du trailer, en début
 * (PDF linéarisé) ou en fin de fichier.
 */
function isEncrypted(bytes: ArrayBuffer): boolean {
  const dec = new TextDecoder('latin1')
  const n = bytes.byteLength
  const zone = 256 * 1024
  return dec.decode(bytes.slice(Math.max(0, n - zone))).includes('/Encrypt') ||
    dec.decode(bytes.slice(0, Math.min(n, zone))).includes('/Encrypt')
}

async function pdfToPages(bytes: ArrayBuffer, name = 'document.pdf'): Promise<ImportResult> {
  const docId = newId()
  const { doc, password } = await openProtected(bytes, name, docId)
  const encrypted = !!password || isEncrypted(bytes)
  try {
    const pages: StudioPage[] = []
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1)
      const vp = page.getViewport({ scale: 1, rotation: 0 })
      pages.push({
        id: newId(),
        source: {
          kind: 'pdf', docId, pageIndex: i, width: vp.width, height: vp.height, inherentRotation: page.rotate,
          ...(encrypted ? { encrypted } : {}),
        },
        rotation: 0,
        annotations: [],
      })
    }
    return { pages, docs: { [docId]: bytes }, errors: [] }
  } finally {
    void doc.loadingTask.destroy()
  }
}

/** Ouvre un PDF depuis des octets (handoff depuis un outil). */
export function importPdfBytes(bytes: ArrayBuffer): Promise<ImportResult> {
  return pdfToPages(bytes)
}

/**
 * Convertit des fichiers hétérogènes en pages de travail, dans l'ordre donné.
 * PDF : pages vectorielles d'origine. Images/HEIC/DOCX/TXT/MD : pages rendues
 * (JPEG allégé) via le convertisseur.
 */
export async function importFiles(
  files: File[],
  onProgress?: (done: number, total: number, name: string) => void
): Promise<ImportResult> {
  const result: ImportResult = { pages: [], docs: {}, errors: [] }
  let done = 0
  for (const file of files) {
    onProgress?.(done, files.length, file.name)
    try {
      // Le contenu prime sur l'extension (fichiers mal nommés ou sans extension)
      const fmt = await sniffFormat(file)
      const isPdf = fmt === 'pdf' || (!fmt && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)))
      if (isPdf) {
        const r = await pdfToPages(await file.arrayBuffer(), file.name)
        result.pages.push(...r.pages)
        Object.assign(result.docs, r.docs)
      } else {
        const item = await convertFile(file)
        if (item.status === 'error') {
          result.errors.push(`${file.name} : ${item.error ?? 'format non pris en charge'}`)
        } else if (item.kind === 'pdf' && item.bytes) {
          // Format converti en PDF sans perte (JPEG 2000…)
          const r = await pdfToPages(item.bytes, file.name)
          result.pages.push(...r.pages)
          Object.assign(result.docs, r.docs)
        } else {
          for (const p of item.pages ?? []) {
            result.pages.push({
              id: newId(),
              source: { kind: 'image', dataUrl: await blobToDataUrl(p.blob), width: p.width, height: p.height },
              rotation: 0,
              annotations: [],
            })
          }
        }
      }
    } catch (err) {
      console.error(err)
      result.errors.push(
        err instanceof PasswordRequiredError
          ? `${file.name} : protégé par un mot de passe, non ouvert`
          : `${file.name} : fichier illisible ou endommagé`
      )
    }
    done++
  }
  onProgress?.(done, files.length, '')
  return result
}

/** Nom de document à partir d'un nom de fichier. */
export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'document'
}
