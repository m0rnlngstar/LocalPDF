import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

/**
 * Persistance de session via IndexedDB : rien ne quitte jamais le navigateur.
 * Chaque module stocke son état de travail sous une clé dédiée, pour survivre
 * à une fermeture d'onglet accidentelle.
 */

interface PdfToolkitDB extends DBSchema {
  sessions: {
    key: string
    value: unknown
  }
}

let dbPromise: Promise<IDBPDatabase<PdfToolkitDB>> | null = null

function getDb() {
  dbPromise ??= openDB<PdfToolkitDB>('pdf-toolkit', 1, {
    upgrade(db) {
      db.createObjectStore('sessions')
    },
  })
  return dbPromise
}

export async function saveSession(key: string, value: unknown): Promise<void> {
  const db = await getDb()
  await db.put('sessions', value, key)
}

export async function loadSession<T>(key: string): Promise<T | undefined> {
  const db = await getDb()
  return (await db.get('sessions', key)) as T | undefined
}

export async function clearSession(key: string): Promise<void> {
  const db = await getDb()
  await db.delete('sessions', key)
}

/** Sauvegarde débouncée pour ne pas marteler IndexedDB à chaque frappe/drag. */
export function debouncedSaver(key: string, delayMs = 800) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (value: unknown) => {
    clearTimeout(timer)
    timer = setTimeout(() => void saveSession(key, value), delayMs)
  }
}
