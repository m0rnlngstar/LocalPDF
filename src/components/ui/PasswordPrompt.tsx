import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'

/**
 * Saisie de mot de passe dans un champ masqué (remplace window.prompt, qui
 * affiche le mot de passe en clair — gênant en partage d'écran).
 */

interface Request {
  title: string
  message: string
  error?: boolean
  resolve: (password: string | null) => void
}

const usePrompt = create<{ request: Request | null }>(() => ({ request: null }))

/** Demande un mot de passe ; null si l'utilisateur annule. */
export function askPassword(opts: { title: string; message: string; error?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    // Une seule demande à la fois : la précédente est annulée
    usePrompt.getState().request?.resolve(null)
    usePrompt.setState({ request: { ...opts, resolve } })
  })
}

export function PasswordPrompt() {
  const request = usePrompt((s) => s.request)
  const ref = useRef<HTMLDialogElement>(null)
  const [value, setValue] = useState('')

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (request && !d.open) {
      setValue('')
      d.showModal()
    }
    if (!request && d.open) d.close()
  }, [request])

  function finish(password: string | null) {
    const r = usePrompt.getState().request
    usePrompt.setState({ request: null })
    setValue('')
    r?.resolve(password)
  }

  return (
    <dialog ref={ref} className="modal" onCancel={(e) => { e.preventDefault(); finish(null) }}>
      <form
        className="modal-box max-w-md"
        onSubmit={(e) => {
          e.preventDefault()
          finish(value)
        }}
      >
        <h3 className="font-semibold text-lg mb-2">{request?.title}</h3>
        <p className="text-sm mb-3">{request?.message}</p>
        {request?.error && <p className="text-sm text-error mb-2">Mot de passe incorrect, réessayez.</p>}
        <input
          type="password"
          className="input input-bordered w-full"
          autoFocus
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Mot de passe"
        />
        <p className="text-xs opacity-60 mt-2">Le mot de passe reste en mémoire le temps de la session ; il n’est jamais enregistré.</p>
        <div className="modal-action">
          <button type="button" className="btn btn-ghost rounded-full" onClick={() => finish(null)}>Annuler</button>
          <button type="submit" className="btn btn-primary rounded-full" disabled={!value}>Ouvrir</button>
        </div>
      </form>
    </dialog>
  )
}
