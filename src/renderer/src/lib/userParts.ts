/**
 * userParts — parts saved on THIS computer: the registry's top (user) layer.
 *
 *   - local edits: a Parts Editor save of a part that ships in a pack. It
 *     shadows the shipped part here only; "Reset to default" deletes it and
 *     the pack's version (including any later updates) shows again.
 *   - imports: parts made from scratch in the Parts Editor or dropped in as
 *     .fzpz — nothing else supplies them.
 *
 * Nothing here is ever uploaded. Stored in IndexedDB (in the desktop app that
 * lives in Electron's userData folder; the web build uses the browser's), with
 * localStorage as the fallback where IndexedDB is missing.
 *
 * Usage:
 *   - `initUserParts()` — idempotent; loads every saved part into the registry.
 *     Call after the pack layers are registered (see parts/partsBoot.ts).
 *   - `saveUserPart(def)` — registers AND persists.
 *   - `resetUserPart(type)` — deletes the local copy; the shipped part returns.
 */

import { artPrefix, namespaceSvg } from '../circuit/parts/svgArt'
import { partLayers, registerPart, unregisterPart, type PartDef } from './partsLibrary'

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

/** types persisted here (generated breadboards are registered but never stored) */
const stored = new Map<string, 'edit' | 'import'>()
/** saved by a build that didn't record why — resolved once packs have loaded */
const legacy = new Set<string>()

/** Does any pack layer (bundled / remote / dev) ship this type? */
const shipped = (type: string): boolean => partLayers(type).some((l) => l.layer !== 'user')

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
      let n = 0
      for (const def of defs) {
        if (!def || typeof def.type !== 'string' || !def.views) continue
        if (!def.origin) legacy.add(def.type)
        stored.set(def.type, def.origin ?? 'import')
        // saves from before per-file art prefixes gave the icon its views' prefix,
        // so its <style> repainted the part on the canvas — re-prefix it on load
        const icon = def.icon && namespaceSvg(def.icon, artPrefix(def.type, 'icon'))
        registerPart({ ...def, icon, source: { ...def.source, layer: 'user' } })
        n++
      }
      await adoptLegacyCopies()
      return n
    })()
  }
  return initPromise
}

/**
 * Older builds installed packs by copying every part in here, where it could
 * never update. Once a pack layer supplies the same type, drop that copy so the
 * pack serves (and keeps serving updates). Safe to call repeatedly.
 */
export async function adoptLegacyCopies(): Promise<string[]> {
  const dropped: string[] = []
  for (const type of [...legacy]) {
    if (!shipped(type)) continue
    legacy.delete(type)
    dropped.push(type)
    await resetUserPart(type)
  }
  return dropped
}

/**
 * Register a part into the live registry and persist it. A part that ships in
 * a pack is saved as a local edit; anything else as an import.
 */
export async function saveUserPart(raw: PartDef): Promise<void> {
  const origin = raw.origin ?? (shipped(raw.type) ? 'edit' : 'import')
  const def: PartDef = {
    ...raw,
    origin,
    // keep where it came from (the Parts Editor can save it back there), drop
    // load-time diagnostics and machine-specific paths
    source: raw.source
      ? { ...raw.source, layer: 'user', warnings: undefined, absDir: undefined }
      : { layer: 'user' }
  }
  stored.set(def.type, origin)
  legacy.delete(def.type)
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

/** Remove a part from persistent storage (the registry keeps it until reload). */
export async function deleteUserPart(type: string): Promise<void> {
  stored.delete(type)
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

/** Throw away this computer's copy of a part; whatever ships takes over again. */
export async function resetUserPart(type: string): Promise<void> {
  await deleteUserPart(type)
  unregisterPart(type, 'user')
}

/** Is `type` showing a local edit on top of a shipped part? */
export function isLocalEdit(type: string): boolean {
  return stored.has(type) && shipped(type)
}

/** Every type with a local edit shadowing a shipped part. */
export function localEdits(): string[] {
  return [...stored.keys()].filter((t) => shipped(t))
}
