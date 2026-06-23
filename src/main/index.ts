import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { constants, promises as fs } from 'fs'
import path, { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { ServiceManager } from './ServiceManager'

// Initialize ServiceManager
const serviceManager = new ServiceManager({
  port: 3000,
  allowedOrigins: ['*']
})

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

  // Set the main window for ServiceManager error reporting
  serviceManager.setMainWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Emit maximize/unmaximize events for renderer
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized')
  })

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:unmaximized')
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Start TinyService
  try {
    await serviceManager.start()
  } catch (error) {
    console.error('Failed to start TinyService during app initialization:', error)
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.handle('ping', () => 'pong')

  // Window control handlers
  ipcMain.on('window:minimize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    window?.minimize()
  })

  ipcMain.on('window:maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window?.isMaximized()) {
      window.unmaximize()
    } else {
      window?.maximize()
    }
  })

  ipcMain.on('window:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    window?.close()
  })

  // File system handlers
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('read-directory', async (_, dirPath: string, recursive = false) => {
    try {
      const result: Array<{
        name: string
        path: string
        isDirectory: boolean
        size?: number
        lastModified: number
      }> = []

      async function readDirRecursive(currentPath: string): Promise<void> {
        const items = await fs.readdir(currentPath, { withFileTypes: true })

        for (const item of items) {
          const itemPath = join(currentPath, item.name)
          const stats = await fs.stat(itemPath)

          result.push({
            name: item.name,
            path: itemPath,
            isDirectory: item.isDirectory(),
            size: item.isFile() ? stats.size : undefined,
            lastModified: stats.mtime.getTime()
          })

          if (recursive && item.isDirectory()) {
            await readDirRecursive(itemPath)
          }
        }
      }

      await readDirRecursive(dirPath)

      return result
    } catch (error) {
      throw new Error(`Failed to read directory: ${error}`)
    }
  })

  ipcMain.handle('read-file', async (_, filePath: string) => {
    try {
      return await fs.readFile(filePath, 'utf-8')
    } catch (error) {
      throw new Error(`Failed to read file: ${error}`)
    }
  })

  ipcMain.handle('write-file', async (_, filePath: string, content: string) => {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, content, 'utf-8')
    } catch (error) {
      throw new Error(`Failed to write file: ${error}`)
    }
  })

  ipcMain.handle('create-file', async (_, filePath: string, content = '') => {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, content, 'utf-8')
    } catch (error) {
      throw new Error(`Failed to create file: ${error}`)
    }
  })

  ipcMain.handle('rename-file', async (_, oldPath: string, newPath: string) => {
    try {
      await fs.rename(oldPath, newPath)
    } catch (error) {
      throw new Error(`Failed to rename file: ${error}`)
    }
  })

  ipcMain.handle('create-folder', async (_, folderPath: string) => {
    try {
      await fs.mkdir(folderPath, { recursive: true })
    } catch (error) {
      throw new Error(`Failed to create folder: ${error}`)
    }
  })

  ipcMain.handle('delete-file', async (_, targetPath: string) => {
    try {
      const stats = await fs.stat(targetPath)
      if (stats.isDirectory()) {
        await fs.rmdir(targetPath, { recursive: true })
      } else {
        await fs.unlink(targetPath)
      }
    } catch (error) {
      throw new Error(`Failed to delete: ${error}`)
    }
  })

  ipcMain.handle('path-exists', async (_, targetPath: string) => {
    try {
      await fs.access(targetPath, constants.F_OK)
      return true
    } catch {
      return false
    }
  })

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
      throw new Error(`Failed to get file stats: ${error}`)
    }
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
  if (process.platform !== 'darwin') app.quit()
})

// Stop TinyService before the app quits
app.on('before-quit', async (event) => {
  if (serviceManager.isServiceRunning()) {
    event.preventDefault()

    // Force exit after timeout if cleanup hangs
    const cleanupTimeout = setTimeout(() => {
      console.error('Cleanup timeout - forcing exit')
      app.exit(0)
    }, 3000)

    try {
      console.log('Stopping TinyService...')
      await serviceManager.stop()
      clearTimeout(cleanupTimeout)
      console.log('TinyService stopped, exiting...')
      app.exit()
    } catch (error) {
      console.error('Error stopping TinyService during app quit:', error)
      clearTimeout(cleanupTimeout)
      app.exit(1)
    }
  }
})

// In this file you can include the rest of your app"s main process
// code. You can also put them in separate files and require them here.
