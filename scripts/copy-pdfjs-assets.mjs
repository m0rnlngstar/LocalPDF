// Copie les ressources de pdf.js (décodeurs WebAssembly JBIG2/JPEG 2000,
// CMaps, polices standard, profils ICC) dans public/pdfjs : elles sont ainsi
// servies par l'application elle-même, sans CDN. Lancé avant dev et build.
import { cpSync, mkdirSync } from 'node:fs'

const src = 'node_modules/pdfjs-dist'
const dest = 'public/pdfjs'
mkdirSync(dest, { recursive: true })
for (const dir of ['wasm', 'cmaps', 'standard_fonts', 'iccs']) {
  cpSync(`${src}/${dir}`, `${dest}/${dir}`, { recursive: true })
}
console.log('Ressources pdf.js copiées dans public/pdfjs')
