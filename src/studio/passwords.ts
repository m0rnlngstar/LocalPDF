import { askPassword } from '../components/ui/PasswordPrompt'
import { isPasswordError, openPdf, type PdfJsDocument } from '../lib/pdfjs'

/**
 * Mots de passe des PDF protégés : gardés en MÉMOIRE uniquement (jamais dans
 * IndexedDB). Après un rechargement, le mot de passe est redemandé.
 */
const passwords = new Map<string, string>()

export function rememberPassword(docId: string, password: string) {
  passwords.set(docId, password)
}

/**
 * Ouvre un PDF, en demandant le mot de passe s'il est protégé (3 essais).
 * Rejette si l'utilisateur annule.
 */
export async function openProtected(bytes: ArrayBuffer, name: string, docId?: string): Promise<{ doc: PdfJsDocument; password?: string }> {
  const known = docId ? passwords.get(docId) : undefined
  try {
    return { doc: await openPdf(bytes, known), password: known }
  } catch (err) {
    if (!isPasswordError(err)) throw err
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const password = await askPassword({
      title: 'Document protégé',
      message: `« ${name} » est protégé par un mot de passe. Saisissez-le pour l’ouvrir.`,
      error: attempt > 0,
    })
    if (password === null) break
    try {
      const doc = await openPdf(bytes, password)
      if (docId) rememberPassword(docId, password)
      return { doc, password }
    } catch (err) {
      if (!isPasswordError(err)) throw err
    }
  }
  throw new PasswordRequiredError()
}

export class PasswordRequiredError extends Error {
  constructor() {
    super('mot de passe requis')
  }
}
