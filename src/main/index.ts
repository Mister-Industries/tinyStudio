import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { promises as fs, constants } from 'fs'
import path from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Setup file system handlers
  setupFileSystemHandlers()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Window control events
  ipcMain.on('window:minimize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) window.minimize()
  })

  ipcMain.on('window:maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) {
      if (window.isMaximized()) {
        window.unmaximize()
      } else {
        window.maximize()
      }
    }
  })
  ipcMain.handle('window:getIsMaximized', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return window ? window.isMaximized() : false
  })

  ipcMain.on('window:requestMaximizeState', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) {
      if (window.isMaximized()) {
        event.sender.send('window:maximized')
      } else {
        event.sender.send('window:unmaximized')
      }
    }
  })

  app.on('browser-window-created', (_, window) => {
    window.on('maximize', () => {
      window.webContents.send('window:maximized')
    })
    window.on('unmaximize', () => {
      window.webContents.send('window:unmaximized')
    })
  })

  ipcMain.on('window:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) window.close()
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// File system types
interface FileSystemItem {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  lastModified?: number
}

// File system IPC handlers
let fileSystemHandlersSetup = false

async function setupFileSystemHandlers(): Promise<void> {
  if (fileSystemHandlersSetup) return
  fileSystemHandlersSetup = true
  // Select folder dialog
  ipcMain.handle('select-folder', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
      })

      if (result.canceled || !result.filePaths.length) {
        return null
      }

      const selectedPath = result.filePaths[0].replace(/\\/g, '/') // Normalize to forward slashes
      return selectedPath
    } catch (error) {
      console.error('Error selecting folder:', error)
      throw error
    }
  })

  // Read directory contents recursively
  ipcMain.handle(
    'read-directory',
    async (_, dirPath: string, recursive = false): Promise<FileSystemItem[]> => {
      try {
        const items: FileSystemItem[] = []

        async function readDir(currentPath: string): Promise<void> {
          const entries = await fs.readdir(currentPath, { withFileTypes: true })

          for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name)
            const stats = await fs.stat(fullPath)

            const item: FileSystemItem = {
              name: entry.name,
              path: fullPath.replace(/\\/g, '/'), // Normalize to forward slashes
              isDirectory: entry.isDirectory(),
              size: entry.isFile() ? stats.size : undefined,
              lastModified: stats.mtime.getTime()
            }

            items.push(item)

            if (recursive && entry.isDirectory()) {
              await readDir(fullPath)
            }
          }
        }

        await readDir(dirPath)
        return items
      } catch (error) {
        console.error('Error reading directory:', error)
        throw error
      }
    }
  )

  // Read file content
  ipcMain.handle('read-file', async (_, filePath: string): Promise<string> => {
    try {
      return await fs.readFile(filePath, 'utf-8')
    } catch (error) {
      console.error('Error reading file:', error)
      throw error
    }
  })

  // Write file content
  ipcMain.handle('write-file', async (_, filePath: string, content: string): Promise<void> => {
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, content, 'utf-8')
    } catch (error) {
      console.error('Error writing file:', error)
      throw error
    }
  })

  // Create new file
  ipcMain.handle('create-file', async (_, filePath: string, content = ''): Promise<void> => {
    try {
      // Check if file already exists
      try {
        await fs.access(filePath, constants.F_OK)
        throw new Error('File already exists')
      } catch (accessError) {
        // File doesn't exist, proceed with creation
        if ((accessError as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw accessError
        }
      }

      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, content, 'utf-8')
    } catch (error) {
      console.error('Error creating file:', error)
      throw error
    }
  })

  // Create new folder
  ipcMain.handle('create-folder', async (_, folderPath: string): Promise<void> => {
    try {
      await fs.mkdir(folderPath, { recursive: true })
    } catch (error) {
      console.error('Error creating folder:', error)
      throw error
    }
  })

  // Rename file or directory
  ipcMain.handle('rename-file', async (_, oldPath: string, newPath: string): Promise<void> => {
    try {
      // Normalize paths for the current platform
      const normalizedOldPath = oldPath.replace(/\//g, path.sep)
      const normalizedNewPath = newPath.replace(/\//g, path.sep)

      // Check if source exists
      await fs.access(normalizedOldPath, constants.F_OK)

      // Check if destination already exists
      try {
        await fs.access(normalizedNewPath, constants.F_OK)
        throw new Error('Destination already exists')
      } catch (accessError) {
        // Destination doesn't exist, proceed with rename
        if ((accessError as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw accessError
        }
      }

      // Ensure destination directory exists
      await fs.mkdir(path.dirname(normalizedNewPath), { recursive: true })

      // Perform the rename
      await fs.rename(normalizedOldPath, normalizedNewPath)
    } catch (error) {
      console.error('Error renaming file/folder:', error)
      throw error
    }
  })

  // Delete file or directory
  ipcMain.handle('delete-file', async (_, targetPath: string): Promise<void> => {
    try {
      const stats = await fs.stat(targetPath)

      if (stats.isDirectory()) {
        await fs.rmdir(targetPath, { recursive: true })
      } else {
        await fs.unlink(targetPath)
      }
    } catch (error) {
      console.error('Error deleting file/folder:', error)
      throw error
    }
  })

  // Check if path exists
  ipcMain.handle('path-exists', async (_, targetPath: string): Promise<boolean> => {
    try {
      await fs.access(targetPath, constants.F_OK)
      return true
    } catch {
      return false
    }
  })

  // Get file stats
  ipcMain.handle('get-file-stats', async (_, filePath: string) => {
    try {
      const stats = await fs.stat(filePath)
      return {
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        size: stats.size,
        lastModified: stats.mtime.getTime(),
        created: stats.birthtime.getTime()
      }
    } catch (error) {
      console.error('Error getting file stats:', error)
      throw error
    }
  })
}

setupFileSystemHandlers()

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
