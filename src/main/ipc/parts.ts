/**
 * Parts development IPC: watch a local tinyparts checkout (a granted folder).
 *
 * One recursive watcher per window. Changes are batched (editors like
 * Illustrator save through temp files and renames) and sent as paths relative
 * to the watched folder; the renderer decides what to reload.
 */

import { ipcMain } from 'electron'
import { watch, type FSWatcher } from 'fs'
import { requireAccess } from '../folderAccess'

export function registerPartsIpc(): void {
  const watchers = new Map<number, FSWatcher>()

  ipcMain.handle('parts:watch', (event, dir: string) => {
    const root = requireAccess(dir)
    const sender = event.sender
    watchers.get(sender.id)?.close()
    let pending = new Set<string>()
    let timer: NodeJS.Timeout | null = null
    const watcher = watch(root, { recursive: true }, (_evt, file) => {
      if (!file) return
      const rel = file.toString().replace(/\\/g, '/')
      if (rel === '.git' || rel.startsWith('.git/')) return
      pending.add(rel)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (!sender.isDestroyed()) sender.send('parts:changed', { dir, paths: [...pending] })
        pending = new Set()
      }, 250)
    })
    watcher.on('error', () => watchers.delete(sender.id))
    if (!watchers.has(sender.id)) {
      sender.once('destroyed', () => {
        watchers.get(sender.id)?.close()
        watchers.delete(sender.id)
      })
    }
    watchers.set(sender.id, watcher)
  })

  ipcMain.handle('parts:unwatch', (event) => {
    watchers.get(event.sender.id)?.close()
    watchers.delete(event.sender.id)
  })
}
