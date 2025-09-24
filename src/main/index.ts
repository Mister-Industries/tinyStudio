import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { constants, promises as fs } from 'fs'
import path, { join } from 'path'
import * as io from 'socket.io-client'
import icon from '../../resources/icon.png?asset'

// Arduino Types - duplicated from types file for main process
interface AgentStatus {
  connected: boolean
  version?: string
  lastCheck: number
  error?: string
}

interface Board {
  port: string
  config: {
    fqbn: string
    name: string
    architecture?: string
    package?: string
  }
  protocol: 'serial' | 'network'
  connected: boolean
  metadata?: {
    vendorId?: string
    productId?: string
    serialNumber?: string
  }
}

interface BoardInfo extends Board {
  description: string
  uploadProtocols: string[]
  capabilities: string[]
}

interface InfoResponse {
  http: string
  https: string
  origins: string
  os: string
  update_url: string
  version: string
  ws: string
  wss: string
}

async function discoverAgent(): Promise<InfoResponse> {
  for (let port = 8990; port <= 9000; port++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/info`)
      if (response.ok) {
        const info = await response.json()
        return info // Contains endpoints and version info
      }
    } catch {
      // Port not available, continue
    }
  }
  throw new Error('Arduino Cloud Agent not found')
}

// Arduino Create Agent service for main process using Socket.IO
/* eslint-disable @typescript-eslint/no-explicit-any */
class MainArduinoService {
  private socket: any | null = null
  private agentInfo: InfoResponse | null = null
  private currentStatus: AgentStatus = { connected: false, lastCheck: 0 }
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000

  constructor() {
    this.currentStatus = {
      connected: false,
      lastCheck: Date.now(),
      error: 'Arduino Create Agent not initialized'
    }
  }

  private async ensureSocketConnected(): Promise<void> {
    if (this.socket && this.socket.connected) {
      return
    }

    // Discover agent if not already done
    if (!this.agentInfo) {
      try {
        this.agentInfo = await discoverAgent()
      } catch (error) {
        console.warn('Arduino Create Agent not available:', error)
        this.currentStatus = {
          connected: false,
          lastCheck: Date.now(),
          error: error instanceof Error ? error.message : 'Arduino Create Agent not available'
        }
        throw error
      }
    }

    // Create socket connection
    if (!this.socket) {
      this.socket = io.connect(this.agentInfo.ws, {
        transports: ['websocket'],
        timeout: 5000,
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectDelay,
        forceNew: true
      })

      this.setupSocketListeners()
    }

    // Wait for connection
    return new Promise((resolve, reject) => {
      if (this.socket!.connected) {
        resolve()
        return
      }

      const timeout = setTimeout(() => {
        reject(new Error('Socket connection timeout'))
      }, 10000)

      this.socket!.once('connect', () => {
        clearTimeout(timeout)
        this.currentStatus = {
          connected: true,
          lastCheck: Date.now(),
          version: this.agentInfo!.version
        }
        this.reconnectAttempts = 0
        resolve()
      })

      this.socket!.once('connect_error', (error) => {
        clearTimeout(timeout)
        this.currentStatus = {
          connected: false,
          lastCheck: Date.now(),
          error: `Socket connection error: ${error.message}`
        }
        reject(error)
      })
    })
  }

  private setupSocketListeners(): void {
    if (!this.socket) return

    this.socket.on('connect', () => {
      console.log('Connected to Arduino Create Agent')
      this.currentStatus = {
        connected: true,
        lastCheck: Date.now(),
        version: this.agentInfo?.version
      }
      this.reconnectAttempts = 0
    })

    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected from Arduino Create Agent:', reason)
      this.currentStatus = {
        connected: false,
        lastCheck: Date.now(),
        error: `Disconnected: ${reason}`
      }
    })

    this.socket.on('connect_error', (error) => {
      console.error('Arduino Create Agent connection error:', error)
      this.reconnectAttempts++
      this.currentStatus = {
        connected: false,
        lastCheck: Date.now(),
        error: `Connection error: ${error.message}`
      }
    })

    this.socket.on('error', (error) => {
      console.error('Arduino Create Agent socket error:', error)
      this.currentStatus = {
        connected: false,
        lastCheck: Date.now(),
        error: `Socket error: ${error}`
      }
    })
  }

  async checkStatus(): Promise<AgentStatus> {
    try {
      await this.ensureSocketConnected()
      return { ...this.currentStatus }
    } catch (error) {
      return {
        connected: false,
        lastCheck: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  async listBoards(): Promise<Board[]> {
    try {
      await this.ensureSocketConnected()

      return new Promise((resolve, reject) => {
        if (!this.socket || !this.socket.connected) {
          reject(new Error('Socket not connected'))
          return
        }

        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for board list'))
        }, 10000)

        // Set up listener for the response - Arduino Create Agent sends responses on 'message' events
        const handleMessage = (data: any): void => {
          try {
            const decodedData = typeof data === 'string' ? JSON.parse(data) : data
            // Check if this message contains ports data (response to our list command)
            if (decodedData && typeof decodedData === 'object' && 'Ports' in decodedData) {
              clearTimeout(timeout)
              this.socket.off('message', handleMessage) // Remove the listener

              const boards: Board[] = []
              // Convert serial devices to Board objects
              // The response should have a 'Ports' property with device list
              if (decodedData.Ports && Array.isArray(decodedData.Ports)) {
                boards.push(
                  ...decodedData.Ports.map((device: any) => this.convertSerialDeviceToBoard(device))
                )
              }
              // If Ports is null, return empty array (no boards connected)
              resolve(boards)
            }
          } catch {
            // Ignore messages that don't parse correctly
            // This is expected for non-JSON messages from the Arduino Create Agent
          }
        }

        this.socket.on('message', handleMessage)

        // Send the command
        this.socket.emit('command', 'list')
      })
    } catch (error) {
      console.error('Error listing boards:', error)

      // If Arduino Create Agent is not available, return empty array instead of throwing
      if (
        error instanceof Error &&
        (error.message.includes('Arduino Create Agent not found') ||
          error.message.includes('Socket not connected') ||
          error.message.includes('Socket connection timeout'))
      ) {
        console.warn('Arduino Create Agent not available, returning empty board list')
        return []
      }

      throw new Error(
        `Failed to list boards: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async getBoardInfo(port: string): Promise<BoardInfo> {
    try {
      const boards = await this.listBoards()
      const board = boards.find((b) => b.port === port)

      if (!board) {
        throw new Error(`Board not found on port ${port}`)
      }

      return {
        ...board,
        description: `${board.config.name} on ${port}`,
        uploadProtocols: ['serial'],
        capabilities: ['upload', 'compile']
      }
    } catch (error) {
      console.error('Error getting board info:', error)
      throw new Error(
        `Failed to get board info: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  private convertSerialDeviceToBoard(device: any): Board {
    return {
      port: device.Name || device.port || '/dev/unknown',
      config: {
        fqbn: this.inferFQBNFromDevice(device),
        name: this.inferBoardNameFromDevice(device)
      },
      protocol: 'serial',
      connected: !device.IsOpen,
      metadata: {
        vendorId: device.VendorID,
        productId: device.ProductID,
        serialNumber: device.SerialNumber
      }
    }
  }

  private inferFQBNFromDevice(device: any): string {
    const vid = device.VendorID?.toLowerCase()
    const pid = device.ProductID?.toLowerCase()

    // Common Arduino board mappings
    if (vid === '0x2341') {
      switch (pid) {
        case '0x0043':
          return 'arduino:avr:uno'
        case '0x8036':
          return 'arduino:avr:leonardo'
        case '0x0042':
          return 'arduino:avr:mega'
        case '0x804d':
          return 'arduino:samd:mkr1000'
        default:
          return 'arduino:avr:uno'
      }
    }

    // ESP32 boards
    if (vid === '0x10c4' || vid === '0x1a86') {
      return 'esp32:esp32:esp32'
    }

    // Default fallback
    return 'arduino:avr:uno'
  }

  private inferBoardNameFromDevice(device: any): string {
    const fqbn = this.inferFQBNFromDevice(device)

    const nameMap: { [key: string]: string } = {
      'arduino:avr:uno': 'Arduino Uno',
      'arduino:avr:leonardo': 'Arduino Leonardo',
      'arduino:avr:mega': 'Arduino Mega',
      'arduino:samd:mkr1000': 'Arduino MKR1000',
      'esp32:esp32:esp32': 'ESP32 Dev Module'
    }

    return nameMap[fqbn] || 'Unknown Arduino Board'
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.agentInfo = null
    this.currentStatus = {
      connected: false,
      lastCheck: Date.now(),
      error: 'Disconnected'
    }
  }

  async reconnect(): Promise<void> {
    await this.disconnect()
    await this.ensureSocketConnected()
  }
}

// Global Arduino service instance
let arduinoService: MainArduinoService | null = null

function setupArduinoHandlers(): void {
  // Initialize Arduino service
  arduinoService = new MainArduinoService()

  // Arduino IPC handlers
  ipcMain.handle('arduino:checkStatus', async (): Promise<AgentStatus> => {
    try {
      return await arduinoService!.checkStatus()
    } catch (error) {
      return {
        connected: false,
        lastCheck: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  ipcMain.handle('arduino:listBoards', async (): Promise<Board[]> => {
    try {
      return await arduinoService!.listBoards()
    } catch (error) {
      console.error('Error in arduino:listBoards:', error)
      throw error
    }
  })

  ipcMain.handle('arduino:getBoardInfo', async (_, port: string): Promise<BoardInfo> => {
    try {
      return await arduinoService!.getBoardInfo(port)
    } catch (error) {
      console.error('Error in arduino:getBoardInfo:', error)
      throw error
    }
  })

  ipcMain.handle('arduino:reconnect', async (): Promise<void> => {
    try {
      await arduinoService!.reconnect()
    } catch (error) {
      console.error('Error in arduino:reconnect:', error)
      throw error
    }
  })

  ipcMain.handle('arduino:disconnect', async (): Promise<void> => {
    try {
      await arduinoService!.disconnect()
    } catch (error) {
      console.error('Error in arduino:disconnect:', error)
      throw error
    }
  })
}

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

  // Setup Arduino handlers
  setupArduinoHandlers()

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

// Clean up Arduino service connection before quitting
app.on('before-quit', async () => {
  if (arduinoService) {
    try {
      await arduinoService.disconnect()
    } catch (error) {
      console.error('Error disconnecting Arduino service:', error)
    }
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
