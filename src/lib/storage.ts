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

/* ------------------------------------------------------------------------- */
/* Durée de conservation des travaux sur ce poste                              */
/* ------------------------------------------------------------------------- */

const RETENTION_KEY = 'localpdf-retention-days'
/** Choix proposés : 0 = rien n'est conservé (fermer l'onglet efface tout). */
export const RETENTION_CHOICES = [0, 1, 7, 30] as const
const DEFAULT_RETENTION_DAYS = 7

export function getRetentionDays(): number {
  try {
    const v = localStorage.getItem(RETENTION_KEY)
    return v === null ? DEFAULT_RETENTION_DAYS : Math.max(0, Number(v) || 0)
  } catch {
    return DEFAULT_RETENTION_DAYS
  }
}

export async function setRetentionDays(days: number): Promise<void> {
  try {
    localStorage.setItem(RETENTION_KEY, String(days))
  } catch {
    // préférence non mémorisée
  }
  if (days === 0) await clearAllSessions()
  else await purgeExpiredSessions()
}

/** Enveloppe datée : permet d'expirer les sessions anciennes. */
interface Stored {
  __savedAt: number
  value: unknown
}

function isStored(v: unknown): v is Stored {
  return !!v && typeof v === 'object' && '__savedAt' in v && 'value' in v
}

function expired(savedAt: number): boolean {
  const days = getRetentionDays()
  return days === 0 || Date.now() - savedAt > days * 24 * 3600 * 1000
}

export async function saveSession(key: string, value: unknown): Promise<void> {
  const db = await getDb()
  // Conservation désactivée : rien n'est écrit sur le disque
  if (getRetentionDays() === 0) {
    await db.delete('sessions', key)
    return
  }
  await db.put('sessions', { __savedAt: Date.now(), value } satisfies Stored, key)
}

export async function loadSession<T>(key: string): Promise<T | undefined> {
  const db = await getDb()
  const raw = await db.get('sessions', key)
  if (raw === undefined) return undefined
  // Anciennes sessions (sans date) : conservées une dernière fois, redatées au prochain enregistrement
  if (!isStored(raw)) return raw as T
  if (expired(raw.__savedAt)) {
    await db.delete('sessions', key)
    return undefined
  }
  return raw.value as T
}

/** Supprime les sessions dont la durée de conservation est dépassée (au démarrage). */
export async function purgeExpiredSessions(): Promise<void> {
  const db = await getDb()
  if (getRetentionDays() === 0) {
    await db.clear('sessions')
    return
  }
  for (const key of await db.getAllKeys('sessions')) {
    const raw = await db.get('sessions', key)
    if (isStored(raw) && expired(raw.__savedAt)) await db.delete('sessions', key)
  }
}

export async function clearSession(key: string): Promise<void> {
  const db = await getDb()
  await db.delete('sessions', key)
}

/** Supprime les sessions de tous les modules (fichiers en cours, pages converties…). */
export async function clearAllSessions(): Promise<void> {
  const db = await getDb()
  await db.clear('sessions')
}

/**
 * Vide le cache de travail puis recharge la page, pour purger aussi les états
 * déjà chargés en mémoire. Les préférences (thème, options) sont conservées.
 */
export async function clearCacheAndReload(): Promise<void> {
  await clearAllSessions()
  window.location.reload()
}

/** Sauvegarde débouncée pour ne pas marteler IndexedDB à chaque frappe/drag. */
export function debouncedSaver(key: string, delayMs = 800) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (value: unknown) => {
    clearTimeout(timer)
    timer = setTimeout(() => void saveSession(key, value), delayMs)
  }
}
