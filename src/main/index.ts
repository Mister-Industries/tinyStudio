import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  TinyServiceClient,
  type CompleteData,
  type OutgoingMessage,
  type BoardInfo as SharedBoardInfo
} from '@mister-industries/shared'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { constants, promises as fs } from 'fs'
import path, { join } from 'path'
import icon from '../../resources/icon.png?asset'

// Local type definitions for IPC handlers (mapped from shared types)
interface AgentStatus {
  connected: boolean
  version?: string
  lastCheck: number
  error?: string
}

interface BoardConfig {
  fqbn: string
  name: string
  architecture?: string
  package?: string
  properties?: { [key: string]: string }
}

interface Board {
  port: string
  config: BoardConfig
  protocol?: string
  connected: boolean
  metadata?: {
    vendorId?: string
    productId?: string
    serialNumber?: string
  }
}

interface BoardInfo extends Board {
  description?: string
  uploadProtocols?: string[]
  capabilities?: string[]
}

interface CompileResult {
  success: boolean
  output: string
  error?: string
  binaryPath?: string
}

interface UploadResult {
  success: boolean
  output: string
  error?: string
}

// Arduino service client instance
let arduinoClient: TinyServiceClient | null = null

// Throttle tracking for list-boards command
let lastListBoardsCall = 0
const LIST_BOARDS_THROTTLE_MS = 5000 // 5 seconds
let cachedBoardList: Board[] = [] // Cache the last successful board list

// Helper function to normalize tinyCore FQBN
function normalizeTinyCoreFqbn(fqbn: string): string {
  if (fqbn.startsWith('tinyCore:')) {
    return 'tinyCore:esp32:tiny_core_esp32s3_nopsram'
  }
  return fqbn
}

// Initialize the Arduino service client
function initializeArduinoClient(): void {
  if (!arduinoClient) {
    arduinoClient = new TinyServiceClient({
      url: 'ws://localhost:3000', // Default URL, can be made configurable
      autoReconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 10,
      debug: true
    })

    arduinoClient.connect()

    // Set up global error handler
    arduinoClient.onError((error) => {
      console.error('Arduino service error:', error)
    })
  }
}

// Helper function to wrap Arduino service calls in a Promise
function waitForArduinoResponse(
  action: string,
  timeout = 60000
): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve, reject) => {
    if (!arduinoClient) {
      reject(new Error('Arduino client not initialized'))
      return
    }

    let output = ''
    let hasError = false
    let errorMessage = ''

    const timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error(`Operation timed out after ${timeout}ms`))
    }, timeout)

    const cleanup = (): void => {
      clearTimeout(timeoutId)
      if (messageUnsubscribe) messageUnsubscribe()
      if (errorUnsubscribe) errorUnsubscribe()
    }

    const messageUnsubscribe = arduinoClient.onMessage((message: OutgoingMessage) => {
      // Only handle messages for this action
      if (message.action !== action) return

      if (message.type === 'output') {
        output += message.data.output + '\n'
      } else if (message.type === 'error') {
        hasError = true
        errorMessage = message.data.error
        if (message.data.details) {
          errorMessage += '\n' + message.data.details
        }
      } else if (message.type === 'complete') {
        console.log('Received message in wait:', message)
        cleanup()

        // Handle list-boards response differently
        if (action === 'list-boards') {
          const listBoardsData = message.data as { message: string; boards: SharedBoardInfo[] }
          // Convert boards array to JSON string output (one per line)
          const boardsOutput = listBoardsData.boards
            .map((board) => JSON.stringify(board))
            .join('\n')
          resolve({
            success: !hasError,
            output: boardsOutput,
            error: hasError ? errorMessage : undefined
          })
        } else {
          // Default handling for other actions
          const completeData = message.data as CompleteData
          resolve({
            success: completeData.success && !hasError,
            output: completeData.output || output,
            error: hasError ? errorMessage : completeData.error
          })
        }
      }
    })

    const errorUnsubscribe = arduinoClient.onError((error) => {
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

function setupArduinoHandlers(): void {
  // Initialize the client when setting up handlers
  initializeArduinoClient()
  // Arduino IPC handlers
  ipcMain.handle('arduino:checkStatus', async (): Promise<AgentStatus> => {
    try {
      if (!arduinoClient || !arduinoClient.isConnected()) {
        return {
          connected: false,
          lastCheck: Date.now(),
          error: 'Arduino service not connected'
        }
      }

      return {
        connected: true,
        lastCheck: Date.now()
      }
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
      if (!arduinoClient) {
        throw new Error('Arduino client not initialized')
      }

      // Throttle list-boards calls to once every 5 seconds
      const now = Date.now()
      const timeSinceLastCall = now - lastListBoardsCall

      if (timeSinceLastCall < LIST_BOARDS_THROTTLE_MS) {
        console.log(
          `Throttling list-boards call. ${LIST_BOARDS_THROTTLE_MS - timeSinceLastCall}ms until next allowed call. Returning cached result.`
        )
        // Return cached result instead of making a new request
        return cachedBoardList
      }

      lastListBoardsCall = now

      // Request list of boards
      arduinoClient.listBoards()

      // Wait for response
      const result = await waitForArduinoResponse('list-boards', 10000)

      console.log(result)

      if (!result.success) {
        throw new Error(result.error || 'Failed to list boards')
      }

      // Parse board list from output
      // The output should contain board information in JSON format or similar
      // This is a simplified implementation - adjust based on actual format
      const boards: Board[] = []
      try {
        const lines = result.output.split('\n').filter((line) => line.trim())
        for (const line of lines) {
          try {
            const boardData = JSON.parse(line) as SharedBoardInfo
            const normalizedFqbn = normalizeTinyCoreFqbn(boardData.fqbn)
            boards.push({
              port: boardData.port || '',
              config: {
                fqbn: normalizedFqbn,
                name: boardData.name
              },
              connected: true
            })
          } catch {
            // Skip invalid lines
          }
        }
      } catch (parseError) {
        console.error('Error parsing board list:', parseError)
      }

      // Cache the successful result
      cachedBoardList = boards

      return boards
    } catch (error) {
      console.error('Error in arduino:listBoards:', error)
      throw error
    }
  })

  ipcMain.handle('arduino:getBoardInfo', async (_, port: string): Promise<BoardInfo> => {
    try {
      if (!arduinoClient) {
        throw new Error('Arduino client not initialized')
      }

      // Check throttle for list-boards
      const now = Date.now()
      const timeSinceLastCall = now - lastListBoardsCall

      if (timeSinceLastCall < LIST_BOARDS_THROTTLE_MS) {
        console.log(
          `Throttling getBoardInfo list-boards call. ${LIST_BOARDS_THROTTLE_MS - timeSinceLastCall}ms until next allowed call`
        )
        throw new Error('Board list request throttled. Please wait a moment and try again.')
      }

      lastListBoardsCall = now

      // List all boards and find the one matching the port
      arduinoClient.listBoards()
      const result = await waitForArduinoResponse('list-boards', 10000)

      if (!result.success) {
        throw new Error(result.error || 'Failed to get board info')
      }

      // Parse and find the specific board
      const lines = result.output.split('\n').filter((line) => line.trim())
      for (const line of lines) {
        try {
          const boardData = JSON.parse(line) as SharedBoardInfo
          if (boardData.port === port) {
            const normalizedFqbn = normalizeTinyCoreFqbn(boardData.fqbn)
            return {
              port: boardData.port || '',
              config: {
                fqbn: normalizedFqbn,
                name: boardData.name
              },
              connected: true,
              description: boardData.name
            }
          }
        } catch {
          // Skip invalid lines
        }
      }

      throw new Error(`Board not found on port ${port}`)
    } catch (error) {
      console.error('Error in arduino:getBoardInfo:', error)
      throw error
    }
  })

  ipcMain.handle(
    'arduino:compileSketch',
    async (_, workspacePath: string, boardConfig: BoardConfig): Promise<CompileResult> => {
      try {
        if (!arduinoClient) {
          throw new Error('Arduino client not initialized')
        }

        // Compile the sketch
        arduinoClient.compile(workspacePath, boardConfig.fqbn)

        // Wait for response with longer timeout for compilation
        const result = await waitForArduinoResponse('compile', 60000)

        return {
          success: result.success,
          output: result.output,
          error: result.error
        }
      } catch (error) {
        console.error('Error in arduino:compileSketch:', error)
        throw error
      }
    }
  )

  ipcMain.handle(
    'arduino:uploadSketch',
    async (
      _,
      port: string,
      boardConfig: BoardConfig,
      binaryPath?: string
    ): Promise<UploadResult> => {
      try {
        if (!arduinoClient) {
          throw new Error('Arduino client not initialized')
        }

        // If binaryPath is provided, we assume it's already compiled
        // Otherwise, we'll need to compile first (or the service handles it)
        arduinoClient.upload(binaryPath || '', boardConfig.fqbn, port)

        // Wait for response
        const result = await waitForArduinoResponse('upload', 30000)

        return {
          success: result.success,
          output: result.output,
          error: result.error
        }
      } catch (error) {
        console.error('Error in arduino:uploadSketch:', error)
        throw error
      }
    }
  )

  // Keep the compileAndUpload handler for backwards compatibility
  ipcMain.handle(
    'arduino:compileAndUpload',
    async (_, workspacePath: string, port: string, boardConfig: { fqbn: string; name: string }) => {
      try {
        if (!arduinoClient) {
          throw new Error('Arduino client not initialized')
        }

        const fullBoardConfig: BoardConfig = {
          fqbn: boardConfig.fqbn,
          name: boardConfig.name
        }

        // Compile first
        arduinoClient.compile(workspacePath, fullBoardConfig.fqbn)
        const compileResult = await waitForArduinoResponse('compile', 60000)

        let uploadResult: UploadResult

        if (compileResult.success) {
          // Upload if compilation succeeded
          arduinoClient.upload(workspacePath, fullBoardConfig.fqbn, port)
          const uploadResponse = await waitForArduinoResponse('upload', 30000)

          uploadResult = {
            success: uploadResponse.success,
            output: uploadResponse.output,
            error: uploadResponse.error
          }
        } else {
          uploadResult = {
            success: false,
            output: '',
            error: 'Compilation failed, upload skipped'
          }
        }

        return {
          compile: {
            success: compileResult.success,
            output: compileResult.output,
            error: compileResult.error
          },
          upload: uploadResult
        }
      } catch (error) {
        console.error('Error in arduino:compileAndUpload:', error)
        throw error
      }
    }
  )
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

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.handle('ping', () => 'pong')

  // File system handlers
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('read-directory', async (_, dirPath: string, recursive = false) => {
    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true })
      const result: Array<{
        name: string
        path: string
        isDirectory: boolean
        size?: number
        lastModified: number
      }> = []

      for (const item of items) {
        const itemPath = join(dirPath, item.name)
        const stats = await fs.stat(itemPath)

        result.push({
          name: item.name,
          path: itemPath,
          isDirectory: item.isDirectory(),
          size: item.isFile() ? stats.size : undefined,
          lastModified: stats.mtime.getTime()
        })

        if (recursive && item.isDirectory()) {
          const subItems = await fs.readdir(itemPath, { withFileTypes: true })
          for (const subItem of subItems) {
            const subItemPath = join(itemPath, subItem.name)
            const subStats = await fs.stat(subItemPath)

            result.push({
              name: `${item.name}/${subItem.name}`,
              path: subItemPath,
              isDirectory: subItem.isDirectory(),
              size: subItem.isFile() ? subStats.size : undefined,
              lastModified: subStats.mtime.getTime()
            })
          }
        }
      }

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

  // Setup Arduino handlers
  setupArduinoHandlers()

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

// In this file you can include the rest of your app"s main process
// code. You can also put them in separate files and require them here.
