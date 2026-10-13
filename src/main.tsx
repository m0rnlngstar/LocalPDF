import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { purgeExpiredSessions } from './lib/storage'

// Travaux plus anciens que la durée de conservation choisie : supprimés
void purgeExpiredSessions().catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
