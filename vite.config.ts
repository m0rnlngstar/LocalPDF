import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Politique de sécurité du contenu (CSP) du site publié. GitHub Pages ne
 * permet pas d'en-têtes HTTP : elle est posée en balise <meta> au build
 * (pas en développement, où Vite injecte des scripts en ligne).
 * - aucune connexion vers un autre domaine : un document piégé ne peut rien
 *   exfiltrer, même en cas de faille d'affichage ;
 * - 'wasm-unsafe-eval' : moteurs WebAssembly locaux (pdf.js, OCR, HEIC, OpenCV).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' data: blob:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'self' blob:",
  "manifest-src 'self'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'localpdf-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
    ],
  }
}

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages sert le site sous /LocalPDF/ : le workflow de déploiement
  // passe BASE_PATH ; en local, racine classique.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  server: {
    // Accès via `tailscale serve` (HTTPS requis pour WebGPU hors localhost)
    allowedHosts: ['.ts.net'],
  },
})
