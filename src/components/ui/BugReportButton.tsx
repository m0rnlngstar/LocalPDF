const BUG_EMAIL = 'h.dupuis@co-pilotes.com'

/**
 * Ouvre la messagerie avec un e-mail de signalement prérempli. Volontairement,
 * rien du document ouvert (nom, contenu) n'est inclus : seulement le
 * navigateur, pour aider à reproduire le problème.
 */
function bugMailto(): string {
  const subject = 'LocalPDF – signalement de bug'
  const body = [
    'Bonjour,',
    '',
    'Ce qui ne fonctionne pas :',
    '',
    '',
    'Ce que je faisais juste avant (étapes) :',
    '1. ',
    '2. ',
    '',
    'Ce que j’attendais :',
    '',
    '',
    '(Ajoutez une capture d’écran si possible. Évitez de joindre un document client.)',
    '',
    '---',
    `Navigateur : ${navigator.userAgent}`,
    `Page : ${location.origin}${location.pathname}`,
  ].join('\n')
  return `mailto:${BUG_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** Bouton flottant en bas à droite, présent sur tous les écrans. */
export function BugReportButton() {
  return (
    <a
      href="#"
      className="bug-fab"
      title={`Signaler un problème à ${BUG_EMAIL}`}
      // Lien construit au clic : navigateur et adresse à jour
      onClick={(e) => {
        e.preventDefault()
        window.location.href = bugMailto()
      }}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m8 2 1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 1 1 6 0v1.1" />
        <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6ZM12 20v-9" />
        <path d="M6.5 13H3M21 13h-3.5M6 17l-2.5 2M18 17l2.5 2M6 9 3.5 7M18 9l2.5-2" />
      </svg>
      <span>Un problème ? Un bug ?</span>
    </a>
  )
}
