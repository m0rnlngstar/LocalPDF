import { useRef, type ReactNode } from 'react'
import { IconInfo } from './icons'

interface InfoDialogProps {
  title: string
  children: ReactNode
  /** Classes du bouton déclencheur (par défaut : petit bouton rond discret). */
  buttonClassName?: string
}

/**
 * Bouton « i » qui ouvre une modale d'aide décrivant le fonctionnement
 * d'un module. Le contenu est du JSX libre (sections, tableaux…).
 */
export function InfoDialog({
  title,
  children,
  buttonClassName = 'btn btn-xs btn-circle btn-ghost text-info',
}: InfoDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        title="Comment ça marche ?"
        aria-label="Comment ça marche ?"
        onClick={(e) => {
          e.stopPropagation()
          ref.current?.showModal()
        }}
      >
        <IconInfo />
      </button>
      <dialog ref={ref} className="modal">
        <div className="modal-box max-w-2xl text-left">
          <form method="dialog">
            <button className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" aria-label="Fermer">
              ✕
            </button>
          </form>
          <h3 className="font-bold text-lg mb-3">{title}</h3>
          <div className="flex flex-col gap-3 text-sm leading-relaxed">{children}</div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button aria-label="Fermer">fermer</button>
        </form>
      </dialog>
    </>
  )
}
