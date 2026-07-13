import { useCallback, useRef, useState, type ReactNode } from 'react'

interface FileDropzoneProps {
  accept: string
  multiple?: boolean
  onFiles: (files: File[]) => void
  children?: ReactNode
  className?: string
}

/** Zone de dépôt générique : clic pour parcourir ou glisser-déposer. */
export function FileDropzone({
  accept,
  multiple = false,
  onFiles,
  children,
  className = '',
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return
      onFiles(Array.from(list))
    },
    [onFiles]
  )

  return (
    <div
      role="button"
      tabIndex={0}
      className={`border-2 border-dashed rounded-box p-8 text-center cursor-pointer transition-colors ${
        dragOver ? 'border-primary bg-primary/10' : 'border-base-300 hover:border-primary/50'
      } ${className}`}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
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
      {children ?? (
        <p className="text-base-content/60">
          Glissez-déposez vos fichiers ici, ou cliquez pour parcourir
        </p>
      )}
    </div>
  )
}
