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
      className={`file-dropzone ${dragOver ? 'is-dragging' : ''} ${className}`}
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
      <span className="dropzone-glow" aria-hidden="true" />
      <div className="dropzone-content">
        <div
          aria-hidden="true"
          className="dropzone-icon"
        >
          {icon}
        </div>
        <div>
          <p id={titleId} className="dropzone-title">{title}</p>
          {description && <p className="dropzone-description">{description}</p>}
        </div>
        <button
          type="button"
          className="btn btn-primary dropzone-action"
          onClick={(e) => {
            e.stopPropagation()
            inputRef.current?.click()
          }}
        >
          <IconUpload />
          {actionLabel ?? (multiple ? 'Choisir des fichiers' : 'Choisir un fichier')}
        </button>
        <p className="dropzone-hint"><span /> ou glissez-déposez ici <span /></p>
        {footer && <div className="dropzone-footer">{footer}</div>}
      </div>
    </section>
  )
}
