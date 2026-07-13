import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { AnimatePresence, motion } from 'framer-motion'
import { IconAlertTriangle, IconCheck, IconInfo } from './icons'

type ToastKind = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

interface ToastState {
  toasts: ToastItem[]
  push: (kind: ToastKind, message: string) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  // L'auto-fermeture est gérée par ToastCard (le timer doit pouvoir se mettre
  // en pause au survol / focus), pas ici.
  push: (kind, message) =>
    set((s) => ({ toasts: [...s.toasts, { id: nextId++, kind, message }] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const toast = {
  success: (m: string) => useToastStore.getState().push('success', m),
  error: (m: string) => useToastStore.getState().push('error', m),
  info: (m: string) => useToastStore.getState().push('info', m),
}

const ALERT_CLASS: Record<ToastKind, string> = {
  success: 'alert-success',
  error: 'alert-error',
  info: 'alert-info',
}

const ALERT_ICON: Record<ToastKind, React.ReactNode> = {
  success: <IconCheck />,
  error: <IconAlertTriangle />,
  info: <IconInfo />,
}

/** Les erreurs restent affichées plus longtemps que les simples confirmations. */
const DURATION: Record<ToastKind, number> = {
  success: 3500,
  info: 3500,
  error: 6000,
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  // Timer d'auto-fermeture avec pause au survol / focus clavier : on mémorise
  // le temps restant à chaque pause plutôt qu'une échéance fixe.
  const remaining = useRef(DURATION[item.kind])
  const startedAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  function run() {
    startedAt.current = Date.now()
    timer.current = setTimeout(() => dismissRef.current(), remaining.current)
  }
  function pause() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current))
  }

  useEffect(() => {
    run()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 28 }}
      className={`alert ${ALERT_CLASS[item.kind]} shadow-lg cursor-pointer select-none`}
      tabIndex={0}
      onMouseEnter={pause}
      onMouseLeave={run}
      onFocus={pause}
      onBlur={run}
      onClick={onDismiss}
      onKeyDown={(e) => (e.key === 'Escape' || e.key === 'Enter') && onDismiss()}
    >
      {ALERT_ICON[item.kind]}
      <span>{item.message}</span>
    </motion.div>
  )
}

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore()
  return (
    // Région live persistante : les messages insérés sont annoncés aux
    // lecteurs d'écran sans déplacer le focus.
    <div role="status" aria-live="polite" className="toast toast-end toast-bottom z-50">
      <AnimatePresence>
        {toasts.map((t) => (
          <ToastCard key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </AnimatePresence>
    </div>
  )
}
