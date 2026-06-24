// Virtual (in-memory) file system for the browser build.
//
// The web build normally uses the File System Access API (webFileSystem.ts),
// which requires the user to *pick a real local folder*. That's wrong for
// projects we load on the user's behalf — examples and `/<owner>/<repo>/<path>`
// deep links — where there is no local folder to pick.
//
// This backend holds a project's files and folders in memory under a synthetic
// `mem://` root, exposing the same surface UnifiedFileSystemService needs. Every
// write is mirrored into webCache (IndexedDB) so edits survive a reload, and
// readFile falls back to the cache. The unified service (fileSystem.ts) routes
// any path beginning with `mem://` here; everything else is unchanged.

import { webCache } from './webCache'
import type { FileStats, FileSystemItem } from './webFileSystem'

export const VIRTUAL_PREFIX = 'mem://'

/** True for any path rooted in the virtual (in-memory) file system. */
export function isVirtualPath(p?: string | null): boolean {
  return !!p && p.startsWith(VIRTUAL_PREFIX)
}

const stripTrailingSlash = (p: string): string => (p.endsWith('/') ? p.slice(0, -1) : p)

class VirtualFileSystemService {
  private files = new Map<string, string>() // full path -> content
  private folders = new Set<string>() // full folder paths
  private mtimes = new Map<string, number>() // full path -> last modified

  /** The parent directory of a path, or null at/above the mem:// root. */
  private parentOf(path: string): string | null {
    const norm = stripTrailingSlash(path)
    const slash = norm.lastIndexOf('/')
    // `mem://owner` has its last slash inside the scheme — stop there.
    if (slash <= VIRTUAL_PREFIX.length - 1) return null
    return norm.slice(0, slash)
  }

  /** Register every ancestor folder of a file/folder path. */
  private addAncestors(path: string): void {
    let parent = this.parentOf(path)
    while (parent && parent !== stripTrailingSlash(VIRTUAL_PREFIX)) {
      if (!this.folders.has(parent)) this.folders.add(parent)
      parent = this.parentOf(parent)
    }
  }

  /**
   * Bulk-load a project's base content into memory. `rootPath` is the mem://
   * workspace root; `files` maps paths relative to that root to their text
   * content. Intentionally does NOT touch webCache — the cache holds only the
   * user's in-editor edits (written via writeFile), so hydrateFromCache can
   * overlay them on top of this freshly-fetched base after a reload.
   */
  async seed(rootPath: string, files: Record<string, string>): Promise<void> {
    const root = stripTrailingSlash(rootPath)
    this.folders.add(root)
    const now = Date.now()
    for (const [rel, content] of Object.entries(files)) {
      const full = `${root}/${rel.replace(/^\/+/, '')}`
      this.files.set(full, content)
      this.mtimes.set(full, now)
      this.addAncestors(full)
    }
  }

  /**
   * Restore any edited files for this root from webCache, overlaying the seeded
   * base. Lets in-editor changes survive a reload of a deep-linked project.
   */
  async hydrateFromCache(rootPath: string): Promise<void> {
    const root = stripTrailingSlash(rootPath)
    const keys = await webCache.keys()
    for (const key of keys) {
      if (key !== root && !key.startsWith(root + '/')) continue
      const content = await webCache.get(key)
      if (content === null) continue
      this.files.set(key, content)
      this.addAncestors(key)
    }
  }

  async readDirectory(dirPath = '', recursive = false): Promise<FileSystemItem[]> {
    const dir = stripTrailingSlash(dirPath)
    const prefix = dir + '/'
    const seen = new Map<string, FileSystemItem>()

    const consider = (full: string, isDirectory: boolean): void => {
      if (!full.startsWith(prefix)) return
      if (recursive) {
        if (!seen.has(full)) seen.set(full, this.toItem(full, isDirectory))
        return
      }
      // Non-recursive: only direct children of `dir`.
      const rest = full.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash === -1) {
        if (!seen.has(full)) seen.set(full, this.toItem(full, isDirectory))
      } else {
        // A deeper path implies an intermediate folder directly under `dir`.
        const childDir = prefix + rest.slice(0, slash)
        if (!seen.has(childDir)) seen.set(childDir, this.toItem(childDir, true))
      }
    }

    for (const folder of this.folders) consider(folder, true)
    for (const file of this.files.keys()) consider(file, false)
    return [...seen.values()]
  }

  private toItem(full: string, isDirectory: boolean): FileSystemItem {
    const name = full.slice(full.lastIndexOf('/') + 1)
    const content = this.files.get(full)
    return {
      name,
      path: full,
      isDirectory,
      size: content != null ? content.length : undefined,
      lastModified: this.mtimes.get(full)
    }
  }

  async readFile(filePath: string): Promise<string> {
    const inMem = this.files.get(filePath)
    if (inMem != null) return inMem
    const cached = await webCache.get(filePath)
    if (cached !== null) {
      this.files.set(filePath, cached)
      return cached
    }
    throw new Error(`File not found: ${filePath}`)
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content)
    this.mtimes.set(filePath, Date.now())
    this.addAncestors(filePath)
    void webCache.put(filePath, content)
  }

  async createFile(filePath: string, content = ''): Promise<void> {
    if (this.files.has(filePath)) throw new Error('File already exists')
    await this.writeFile(filePath, content)
  }

  async createFolder(folderPath: string): Promise<void> {
    const folder = stripTrailingSlash(folderPath)
    this.folders.add(folder)
    this.addAncestors(folder)
  }

  async deleteFile(targetPath: string): Promise<void> {
    const target = stripTrailingSlash(targetPath)
    // Folder delete: remove it and everything beneath it.
    if (this.folders.has(target)) {
      this.folders.delete(target)
      const childPrefix = target + '/'
      for (const f of [...this.files.keys()]) {
        if (f.startsWith(childPrefix)) {
          this.files.delete(f)
          this.mtimes.delete(f)
          void webCache.remove(f)
        }
      }
      for (const d of [...this.folders]) if (d.startsWith(childPrefix)) this.folders.delete(d)
      return
    }
    this.files.delete(target)
    this.mtimes.delete(target)
    void webCache.remove(target)
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const content = await this.readFile(oldPath)
    await this.writeFile(newPath, content)
    await this.deleteFile(oldPath)
  }

  async pathExists(targetPath: string): Promise<boolean> {
    const p = stripTrailingSlash(targetPath)
    return this.files.has(p) || this.folders.has(p)
  }

  async getFileStats(filePath: string): Promise<FileStats> {
    const content = await this.readFile(filePath)
    const mtime = this.mtimes.get(filePath) ?? Date.now()
    return {
      isDirectory: false,
      isFile: true,
      size: content.length,
      lastModified: mtime,
      created: mtime
    }
  }

  /** Drop a project from memory (its cache entries persist for next load). */
  clear(rootPath?: string): void {
    if (!rootPath) {
      this.files.clear()
      this.folders.clear()
      this.mtimes.clear()
      return
    }
    const root = stripTrailingSlash(rootPath)
    const prefix = root + '/'
    for (const f of [...this.files.keys()]) {
      if (f === root || f.startsWith(prefix)) {
        this.files.delete(f)
        this.mtimes.delete(f)
      }
    }
    for (const d of [...this.folders])
      if (d === root || d.startsWith(prefix)) this.folders.delete(d)
  }
}

export const virtualFileSystem = new VirtualFileSystemService()
