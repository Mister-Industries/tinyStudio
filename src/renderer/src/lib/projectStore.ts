// Where projects live on the user's computer, and how tinyStudio finds them
// again.
//
// Two jobs:
//   1. Writing a project out to a new folder the user picks — "Save to
//      computer" for a project that has only ever lived in the browser, and
//      "Create project". What the folder looks like is projectLayout's call.
//   2. Remembering recently opened projects so they reopen in one click. On
//      desktop a folder is just a path. In the browser a folder is a
//      FileSystemDirectoryHandle: its name alone can't reopen it, but the handle
//      survives in IndexedDB, and re-granting access to it is one permission
//      prompt instead of hunting through the folder picker again.

import { fileSystem } from './fileSystem'
import { isElectron } from './utils'
import { STORAGE_KEYS } from './storageKeys'
import { PROJECTS_PICKER_ID, webFileSystem } from './webFileSystem'

/** True where tinyStudio can write a real folder: desktop, or Chromium's File System Access API. */
export function canSaveToComputer(): boolean {
  return isElectron() || (typeof window !== 'undefined' && 'showDirectoryPicker' in window)
}

/** A folder the user picked to put a project in. */
export type ParentFolder =
  | { kind: 'path'; path: string }
  | { kind: 'handle'; handle: FileSystemDirectoryHandle }

/** Where a project will be written inside a parent folder. */
export interface ProjectTarget {
  name: string
  /**
   * The user picked the project folder itself (made "blink" in the picker and
   * chose it), so write into it rather than nesting a second "blink" inside.
   */
  inPlace: boolean
}

/** Ask where to put a project. Null when the user cancels. */
export async function pickParentFolder(): Promise<ParentFolder | null> {
  if (isElectron()) {
    const path = await window.api.fs.selectFolder()
    return path ? { kind: 'path', path: normalizeDiskPath(path) } : null
  }
  try {
    const handle = await window.showDirectoryPicker({
      id: PROJECTS_PICKER_ID,
      mode: 'readwrite',
      startIn: 'documents'
    })
    return { kind: 'handle', handle }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null
    throw e
  }
}

const normalizeDiskPath = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** A picked folder's display name. */
export const folderLabel = (parent: ParentFolder): string =>
  parent.kind === 'handle' ? parent.handle.name : parent.path.split('/').pop() || parent.path

async function childState(
  parent: ParentFolder,
  name: string
): Promise<'missing' | 'empty' | 'used'> {
  if (parent.kind === 'path') {
    const path = `${parent.path}/${name}`
    if (!(await fileSystem.pathExists(path))) return 'missing'
    const items = await window.api.fs.readDirectory(path, false)
    return items.length === 0 ? 'empty' : 'used'
  }
  let dir: FileSystemDirectoryHandle
  try {
    dir = await parent.handle.getDirectoryHandle(name)
  } catch (e) {
    // TypeMismatchError means a *file* has that name — just as unusable.
    return (e as Error).name === 'NotFoundError' ? 'missing' : 'used'
  }
  return (await isEmptyHandle(dir)) ? 'empty' : 'used'
}

async function isEmptyHandle(dir: FileSystemDirectoryHandle): Promise<boolean> {
  // @ts-expect-error - keys() exists on directory handles but isn't in lib.dom yet
  for await (const _ of dir.keys()) return false
  return true
}

async function isEmptyParent(parent: ParentFolder): Promise<boolean> {
  if (parent.kind === 'handle') return isEmptyHandle(parent.handle)
  return (await window.api.fs.readDirectory(parent.path, false)).length === 0
}

/**
 * Settle on a folder name inside `parent` that won't clobber anything. An
 * existing, non-empty folder gets a numbered sibling (`blink_2`) — never an
 * overwrite. The caller must lay the files out under the returned name, since
 * the .ino has to match it.
 */
export async function chooseProjectTarget(
  parent: ParentFolder,
  desired: string
): Promise<ProjectTarget> {
  if (folderLabel(parent) === desired && (await isEmptyParent(parent))) {
    return { name: desired, inPlace: true }
  }
  const stem = desired.slice(0, 60)
  for (let n = 1; ; n++) {
    const name = n === 1 ? desired : `${stem}_${n}`
    if ((await childState(parent, name)) !== 'used') return { name, inPlace: false }
  }
}

/**
 * Write `files` (project-relative paths) into the target folder, creating it.
 * Returns the new workspace path. In the browser the service's root moves to
 * the new folder, so the workspace can be opened straight after.
 *
 * Binary content (Uint8Array) is browser-only: the desktop bridge writes text.
 */
export async function writeProjectFolder(
  parent: ParentFolder,
  target: ProjectTarget,
  files: Record<string, string | Uint8Array>,
  onProgress?: (msg: string) => void
): Promise<string> {
  const entries = Object.entries(files)
  let done = 0
  const tick = (rel: string): void => onProgress?.(`Writing ${++done}/${entries.length} · ${rel}`)

  if (parent.kind === 'path') {
    const base = target.inPlace ? parent.path : `${parent.path}/${target.name}`
    await fileSystem.createFolder(base)
    for (const [rel, content] of entries) {
      if (typeof content !== 'string') {
        console.warn(`Skipping binary file on desktop save: ${rel}`)
        continue
      }
      await fileSystem.writeFile(`${base}/${rel}`, content)
      tick(rel)
    }
    return base
  }

  const dir = target.inPlace
    ? parent.handle
    : await parent.handle.getDirectoryHandle(target.name, { create: true })
  for (const [rel, content] of entries) {
    await writeIntoHandle(dir, rel, content)
    tick(rel)
  }
  webFileSystem.setRoot(dir)
  return dir.name
}

async function writeIntoHandle(
  dir: FileSystemDirectoryHandle,
  rel: string,
  content: string | Uint8Array
): Promise<void> {
  const parts = rel.split('/').filter(Boolean)
  const fileName = parts.pop()
  if (!fileName) return
  let current = dir
  for (const part of parts) current = await current.getDirectoryHandle(part, { create: true })
  const handle = await current.getFileHandle(fileName, { create: true })
  const writable = await handle.createWritable()
  await writable.write(content as unknown as FileSystemWriteChunkType)
  await writable.close()
}

// ── recent projects ──────────────────────────────────────────────────────────

export interface RecentProject {
  id: string
  kind: 'folder' | 'github'
  /** display name: the folder, or the repo folder's last segment */
  name: string
  /** folder: disk path (desktop) or folder name (browser); github: owner/repo[/path] */
  location: string
  owner?: string
  repo?: string
  repoPath?: string
  openedAt: number
}

const RECENTS_KEY = STORAGE_KEYS.recentProjects
const MAX_RECENTS = 8
/** Fired on window whenever the recent list changes. */
export const RECENTS_EVENT = 'tinystudio:recent-projects'

export function listRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    const parsed = raw ? (JSON.parse(raw) as RecentProject[]) : []
    return Array.isArray(parsed) ? parsed.filter((r) => r && r.id && r.kind && r.location) : []
  } catch {
    return []
  }
}

function writeRecents(list: RecentProject[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable — recents are a convenience */
  }
  window.dispatchEvent(new Event(RECENTS_EVENT))
}

function upsertRecent(entry: RecentProject): void {
  const rest = listRecentProjects().filter((r) => r.id !== entry.id)
  const next = [entry, ...rest]
  for (const evicted of next.slice(MAX_RECENTS)) void handleStore.remove(evicted.id)
  writeRecents(next.slice(0, MAX_RECENTS))
}

export function forgetRecentProject(id: string): void {
  writeRecents(listRecentProjects().filter((r) => r.id !== id))
  void handleStore.remove(id)
}

/**
 * Record a local folder that was just opened. In the browser this stores the
 * current root handle, deduped by *identity* (`isSameEntry`) rather than name —
 * two different folders called "blink" are two projects.
 */
export async function rememberFolder(workspacePath: string): Promise<void> {
  const path = normalizeDiskPath(workspacePath)
  const name = path.split('/').pop() || path
  if (isElectron()) {
    upsertRecent({
      id: `folder:${path}`,
      kind: 'folder',
      name,
      location: path,
      openedAt: Date.now()
    })
    return
  }
  const handle = webFileSystem.getRoot()
  if (!handle) return
  let id: string | undefined
  for (const r of listRecentProjects()) {
    if (r.kind !== 'folder') continue
    const known = await handleStore.get(r.id)
    if (known && (await known.isSameEntry(handle))) {
      id = r.id
      break
    }
  }
  id ??= `folder:${crypto.randomUUID()}`
  await handleStore.put(id, handle)
  upsertRecent({
    id,
    kind: 'folder',
    name: handle.name,
    location: handle.name,
    openedAt: Date.now()
  })
}

/** Record a GitHub repo folder opened through "Open existing". */
export function rememberGitHubProject(owner: string, repo: string, repoPath = ''): void {
  const location = [owner, repo, repoPath].filter(Boolean).join('/')
  upsertRecent({
    id: `github:${location.toLowerCase()}`,
    kind: 'github',
    name: repoPath ? repoPath.split('/').pop()! : repo,
    location,
    owner,
    repo,
    repoPath,
    openedAt: Date.now()
  })
}

/** The stored handle for a recent browser folder, if it's still known. */
export function recentFolderHandle(id: string): Promise<FileSystemDirectoryHandle | null> {
  return handleStore.get(id)
}

interface PermissionedHandle {
  queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}

/**
 * Make sure we may read and write a stored folder handle. Access lapses when the
 * page reloads; `prompt` asks the user to grant it again, which the browser only
 * allows from a click — so launch-time restores pass false and simply skip.
 */
export async function ensureFolderAccess(
  handle: FileSystemDirectoryHandle,
  prompt: boolean
): Promise<boolean> {
  const h = handle as unknown as PermissionedHandle
  const mode = { mode: 'readwrite' as const }
  if (!h.queryPermission) return true
  if ((await h.queryPermission(mode)) === 'granted') return true
  if (!prompt || !h.requestPermission) return false
  return (await h.requestPermission(mode)) === 'granted'
}

// IndexedDB store for directory handles (structured-clonable, unlike JSON).
// Its own database, so the file cache's schema never has to change for it.
const handleStore = (() => {
  let db: Promise<IDBDatabase> | null = null
  const open = (): Promise<IDBDatabase> =>
    (db ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'))
      const req = indexedDB.open('tinystudio-handles', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('handles')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }))
  const run = async <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> => {
    const tx = (await open()).transaction('handles', mode)
    const req = fn(tx.objectStore('handles'))
    return new Promise<T>((resolve, reject) => {
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }
  return {
    async get(id: string): Promise<FileSystemDirectoryHandle | null> {
      if (isElectron()) return null
      try {
        return ((await run('readonly', (s) => s.get(id))) as FileSystemDirectoryHandle) ?? null
      } catch {
        return null
      }
    },
    async put(id: string, handle: FileSystemDirectoryHandle): Promise<void> {
      try {
        await run('readwrite', (s) => s.put(handle, id))
      } catch {
        /* best-effort */
      }
    },
    async remove(id: string): Promise<void> {
      if (isElectron()) return
      try {
        await run('readwrite', (s) => s.delete(id))
      } catch {
        /* best-effort */
      }
    }
  }
})()
