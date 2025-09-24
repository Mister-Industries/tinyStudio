import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { constants, promises as fs } from 'fs'
import path, { join } from 'path'
import { spawn } from 'child_process'
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

interface CompileResult {
  success: boolean
  output: string
  errors?: Array<{
    message: string
    severity: 'error' | 'warning' | 'fatal'
    file?: string
    line?: number
    column?: number
  }>
  metrics?: {
    duration: number
  }
  binaryPath?: string
}

interface UploadResult {
  success: boolean
  output: string
  error?: string
  progress?: {
    percentage: number
    stage: string
  }
}

interface FileMap {
  [filePath: string]: string
}

interface BoardConfig {
  fqbn: string
  name: string
  architecture?: string
  package?: string
  properties?: { [key: string]: string }
}

// Arduino CLI service for main process
class MainArduinoService {
  private cliPath = 'arduino-cli' // Assume arduino-cli is in PATH
  private currentStatus: AgentStatus = { connected: false, lastCheck: 0 }

  constructor() {
    this.currentStatus = {
      connected: false,
      lastCheck: Date.now(),
      error: 'Arduino CLI not initialized'
    }
    this.checkArduinoCLI()
  }

  /**
   * Check if arduino-cli is available and working
   */
  private async checkArduinoCLI(): Promise<void> {
    try {
      const result = await this.executeCommand(['version'])
      if (result.success) {
        this.currentStatus = {
          connected: true,
          lastCheck: Date.now(),
          version: result.output.trim()
        }
      } else {
        throw new Error('Arduino CLI version check failed')
      }
    } catch (error) {
      this.currentStatus = {
        connected: false,
        lastCheck: Date.now(),
        error: error instanceof Error ? error.message : 'Arduino CLI not available'
      }
    }
  }

  /**
   * Execute arduino-cli command
   */
  private async executeCommand(
    args: string[],
    options?: { cwd?: string; input?: string }
  ): Promise<{ success: boolean; output: string; error?: string }> {
    return new Promise((resolve) => {
      const process = spawn(this.cliPath, args, {
        cwd: options?.cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''

      process.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      process.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      if (options?.input) {
        process.stdin?.write(options.input)
        process.stdin?.end()
      }

      process.on('close', (code) => {
        resolve({
          success: code === 0,
          output: stdout,
          error: code !== 0 ? stderr : undefined
        })
      })

      process.on('error', (error) => {
        resolve({
          success: false,
          output: '',
          error: error.message
        })
      })
    })
  }

  async checkStatus(): Promise<AgentStatus> {
    await this.checkArduinoCLI()
    return { ...this.currentStatus }
  }

  async listBoards(): Promise<Board[]> {
    try {
      const result = await this.executeCommand(['board', 'list', '--format', 'json'])

      if (!result.success) {
        console.error('Arduino CLI board list failed:', result.error)
        return []
      }

      const boardData = JSON.parse(result.output)
      const boards: Board[] = []

      if (Array.isArray(boardData)) {
        for (const item of boardData) {
          if (item.matching_boards && Array.isArray(item.matching_boards)) {
            for (const board of item.matching_boards) {
              boards.push({
                port: item.port?.address || item.port?.protocol || 'unknown',
                config: {
                  fqbn: board.fqbn || 'unknown',
                  name: board.name || 'Unknown Board'
                },
                protocol: item.port?.protocol === 'network' ? 'network' : 'serial',
                connected: true,
                metadata: {
                  vendorId: item.port?.properties?.vid,
                  productId: item.port?.properties?.pid,
                  serialNumber: item.port?.properties?.serialNumber
                }
              })
            }
          }
        }
      }

      return boards
    } catch (error) {
      console.error('Error parsing board list:', error)
      return []
    }
  }

  async getBoardInfo(port: string): Promise<BoardInfo> {
    const boards = await this.listBoards()
    const board = boards.find((b) => b.port === port)

    if (!board) {
      throw new Error(`Board not found on port ${port}`)
    }

    return {
      ...board,
      description: `${board.config.name} on ${port}`,
      uploadProtocols: ['serial'],
      capabilities: ['compile', 'upload']
    }
  }

  async compileSketch(files: FileMap, boardConfig: BoardConfig): Promise<CompileResult> {
    const startTime = Date.now()

    try {
      // Create temporary directory for sketch
      const tempDir = join(__dirname, 'temp', `sketch_${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })

      // Write sketch files
      for (const [filePath, content] of Object.entries(files)) {
        const fullPath = join(tempDir, filePath)
        await fs.mkdir(path.dirname(fullPath), { recursive: true })
        await fs.writeFile(fullPath, content)
      }

      // Find main .ino file
      const inoFile = Object.keys(files).find((f) => f.endsWith('.ino'))
      if (!inoFile) {
        throw new Error('No .ino file found in sketch')
      }

      const sketchPath = join(tempDir, inoFile)
      const buildDir = join(tempDir, 'build')

      // Compile the sketch
      const result = await this.executeCommand([
        'compile',
        '--fqbn',
        boardConfig.fqbn,
        '--build-path',
        buildDir,
        sketchPath
      ])

      // Clean up temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }

      const duration = Date.now() - startTime

      if (result.success) {
        return {
          success: true,
          output: result.output,
          metrics: { duration }
        }
      } else {
        // Parse errors from arduino-cli output
        const errors = this.parseCompileErrors(result.error || result.output)
        return {
          success: false,
          output: result.output,
          errors,
          metrics: { duration }
        }
      }
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown compilation error'

      return {
        success: false,
        output: `Compilation failed: ${errorMessage}`,
        errors: [{ message: errorMessage, severity: 'fatal' as const }],
        metrics: { duration }
      }
    }
  }

  async uploadSketch(
    port: string,
    boardConfig: BoardConfig,
    binaryPath?: string
  ): Promise<UploadResult> {
    try {
      if (!binaryPath) {
        throw new Error('Binary path is required for upload')
      }

      const result = await this.executeCommand([
        'upload',
        '--fqbn',
        boardConfig.fqbn,
        '--port',
        port,
        '--input-file',
        binaryPath
      ])

      return {
        success: result.success,
        output: result.output,
        error: result.success ? undefined : result.error
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown upload error'
      return {
        success: false,
        output: '',
        error: errorMessage
      }
    }
  }

  /**
   * Parse compilation errors from arduino-cli output
   */
  private parseCompileErrors(
    output: string
  ): Array<{
    message: string
    severity: 'error' | 'warning' | 'fatal'
    file?: string
    line?: number
  }> {
    const errors: Array<{
      message: string
      severity: 'error' | 'warning' | 'fatal'
      file?: string
      line?: number
    }> = []
    const lines = output.split('\n')

    for (const line of lines) {
      // Match error patterns like "file.ino:10:5: error: message"
      const errorMatch = line.match(/^(.+?):(\d+):(\d+):\s*(error|warning):\s*(.+)$/)
      if (errorMatch) {
        errors.push({
          file: errorMatch[1],
          line: parseInt(errorMatch[2]),
          severity: errorMatch[4] as 'error' | 'warning',
          message: errorMatch[5]
        })
      } else if (line.includes('error:') || line.includes('Error:')) {
        errors.push({
          message: line.trim(),
          severity: 'error' as const
        })
      }
    }

    return errors
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

  ipcMain.handle(
    'arduino:compileSketch',
    async (_, files: FileMap, boardConfig: BoardConfig): Promise<CompileResult> => {
      try {
        return await arduinoService!.compileSketch(files, boardConfig)
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
        return await arduinoService!.uploadSketch(port, boardConfig, binaryPath)
      } catch (error) {
        console.error('Error in arduino:uploadSketch:', error)
        throw error
      }
    }
  )

  // Keep the compileAndUpload handler for backwards compatibility
  ipcMain.handle(
    'arduino:compileAndUpload',
    async (_, files: FileMap, port: string, boardConfig: { fqbn: string; name: string }) => {
      try {
        const fullBoardConfig: BoardConfig = {
          fqbn: boardConfig.fqbn,
          name: boardConfig.name
        }

        // Compile first
        const compileResult = await arduinoService!.compileSketch(files, fullBoardConfig)

        let uploadResult: UploadResult

        if (compileResult.success && compileResult.binaryPath) {
          // Upload if compilation succeeded and we have a binary
          uploadResult = await arduinoService!.uploadSketch(
            port,
            fullBoardConfig,
            compileResult.binaryPath
          )
        } else {
          uploadResult = {
            success: false,
            output: '',
            error: 'Compilation failed, upload skipped'
          }
        }

        return {
          compile: compileResult,
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
