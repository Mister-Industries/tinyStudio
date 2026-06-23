// webCache — IndexedDB-backed durable cache for the browser build.
//
// The web build uses the File System Access API (see webFileSystem.ts) for real
// folders, but those permissions/handles don't survive a page reload, and a user
// may edit before granting one. This cache mirrors every saved file into
// IndexedDB keyed by its path, so:
//   • saves persist across reloads ("browser caching for storage"), and
//   • readFile can fall back to the cache if the live FS read fails.
//
// All operations are best-effort: failures (private mode, no IndexedDB, quota)
// are swallowed so they never break the real file operation.

const DB_NAME = 'tinystudio'
const STORE = 'files'
const DB_VERSION = 1

export interface CachedFile {
  content: string
  mtime: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export const webCache = {
  /** Mirror a file's content into the cache (best-effort). */
  async put(path: string, content: string): Promise<void> {
    try {
      const db = await openDB()
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ content, mtime: Date.now() } satisfies CachedFile, path)
      await txDone(tx)
    } catch {
      /* best-effort cache; ignore */
    }
  },

  /** Read a file's cached content, or null if not cached / unavailable. */
  async get(path: string): Promise<string | null> {
    try {
      const db = await openDB()
      const tx = db.transaction(STORE, 'readonly')
      const value = await requestToPromise<CachedFile | undefined>(tx.objectStore(STORE).get(path))
      return value ? value.content : null
    } catch {
      return null
    }
  },

  /** Remove a file from the cache (best-effort). */
  async remove(path: string): Promise<void> {
    try {
      const db = await openDB()
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(path)
      await txDone(tx)
    } catch {
      /* ignore */
    }
  },

  /** Move a cached file from one path to another (best-effort). */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const content = await this.get(oldPath)
    if (content === null) return
    await this.put(newPath, content)
    await this.remove(oldPath)
  },

  /** List every cached file path. */
  async keys(): Promise<string[]> {
    try {
      const db = await openDB()
      const tx = db.transaction(STORE, 'readonly')
      const keys = await requestToPromise<IDBValidKey[]>(tx.objectStore(STORE).getAllKeys())
      return keys.map(String)
    } catch {
      return []
    }
  }
}
