import { useCallback, useId, useRef, useState, type ReactNode } from 'react'
import { IconUpload } from './icons'

interface FileDropzoneProps {
  accept: string
  multiple?: boolean
  onFiles: (files: File[]) => void
  /** Illustration décorative (masquée aux lecteurs d'écran). */
  icon?: ReactNode
  /** Explique à quoi sert la zone vide — sert d'étiquette accessible à la section. */
  title: string
  description?: ReactNode
  /** Libellé de l'action principale. */
  actionLabel?: string
  /** Contenu additionnel sous l'action (lien d'aide, spinner…). */
  footer?: ReactNode
  className?: string
}

/**
 * Empty state + zone de dépôt : une section étiquetée qui explique pourquoi la
 * vue est vide et propose une action de récupération (choisir un fichier).
 * Toute la surface reste cliquable et accepte le glisser-déposer.
 */
export function FileDropzone({
  accept,
  multiple = false,
  onFiles,
  icon = <IconUpload />,
  title,
  description,
  actionLabel,
  footer,
  className = '',
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const [dragOver, setDragOver] = useState(false)

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return
      onFiles(Array.from(list))
    },
    [onFiles]
  )

  return (
    <section
      aria-labelledby={titleId}
      className={`border-2 border-dashed rounded-box p-8 text-center cursor-pointer transition-colors ${
        dragOver ? 'border-primary bg-primary/10' : 'border-base-300 hover:border-primary/50'
      } ${className}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        handleFiles(e.dataTransfer.files)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <div className="flex flex-col items-center gap-3">
        <div
          aria-hidden="true"
          className="grid place-items-center w-12 h-12 rounded-full bg-primary/10 text-primary"
        >
          {icon}
        </div>
        <p id={titleId} className="font-semibold">{title}</p>
        {description && <p className="text-sm text-base-content/60">{description}</p>}
        <button
          type="button"
          className="btn btn-primary btn-sm rounded-full px-5 mt-1"
          onClick={(e) => {
            e.stopPropagation()
            inputRef.current?.click()
          }}
        >
          {actionLabel ?? (multiple ? 'Choisir des fichiers' : 'Choisir un fichier')}
        </button>
        <p className="text-xs text-base-content/40">…ou glissez-déposez ici</p>
        {footer}
      </div>
    </section>
  )
}
