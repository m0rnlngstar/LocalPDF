import { useRef } from 'react'
import { IconChevronDown, IconPipette } from './icons'

/**
 * Color well façon macOS 13+ (NSColorWell, style « expanded ») : un contrôle
 * deux segments — le nuancier affiche la couleur courante et ouvre un popover
 * de nuances rapides avec pipette ; le caret ouvre le panneau de couleurs
 * complet (le sélecteur natif du navigateur).
 *
 * La pipette utilise l'API EyeDropper (équivalent web de NSColorSampler) :
 * Chromium uniquement, masquée ailleurs.
 */

declare global {
  interface Window {
    EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> }
  }
}

/** Nuances du popover rapide : neutres + teintes usuelles. */
const QUICK_COLORS = [
  '#000000', '#374151', '#6b7280', '#d1d5db', '#ffffff',
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#14b8a6', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#d946ef', '#ec4899', '#92400e', '#164e63',
]

interface ColorWellProps {
  value: string
  onChange: (hex: string) => void
  /** Libellé accessible + info-bulle du nuancier. */
  title: string
  size?: 'sm' | 'md'
  className?: string
}

export function ColorWell({ value, onChange, title, size = 'md', className = '' }: ColorWellProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const h = size === 'sm' ? 'h-6' : 'h-7'
  const w = size === 'sm' ? 'w-6' : 'w-7'

  /** Ferme le popover (dropdown daisyUI piloté par le focus). */
  function close() {
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  async function sample() {
    if (!window.EyeDropper) return
    try {
      const { sRGBHex } = await new window.EyeDropper().open()
      onChange(sRGBHex)
      close()
    } catch {
      /* sélection annulée par l'utilisateur */
    }
  }

  return (
    <div className={`inline-flex items-stretch ${h} relative ${className}`}>
      <div className="dropdown h-full">
        {/* Nuancier : affiche la couleur courante, ouvre le popover rapide */}
        <button
          type="button"
          tabIndex={0}
          className={`${w} h-full rounded-l-md border border-base-content/20 cursor-pointer`}
          style={{ backgroundColor: value }}
          title={title}
          aria-label={title}
        />
        {/* Popover rapide : grille de nuances + pipette */}
        <div
          tabIndex={0}
          className="dropdown-content z-50 mt-1.5 p-2 bg-base-100 rounded-box shadow-xl border border-base-300/50 flex flex-col gap-2"
        >
          <div className="grid grid-cols-5 gap-1">
            {QUICK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`w-5 h-5 rounded cursor-pointer hover:scale-110 transition-transform ${
                  value.toLowerCase() === c ? 'ring-2 ring-primary ring-offset-1' : 'ring-1 ring-inset ring-base-content/15'
                }`}
                style={{ backgroundColor: c }}
                title={c}
                onClick={() => {
                  onChange(c)
                  close()
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            {'EyeDropper' in window && (
              <button
                type="button"
                className="btn btn-xs btn-ghost gap-1.5 font-normal"
                onClick={() => void sample()}
              >
                <IconPipette /> Pipette
              </button>
            )}
            <span className="font-mono text-[10px] text-base-content/50 ml-auto uppercase">
              {value}
            </span>
          </div>
        </div>
      </div>
      {/* Caret : ouvre le panneau de couleurs complet (sélecteur natif) */}
      <button
        type="button"
        className="w-4 h-full rounded-r-md border border-l-0 border-base-content/20 bg-base-200 hover:bg-base-300 grid place-items-center cursor-pointer"
        title="Autres couleurs…"
        aria-label="Autres couleurs…"
        onClick={() => inputRef.current?.click()}
      >
        <span className="scale-[0.55] text-base-content/70">
          <IconChevronDown />
        </span>
      </button>
      <input
        ref={inputRef}
        type="color"
        className="absolute bottom-0 left-0 w-0 h-0 opacity-0 pointer-events-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  )
}
