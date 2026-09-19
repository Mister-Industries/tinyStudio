/**
 * folderAccess: which folders the renderer may read and write.
 *
 * The renderer shows project content from anywhere (README links, part art,
 * sketches), so it isn't trusted with the whole disk. It gets the folders the
 * user chose in a folder picker, remembered across launches in
 * userData/folder-access.json, plus the folder examples download into.
 * Every file operation main performs for the renderer checks this first.
 */

import { app } from 'electron'
import { readFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'

const storeFile = (): string => path.join(app.getPath('userData'), 'folder-access.json')

let granted: string[] | null = null

function load(): string[] {
  if (granted) return granted
  granted = []
  try {
    const parsed = JSON.parse(readFileSync(storeFile(), 'utf-8')) as { folders?: unknown }
    if (Array.isArray(parsed.folders)) {
      granted = parsed.folders.filter((f): f is string => typeof f === 'string')
    }
  } catch {
    // first launch, or an unreadable file: nothing granted yet
  }
  return granted
}

/** Paths compare case-insensitively where the file system usually is (Windows, macOS). */
const comparable = (p: string): string => {
  const abs = path.resolve(p)
  return process.platform === 'linux' ? abs : abs.toLowerCase()
}

/** Where "Open example" writes projects on desktop. Always accessible. */
export function examplesDir(): string {
  return path.join(app.getPath('documents'), 'tinyStudio Examples')
}

/** Remember a folder the user picked, so it stays reachable after a restart. */
export async function grantFolder(folder: string): Promise<void> {
  const list = load()
  if (list.some((f) => comparable(f) === comparable(folder))) return
  list.push(path.resolve(folder))
  await mkdir(path.dirname(storeFile()), { recursive: true })
  await writeFile(storeFile(), JSON.stringify({ folders: list }, null, 2), 'utf-8')
}

/** Is `target` a granted folder, or inside one? */
export function hasAccess(target: unknown): target is string {
  if (typeof target !== 'string' || target === '') return false
  const t = comparable(target)
  return [...load(), examplesDir()].some((root) => {
    const r = comparable(root)
    return t === r || t.startsWith(r.endsWith(path.sep) ? r : r + path.sep)
  })
}

/** The absolute path for `target`, or an error the renderer can show. */
export function requireAccess(target: unknown): string {
  if (!hasAccess(target)) {
    throw new Error(`tinyStudio doesn't have access to ${String(target)}. Open its folder first.`)
  }
  return path.resolve(target)
}
