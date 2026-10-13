import DOMPurify from 'dompurify'

/**
 * Nettoie le HTML issu de fichiers importés (Markdown, Word) avant de
 * l'insérer dans la page pour le rendu :
 * - aucun script ni gestionnaire d'événement (onerror, onload…) ;
 * - aucune ressource externe : seules les images embarquées (data:image/…)
 *   sont conservées, pour qu'un fichier ne puisse ni appeler un serveur
 *   (pixel espion, fuite d'adresse IP) ni charger du contenu distant ;
 * - pas de styles inline ni de feuilles de style (url() distantes).
 */

const SAFE_IMAGE = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i

let hooked = false

function installHooks() {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof Element) {
      if (node.tagName === 'IMG') {
        const src = node.getAttribute('src') ?? ''
        if (!SAFE_IMAGE.test(src)) node.remove()
      }
      // Liens inutiles pour un rendu en image : on ne garde que le texte
      node.removeAttribute('href')
      node.removeAttribute('target')
    }
  })
}

export function sanitizeHtml(html: string): string {
  installHooks()
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      'style', 'link', 'meta', 'base', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
      'form', 'input', 'button', 'textarea', 'select', 'option', 'video', 'audio', 'source', 'track',
      'picture', 'svg', 'math', 'template', 'noscript',
    ],
    FORBID_ATTR: ['style', 'srcset', 'background', 'poster', 'action', 'formaction', 'ping', 'xlink:href'],
    ALLOW_DATA_ATTR: false,
  })
}
