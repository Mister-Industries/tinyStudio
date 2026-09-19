/**
 * circuit/parts/partsCache: packs downloaded from tinyparts, kept on this
 * computer so they load offline and only changed files are ever re-fetched.
 *
 * Stored in IndexedDB (`tinystudio-parts-cache`), which in the desktop app sits
 * inside Electron's userData folder; the web build uses the browser's. Falls
 * back to memory where IndexedDB doesn't exist (tests, locked-down WebViews).
 * Nothing here is user-authored; clearing it just means a re-download.
 */

export type PackOrigin =
  | { kind: 'github'; repo: string; ref: string; commit: string }
  | { kind: 'url'; url: string }

export interface CachedPack {
  id: string
  name: string
  version: string
  origin: PackOrigin
  /** pack-relative path → git blob sha of the stored text */
  files: Record<string, string>
  updatedAt: number
}

interface CachedFile {
  /** `${packId}/${packRelativePath}` */
  key: string
  text: string
  sha: string
}

const DB_NAME = 'tinystudio-parts-cache'
const PACKS = 'packs'
const FILES = 'files'

// ── memory fallback ──────────────────────────────────────────────────────────

const memPacks = new Map<string, CachedPack>()
const memFiles = new Map<string, CachedFile>()

function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(PACKS)) db.createObjectStore(PACKS, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'key' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'))
    })
    dbPromise.catch(() => {
      dbPromise = null
    })
  }
  return dbPromise
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'))
  })
}

async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb()
  return request(fn(db.transaction(store, mode).objectStore(store)))
}

// ── public API ───────────────────────────────────────────────────────────────

export async function listCachedPacks(): Promise<CachedPack[]> {
  if (!idbAvailable()) return [...memPacks.values()]
  try {
    return (await withStore(PACKS, 'readonly', (s) => s.getAll())) as CachedPack[]
  } catch {
    return [...memPacks.values()]
  }
}

export async function getCachedPack(id: string): Promise<CachedPack | undefined> {
  return (await listCachedPacks()).find((p) => p.id === id)
}

export async function readCachedFile(packId: string, rel: string): Promise<string | undefined> {
  const key = `${packId}/${rel}`
  if (!idbAvailable()) return memFiles.get(key)?.text
  try {
    const hit = (await withStore(FILES, 'readonly', (s) => s.get(key))) as CachedFile | undefined
    return hit?.text
  } catch {
    return memFiles.get(key)?.text
  }
}

/**
 * Store a pack atomically: its record plus exactly `files` (any file the pack
 * used to have that isn't in `files` is removed).
 */
export async function putCachedPack(
  record: CachedPack,
  files: Record<string, { text: string; sha: string }>
): Promise<void> {
  const prev = await getCachedPack(record.id)
  const stale = Object.keys(prev?.files ?? {}).filter((rel) => !(rel in files))
  if (!idbAvailable()) {
    for (const rel of stale) memFiles.delete(`${record.id}/${rel}`)
    for (const [rel, f] of Object.entries(files))
      memFiles.set(`${record.id}/${rel}`, { key: `${record.id}/${rel}`, ...f })
    memPacks.set(record.id, record)
    return
  }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([PACKS, FILES], 'readwrite')
    const fileStore = tx.objectStore(FILES)
    for (const rel of stale) fileStore.delete(`${record.id}/${rel}`)
    for (const [rel, f] of Object.entries(files))
      fileStore.put({ key: `${record.id}/${rel}`, text: f.text, sha: f.sha } satisfies CachedFile)
    tx.objectStore(PACKS).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('cache write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('cache write aborted'))
  })
}

/** Update a pack's record without touching its files (e.g. a newer commit, same content). */
export async function touchCachedPack(record: CachedPack): Promise<void> {
  if (!idbAvailable()) {
    memPacks.set(record.id, record)
    return
  }
  await withStore(PACKS, 'readwrite', (s) => s.put(record))
}

export async function deleteCachedPack(id: string): Promise<void> {
  const prev = await getCachedPack(id)
  if (!prev) return
  if (!idbAvailable()) {
    for (const rel of Object.keys(prev.files)) memFiles.delete(`${id}/${rel}`)
    memPacks.delete(id)
    return
  }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([PACKS, FILES], 'readwrite')
    for (const rel of Object.keys(prev.files)) tx.objectStore(FILES).delete(`${id}/${rel}`)
    tx.objectStore(PACKS).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('cache delete failed'))
  })
}

/** Git's blob id for some bytes; lets a download be compared with GitHub's tree. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`)
  const buf = new Uint8Array(header.length + bytes.length)
  buf.set(header)
  buf.set(bytes, header.length)
  const digest = await crypto.subtle.digest('SHA-1', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
