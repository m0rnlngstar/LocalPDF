import { useState } from 'react'
import { compressPdf, COMPRESS_LEVELS, type CompressLevel } from './compress'
import { downloadBytes } from '../create/exportPdf'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { toast } from '../../components/ui/Toast'
import { IconDownload, IconFilePlus, IconX } from '../../components/ui/icons'

interface Source {
  name: string
  bytes: ArrayBuffer
}

interface Result {
  bytes: Uint8Array
  originalSize: number
  compressedSize: number
  imagesTotal: number
  imagesCompressed: number
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`
}

const LEVEL_OPTIONS = (Object.keys(COMPRESS_LEVELS) as CompressLevel[]).map((v) => ({
  value: v,
  label: COMPRESS_LEVELS[v].label,
  title: COMPRESS_LEVELS[v].desc,
}))

export default function CompressModule() {
  const [source, setSource] = useState<Source | null>(null)
  const [level, setLevel] = useState<CompressLevel>('medium')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  async function handleFiles(files: File[]) {
    const file = files[0]
    if (!file) return
    const bytes = await file.arrayBuffer()
    setSource({ name: file.name.replace(/\.pdf$/i, ''), bytes })
    setResult(null)
    void runCompress(bytes, level)
  }

  async function runCompress(bytes: ArrayBuffer, lvl: CompressLevel) {
    setRunning(true)
    setProgress(null)
    setResult(null)
    try {
      const { bytes: outBytes, stats } = await compressPdf(bytes, lvl, (done, total) =>
        setProgress({ done, total })
      )
      setResult({
        bytes: outBytes,
        originalSize: stats.originalSize,
        compressedSize: outBytes.byteLength,
        imagesTotal: stats.imagesTotal,
        imagesCompressed: stats.imagesCompressed,
      })
      if (stats.imagesTotal === 0) {
        toast.info('Aucune image JPEG à compresser dans ce PDF')
      } else {
        toast.success('PDF compressé !')
      }
    } catch (err) {
      console.error(err)
      toast.error('Échec de la compression')
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  function handleExport() {
    if (!result || !source) return
    downloadBytes(result.bytes, `${source.name}-compresse.pdf`)
    toast.success('PDF exporté !')
  }

  function reset() {
    setSource(null)
    setResult(null)
  }

  if (!source) {
    return (
      <div className="max-w-xl mx-auto mt-6 sm:mt-16 flex flex-col gap-3">
        <FileDropzone
          accept="application/pdf"
          onFiles={(files) => void handleFiles(files)}
          className="bg-base-100 shadow-xl py-16"
          title="Déposez un PDF à compresser"
          description="Les images sont ré-encodées dans votre navigateur, rien n'est envoyé sur un serveur"
        />
        <div className="card bg-base-100 border border-base-300/50 shadow-sm">
          <div className="card-body p-3 gap-2">
            <span className="text-sm font-medium">Niveau de compression</span>
            <SegmentedControl
              ariaLabel="Niveau de compression"
              options={LEVEL_OPTIONS}
              value={level}
              onChange={setLevel}
            />
            <span className="text-xs text-base-content/50">{COMPRESS_LEVELS[level].desc}</span>
          </div>
        </div>
      </div>
    )
  }

  const savedPct =
    result && result.originalSize > 0
      ? Math.round((1 - result.compressedSize / result.originalSize) * 100)
      : null

  return (
    <div className="max-w-xl mx-auto mt-6 sm:mt-10 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium truncate">{source.name}.pdf</span>
        <div className="ml-auto flex gap-2">
          <button className="btn btn-sm btn-ghost rounded-full gap-1" onClick={reset}>
            <IconX /> Fermer
          </button>
        </div>
      </div>

      <div className="card bg-base-100 border border-base-300/50 shadow-sm">
        <div className="card-body p-3 gap-2">
          <span className="text-sm font-medium">Niveau de compression</span>
          <SegmentedControl
            ariaLabel="Niveau de compression"
            options={LEVEL_OPTIONS}
            value={level}
            onChange={(v) => {
              setLevel(v)
              void runCompress(source.bytes, v)
            }}
          />
          <span className="text-xs text-base-content/50">{COMPRESS_LEVELS[level].desc}</span>
        </div>
      </div>

      {running && (
        <div className="card bg-base-100 border border-base-300/50 shadow-sm">
          <div className="card-body p-3 gap-2">
            <div className="flex justify-between text-sm">
              <span>Compression en cours…</span>
              {progress && progress.total > 0 && (
                <span className="font-mono">{progress.done} / {progress.total} images</span>
              )}
            </div>
            <progress
              className="progress progress-primary w-full"
              value={progress?.total ? progress.done : undefined}
              max={progress?.total || undefined}
            />
          </div>
        </div>
      )}

      {result && !running && (
        <div className="card bg-base-100 border border-base-300/50 shadow-sm">
          <div className="card-body p-4 gap-3">
            <div className="flex items-center justify-between gap-4">
              <div className="text-center">
                <p className="text-xs text-base-content/50">Avant</p>
                <p className="font-mono text-lg">{formatSize(result.originalSize)}</p>
              </div>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" className="w-6 h-6 text-base-content/40 shrink-0" aria-hidden="true">
                <path d="M4 10h12M11 5l5 5-5 5" />
              </svg>
              <div className="text-center">
                <p className="text-xs text-base-content/50">Après</p>
                <p className="font-mono text-lg text-primary">{formatSize(result.compressedSize)}</p>
              </div>
            </div>
            {savedPct !== null && savedPct > 0 && (
              <div className="badge badge-success badge-soft mx-auto">-{savedPct}% de poids</div>
            )}
            {savedPct !== null && savedPct <= 0 && (
              <p className="text-xs text-base-content/50 text-center">
                Ce PDF était déjà bien compressé, gain négligeable.
              </p>
            )}
            <p className="text-xs text-base-content/50 text-center">
              {result.imagesCompressed} / {result.imagesTotal} image{result.imagesTotal > 1 ? 's' : ''} JPEG recompressée{result.imagesCompressed > 1 ? 's' : ''}
            </p>
            <button className="btn btn-primary rounded-full shadow-md gap-1.5" onClick={handleExport}>
              <IconDownload /> Télécharger le PDF compressé
            </button>
          </div>
        </div>
      )}

      <FileDropzone
        accept="application/pdf"
        onFiles={(files) => void handleFiles(files)}
        className="bg-base-100/50"
        icon={<IconFilePlus />}
        title="Compresser un autre PDF"
        actionLabel="Choisir un fichier"
      />
    </div>
  )
}
