import { create } from 'zustand'
import { AnimatePresence, motion } from 'framer-motion'

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
  push: (kind, message) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 3500)
  },
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

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore()
  return (
    <div className="toast toast-end toast-bottom z-50">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60 }}
            className={`alert ${ALERT_CLASS[t.kind]} shadow-lg cursor-pointer`}
            onClick={() => dismiss(t.id)}
          >
            <span>{t.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
