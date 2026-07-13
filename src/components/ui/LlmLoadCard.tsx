import { useEffect, useState } from 'react'
import type { LlmLoadProgress } from '../../lib/llm'
import { IconDownload } from './icons'

export function formatSpeed(mbps: number): string {
  if (mbps < 1) return `${Math.max(1, Math.round(mbps * 1024))} Ko/s`
  return `${mbps.toFixed(1).replace('.', ',')} Mo/s`
}

export function formatSize(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(2).replace('.', ',')} Go` : `${Math.round(mb)} Mo`
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}

/**
 * Carte de téléchargement / préparation du modèle IA : barre de progression
 * linéaire déterminée, chrono, vitesse et estimation du temps restant.
 * (Pendant la compilation GPU la durée est inconnue → barre indéterminée.)
 */
export function LlmLoadCard({ load, footnote }: { load: LlmLoadProgress; footnote?: string }) {
  // Chrono : re-rendu chaque seconde, même sans callback de progression
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const pct = Math.round(load.progress * 100)
  const elapsed = (Date.now() - load.startedAt) / 1000
  const isGpu = load.phase === 'gpu'
  const title = isGpu
    ? 'Préparation du modèle (compilation GPU)…'
    : load.phase === 'cache'
      ? 'Chargement du modèle depuis le cache…'
      : 'Téléchargement du modèle IA…'

  return (
    <div className="card bg-base-100 border border-base-300/50 shadow-sm">
      <div className="card-body p-4 gap-3">
        <div className="flex items-center gap-3">
          <div className="grid place-items-center w-9 h-9 rounded-full bg-secondary/10 text-secondary shrink-0">
            {isGpu ? <span className="loading loading-spinner loading-sm" /> : <IconDownload />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{title}</p>
            <p className="text-xs text-base-content/50">
              Une seule fois — ensuite mis en cache par le navigateur
            </p>
          </div>
          <span className="font-mono text-lg font-semibold tabular-nums">{pct}%</span>
        </div>
        <progress
          className="progress progress-secondary w-full h-1.5"
          value={isGpu ? undefined : pct}
          max={100}
          aria-label="Chargement du modèle IA"
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/60 font-mono tabular-nums">
          <span>⏱ {formatDuration(elapsed)}</span>
          {load.speedMBps !== null && <span>↓ {formatSpeed(load.speedMBps)}</span>}
          {load.fetchedMB !== null && (
            <span>{formatSize(load.fetchedMB)} {load.phase === 'cache' ? 'lus' : 'reçus'}</span>
          )}
          {!isGpu && load.etaSec !== null && (
            <span className="ml-auto">encore ≈ {formatDuration(load.etaSec)}</span>
          )}
        </div>
        {footnote && <p className="text-xs text-base-content/40">{footnote}</p>}
      </div>
    </div>
  )
}
