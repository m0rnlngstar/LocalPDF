import { Fragment, useRef } from 'react'

/**
 * Segmented control façon macOS (NSSegmentedControl) : une rangée de boutons
 * connectés dans une piste creusée, le segment sélectionné reçoit un
 * remplissage persistant, et les séparateurs adjacents à la sélection sont
 * masqués.
 *
 * - `SegmentedControl` : sélection unique persistante (radiogroup, flèches).
 * - `SegmentedButtons` : suivi « multiple » (toggles indépendants, aria-pressed)
 *   ou « momentané » (actions sans état) selon que `pressed` est fourni.
 */

export interface SegmentOption<T extends string> {
  value: T
  /** Contenu du segment (texte ou icône). */
  label: React.ReactNode
  /** Info-bulle et libellé accessible (indispensable pour un segment-icône). */
  title?: string
  disabled?: boolean
}

const trackCls =
  'inline-flex items-center rounded-lg bg-base-200 border border-base-300/40 p-0.5'

function segmentCls(selected: boolean) {
  return [
    'flex items-center justify-center gap-1.5 rounded-[7px] px-2.5 h-7 min-w-7',
    'text-sm font-medium select-none cursor-pointer transition-colors',
    'disabled:opacity-35 disabled:cursor-default',
    selected
      ? 'bg-base-100 text-base-content shadow-sm'
      : 'text-base-content/60 hover:text-base-content active:bg-base-100/50',
  ].join(' ')
}

function Divider({ hidden }: { hidden: boolean }) {
  return (
    <span
      aria-hidden
      className={`w-px h-4 shrink-0 transition-colors ${
        hidden ? 'bg-transparent' : 'bg-base-content/15'
      }`}
    />
  )
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
  className?: string
}) {
  const groupRef = useRef<HTMLDivElement>(null)

  // Flèches ← → : déplacent la sélection (comportement standard d'un radiogroup)
  function onKeyDown(e: React.KeyboardEvent) {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const enabled = options.filter((o) => !o.disabled)
    const i = enabled.findIndex((o) => o.value === value)
    const next = enabled[(i + dir + enabled.length) % enabled.length]
    if (!next || next.value === value) return
    onChange(next.value)
    // Roving tabindex : le focus suit le segment nouvellement sélectionné
    requestAnimationFrame(() => {
      groupRef.current
        ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
        ?.focus()
    })
  }

  const selectedIdx = options.findIndex((o) => o.value === value)
  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={`${trackCls} ${className}`}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => (
        <Fragment key={o.value}>
          {i > 0 && <Divider hidden={i === selectedIdx || i - 1 === selectedIdx} />}
          <button
            type="button"
            role="radio"
            aria-checked={o.value === value}
            tabIndex={o.value === value ? 0 : -1}
            title={o.title}
            aria-label={o.title}
            disabled={o.disabled}
            className={segmentCls(o.value === value)}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        </Fragment>
      ))}
    </div>
  )
}

export interface SegmentButton {
  key: string
  label: React.ReactNode
  title?: string
  disabled?: boolean
  /** true/false = segment à état (aria-pressed) ; absent = action momentanée. */
  pressed?: boolean
  onClick: () => void
}

export function SegmentedButtons({
  items,
  ariaLabel,
  className = '',
}: {
  items: SegmentButton[]
  ariaLabel: string
  className?: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={`${trackCls} ${className}`}>
      {items.map((it, i) => (
        <Fragment key={it.key}>
          {i > 0 && <Divider hidden={!!it.pressed || !!items[i - 1].pressed} />}
          <button
            type="button"
            aria-pressed={it.pressed}
            title={it.title}
            aria-label={it.title}
            disabled={it.disabled}
            className={segmentCls(!!it.pressed)}
            onClick={it.onClick}
          >
            {it.label}
          </button>
        </Fragment>
      ))}
    </div>
  )
}
