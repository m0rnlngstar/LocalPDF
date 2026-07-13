import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages sert le site sous /LocalPDF/ : le workflow de déploiement
  // passe BASE_PATH ; en local, racine classique.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  server: {
    // Accès via `tailscale serve` (HTTPS requis pour WebGPU hors localhost)
    allowedHosts: ['.ts.net'],
  },
})
