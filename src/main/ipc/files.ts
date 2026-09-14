/**
 * File-system IPC for the renderer. Every path is checked against the folders
 * the user granted (folderAccess) before main touches the disk.
 */

import { BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron'
import { constants, promises as fs } from 'fs'
import path from 'path'
import { openExternalSafely } from '../externalLinks'
import { examplesDir, grantFolder, hasAccess, requireAccess } from '../folderAccess'

interface FileSystemItem {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  lastModified: number
}

/** What "open with the default app" may open: documents and images, never programs. */
const OPENABLE_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.pdf',
  '.txt',
  '.md',
  '.csv',
  '.json'
])

/** Run a file operation, prefixing failures so the renderer can tell what went wrong. */
async function attempt<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw new Error(`${what}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function registerFileIpc(): void {
  // Picking a folder is what grants access to it.
  ipcMain.handle('select-folder', async (event, defaultPath?: string) => {
    const options: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined
    }
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const folder = result.canceled ? undefined : result.filePaths[0]
    if (!folder) return null
    await grantFolder(folder)
    return folder
  })

  ipcMain.handle('has-access', (_, targetPath: string) => hasAccess(targetPath))

  ipcMain.handle('app:get-examples-dir', () => examplesDir())

  ipcMain.handle('read-directory', async (_, dirPath: string, recursive = false) => {
    const root = requireAccess(dirPath)
    return attempt('Failed to read directory', async () => {
      const result: FileSystemItem[] = []
      const walk = async (current: string): Promise<void> => {
        for (const item of await fs.readdir(current, { withFileTypes: true })) {
          const itemPath = path.join(current, item.name)
          const stats = await fs.stat(itemPath)
          result.push({
            name: item.name,
            path: itemPath,
            isDirectory: item.isDirectory(),
            size: item.isFile() ? stats.size : undefined,
            lastModified: stats.mtime.getTime()
          })
          if (recursive && item.isDirectory()) await walk(itemPath)
        }
      }
      await walk(root)
      return result
    })
  })

  ipcMain.handle('read-file', async (_, filePath: string) => {
    const target = requireAccess(filePath)
    return attempt('Failed to read file', () => fs.readFile(target, 'utf-8'))
  })

  const write = async (filePath: string, content: string, what: string): Promise<void> => {
    const target = requireAccess(filePath)
    await attempt(what, async () => {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content, 'utf-8')
    })
  }
  ipcMain.handle('write-file', (_, filePath: string, content: string) =>
    write(filePath, content, 'Failed to write file')
  )
  ipcMain.handle('create-file', (_, filePath: string, content = '') =>
    write(filePath, content, 'Failed to create file')
  )

  ipcMain.handle('rename-file', async (_, oldPath: string, newPath: string) => {
    const from = requireAccess(oldPath)
    const to = requireAccess(newPath)
    await attempt('Failed to rename file', () => fs.rename(from, to))
  })

  ipcMain.handle('create-folder', async (_, folderPath: string) => {
    const target = requireAccess(folderPath)
    await attempt('Failed to create folder', () => fs.mkdir(target, { recursive: true }))
  })

  ipcMain.handle('delete-file', async (_, targetPath: string) => {
    const target = requireAccess(targetPath)
    await attempt('Failed to delete', () => fs.rm(target, { recursive: true }))
  })

  // Existence alone reveals nothing about contents, and the app checks remembered
  // folders before it knows whether they're still granted.
  ipcMain.handle('path-exists', async (_, targetPath: string) => {
    try {
      await fs.access(targetPath, constants.F_OK)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('get-file-stats', async (_, filePath: string) => {
    const target = requireAccess(filePath)
    return attempt('Failed to get file stats', async () => {
      const stats = await fs.stat(target)
      return {
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        size: stats.size,
        lastModified: stats.mtime.getTime(),
        created: stats.birthtime.getTime()
      }
    })
  })

  // Reveal a file or folder in Explorer / Finder (e.g. a part's art in tinyparts).
  ipcMain.handle('show-item-in-folder', (_, targetPath: string) => {
    shell.showItemInFolder(requireAccess(targetPath))
  })

  // Open a document with the OS default app (e.g. the Visual export in a browser).
  // Resolves '' on success or a message to show.
  ipcMain.handle('open-path', async (_, targetPath: string) => {
    const target = requireAccess(targetPath)
    const stats = await fs.stat(target).catch(() => null)
    if (!stats) return `${target} doesn't exist.`
    const ext = path.extname(target).toLowerCase()
    if (stats.isFile() && !OPENABLE_EXTENSIONS.has(ext)) {
      return `tinyStudio only opens documents and images, not ${ext || 'files without an extension'}.`
    }
    return shell.openPath(target)
  })

  ipcMain.handle('open-external', (_, url: string) => openExternalSafely(url))

  // Save a generated file (e.g. the Visual web export) wherever the user picks.
  ipcMain.handle('save-file-as', async (event, defaultName: string, content: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      defaultPath: defaultName,
      filters: [
        { name: 'HTML', extensions: ['html'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await fs.writeFile(result.filePath, content, 'utf-8')
    return result.filePath
  })
}
