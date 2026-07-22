/**
 * userParts — persistence for Parts-Editor-authored parts (B7).
 *
 * Custom parts used to live only in the in-memory registry (`registerPart`)
 * and vanished on reload. They now persist in IndexedDB, which works in both
 * the Electron renderer (stored under the app's userData) and the web build —
 * one implementation, no main-process IPC. localStorage is the fallback for
 * environments without IndexedDB (old WebViews, some test runners).
 *
 * Usage:
 *   - `initUserParts()` — idempotent; loads every saved part into the live
 *     registry. Call before first geometry pass (CircuitView / DiagramEditor
 *     mount). Resolves with the number of parts restored.
 *   - `saveUserPart(def)` — registers AND persists (the Parts Editor save path).
 *   - `deleteUserPart(type)` — removes from storage (registry entries survive
 *     until reload; the doc may still reference the type).
 */

import { registerPart, type PartDef } from './partsLibrary'

const DB_NAME = 'tinystudio-user-parts'
const STORE = 'parts'
const LS_KEY = 'tinystudio.userParts'

function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'type' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'))
  })
}

async function idbGetAll(): Promise<PartDef[]> {
  const db = await openDb()
  try {
    return await new Promise<PartDef[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      req.onsuccess = () => resolve((req.result ?? []) as PartDef[])
      req.onerror = () => reject(req.error ?? new Error('getAll failed'))
    })
  } finally {
    db.close()
  }
}

async function idbPut(def: PartDef): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(def)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('put failed'))
    })
  } finally {
    db.close()
  }
}

async function idbDelete(type: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(type)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('delete failed'))
    })
  } finally {
    db.close()
  }
}

// ── localStorage fallback ────────────────────────────────────────────────────

function lsRead(): PartDef[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as PartDef[]) : []
  } catch {
    return []
  }
}

function lsWrite(defs: PartDef[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(defs))
  } catch {
    /* quota / privacy mode — parts stay session-only */
  }
}

// ── public API ───────────────────────────────────────────────────────────────

let initPromise: Promise<number> | null = null

/** Load all persisted user parts into the live registry (idempotent). */
export function initUserParts(): Promise<number> {
  if (!initPromise) {
    initPromise = (async () => {
      let defs: PartDef[] = []
      if (idbAvailable()) {
        try {
          defs = await idbGetAll()
        } catch {
          defs = lsRead()
        }
      } else {
        defs = lsRead()
      }
      for (const def of defs) {
        if (def && typeof def.type === 'string' && def.views) registerPart(def)
      }
      return defs.length
    })()
  }
  return initPromise
}

/** Register a part into the live registry and persist it. */
export async function saveUserPart(def: PartDef): Promise<void> {
  registerPart(def)
  if (idbAvailable()) {
    try {
      await idbPut(def)
      return
    } catch {
      /* fall through to localStorage */
    }
  }
  const defs = lsRead().filter((d) => d.type !== def.type)
  defs.push(def)
  lsWrite(defs)
}

/** Remove a part from persistent storage. */
export async function deleteUserPart(type: string): Promise<void> {
  if (idbAvailable()) {
    try {
      await idbDelete(type)
      return
    } catch {
      /* fall through */
    }
  }
  lsWrite(lsRead().filter((d) => d.type !== type))
}
