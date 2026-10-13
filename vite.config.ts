import { readFileSync } from 'node:fs'
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

/** Interrupteur unique : src/lib/features.ts (AI_ENABLED). */
const AI_ENABLED = /export const AI_ENABLED\s*=\s*true/.test(readFileSync('src/lib/features.ts', 'utf8'))

/**
 * IA désactivée : le moteur (src/lib/llm.ts) est remplacé par sa version
 * vide. WebLLM, transformers.js et leurs workers ne sont alors pas livrés.
 */
function withoutAi(): Plugin {
  return {
    name: 'localpdf-no-ai',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (AI_ENABLED || !/(^|\/)llm(\.ts)?$/.test(source)) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      const id = resolved?.id.replace(/\\/g, '/')
      return id?.endsWith('/src/lib/llm.ts') ? id.replace(/llm\.ts$/, 'llm.disabled.ts') : null
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages sert le site sous /LocalPDF/ : le workflow de déploiement
  // passe BASE_PATH ; en local, racine classique.
  base: process.env.BASE_PATH ?? '/',
  plugins: [withoutAi(), react(), tailwindcss(), contentSecurityPolicy()],
  server: {
    // Accès via `tailscale serve` (HTTPS requis pour WebGPU hors localhost)
    allowedHosts: ['.ts.net'],
  },
})
