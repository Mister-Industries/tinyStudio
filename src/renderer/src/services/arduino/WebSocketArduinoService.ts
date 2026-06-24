/**
 * WebSocketArduinoService — the real Arduino implementation, shared by both the
 * desktop (Electron) and browser builds.
 *
 * tinyService is always a local WebSocket backend on ws://localhost:3000. The
 * only thing that differs between desktop and web is *who launches it* (the
 * Electron app starts it in-process; in the browser the user runs it
 * themselves). The client logic is identical, so both ElectronArduinoService
 * and WebArduinoService simply extend this class.
 *
 * The service URL defaults to ws://localhost:3000 but can be overridden by
 * setting `localStorage["tinyservice.url"]` — handy when hosting the web build
 * and pointing it at a backend on a non-default port.
 */

import {
  TinyServiceClient,
  type CompleteData,
  type OutgoingMessage,
  type BoardInfo as SharedBoardInfo
} from '@mister-industries/shared'
import {
  AgentStatus,
  ArduinoActionResult,
  ArduinoService,
  Board,
  BoardConfig,
  BoardInfo,
  CompileResult,
  InstallableBoard,
  LibraryEntry,
  PlatformEntry,
  UploadResult
} from './types'

const DEFAULT_SERVICE_URL = 'ws://localhost:3000'

/** Resolve the tinyService URL, allowing a localStorage override for hosting. */
function resolveServiceUrl(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const override = localStorage.getItem('tinyservice.url')
      if (override) return override
    }
  } catch {
    /* localStorage may be unavailable (private mode); fall back to default */
  }
  return DEFAULT_SERVICE_URL
}

// Helper function to normalize tinyCore FQBN
function normalizeTinyCoreFqbn(fqbn: string): string {
  if (fqbn.startsWith('tinyCore:')) {
    return 'tinyCore:esp32:tiny_core_esp32s3_nopsram'
  }
  return fqbn
}

/**
 * Connects to the tinyService WebSocket backend and implements the full
 * Arduino feature set (compile, upload, serial, board/library managers).
 */
export class WebSocketArduinoService implements ArduinoService {
  protected client: TinyServiceClient
  private lastListBoardsCall = 0
  private readonly LIST_BOARDS_THROTTLE_MS = 5000 // 5 seconds
  private cachedBoardList: Board[] = []

  constructor() {
    // Initialize the WebSocket client
    this.client = new TinyServiceClient({
      url: resolveServiceUrl(),
      autoReconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 10,
      debug: true
    })

    // Connect to the service
    this.client.connect()

    // Set up global error handler
    this.client.onError((error) => {
      console.error('Arduino service error:', error)
    })
  }

  /**
   * Cleanup method to disconnect WebSocket client
   */
  public cleanup(): void {
    if (this.client) {
      console.log('Disconnecting Arduino service client...')
      this.client.disconnect()
    }
  }

  /** Whether the WebSocket backend is currently connected. */
  public isConnected(): boolean {
    return !!this.client && this.client.isConnected()
  }

  /**
   * Subscribe to backend connect/disconnect transitions. Returns an
   * unsubscribe function. Used by the UI to surface a clear "backend not
   * running" message instead of failing silently.
   */
  public onConnectionChange(cb: (connected: boolean) => void): () => void {
    if (!this.client) return () => {}
    const offConnect = this.client.onConnect(() => cb(true))
    const offDisconnect = this.client.onDisconnect(() => cb(false))
    return () => {
      offConnect()
      offDisconnect()
    }
  }

  /**
   * Helper method to wait for Arduino service responses
   */
  private waitForResponse(
    action: string,
    timeout = 60000
  ): Promise<{ success: boolean; output: string; error?: string }> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Arduino client not initialized'))
        return
      }

      if (!this.client.isConnected()) {
        reject(new Error('Arduino service not connected'))
        return
      }

      let output = ''
      let hasError = false
      let errorMessage = ''
      let messageUnsubscribe: (() => void) | null = null
      let errorUnsubscribe: (() => void) | null = null
      let isResolved = false

      const cleanup = (): void => {
        clearTimeout(timeoutId)
        if (messageUnsubscribe) messageUnsubscribe()
        if (errorUnsubscribe) errorUnsubscribe()
      }

      const safeResolve = (result: { success: boolean; output: string; error?: string }): void => {
        if (isResolved) return
        isResolved = true
        cleanup()
        resolve(result)
      }

      const safeReject = (error: Error): void => {
        if (isResolved) return
        isResolved = true
        cleanup()
        reject(error)
      }

      const timeoutId = setTimeout(() => {
        console.warn(`[${action}] Operation timed out after ${timeout}ms, output so far:`, output)

        // Check if the operation might have succeeded based on output
        if (action === 'compile' && output.includes('Sketch uses')) {
          console.log(`[${action}] Detected successful compilation from output, resolving...`)
          safeResolve({
            success: !hasError,
            output: output,
            error: hasError ? errorMessage : undefined
          })
        } else if (
          action === 'upload' &&
          (output.includes('avrdude done') || output.includes('Upload complete'))
        ) {
          console.log(`[${action}] Detected successful upload from output, resolving...`)
          safeResolve({
            success: !hasError,
            output: output,
            error: hasError ? errorMessage : undefined
          })
        } else {
          safeReject(new Error(`Operation timed out after ${timeout}ms`))
        }
      }, timeout)

      messageUnsubscribe = this.client.onMessage((message: OutgoingMessage) => {
        // Only handle messages for this action
        if (message.action !== action) return

        console.log(`[${action}] Received message:`, message.type, message.data) // Debug log

        if (message.type === 'output') {
          output += message.data.output + '\n'
        } else if (message.type === 'error') {
          hasError = true
          errorMessage = message.data.error
          if (message.data.details) {
            errorMessage += '\n' + message.data.details
          }
          // For these request/response actions an error is terminal — the
          // handler sends it instead of `complete`. Resolve now (with any
          // streamed/compiler output) so the caller doesn't hang until timeout.
          cleanup()
          safeResolve({
            success: false,
            output: (message.data.output as string) || output,
            error: errorMessage
          })
        } else if (message.type === 'complete') {
          console.log(`[${action}] Operation completed:`, message.data) // Debug log
          cleanup()

          // Handle list-boards response differently
          if (action === 'list-boards') {
            const listBoardsData = message.data as { message: string; boards: SharedBoardInfo[] }
            // Convert boards array to JSON string output (one per line)
            const boardsOutput = listBoardsData.boards
              .map((board) => JSON.stringify(board))
              .join('\n')
            safeResolve({
              success: !hasError,
              output: boardsOutput,
              error: hasError ? errorMessage : undefined
            })
          } else if (Array.isArray((message.data as { libraries?: unknown[] }).libraries)) {
            // Library search/list — serialize libraries to JSON lines
            const libs = (message.data as { libraries: unknown[] }).libraries
            safeResolve({
              success: !hasError,
              output: libs.map((l) => JSON.stringify(l)).join('\n'),
              error: hasError ? errorMessage : undefined
            })
          } else if (
            // Boards Manager list/search responses carry one of these arrays
            // (platforms, boards, urls) — serialize to JSON lines like libraries.
            Array.isArray((message.data as { platforms?: unknown[] }).platforms) ||
            Array.isArray((message.data as { boards?: unknown[] }).boards) ||
            Array.isArray((message.data as { urls?: unknown[] }).urls)
          ) {
            const d = message.data as {
              platforms?: unknown[]
              boards?: unknown[]
              urls?: unknown[]
            }
            const arr = d.platforms || d.boards || d.urls || []
            safeResolve({
              success: !hasError,
              output: arr.map((x) => JSON.stringify(x)).join('\n'),
              error: hasError ? errorMessage : undefined
            })
          } else {
            // Default handling for other actions
            const completeData = message.data as CompleteData
            safeResolve({
              success: completeData.success && !hasError,
              output: completeData.output || output,
              error: hasError ? errorMessage : completeData.error
            })
          }
        }
      })

      errorUnsubscribe = this.client.onError((error) => {
        console.error(`[${action}] WebSocket error:`, error)
        safeReject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  /**
   * Check arduino-cli availability
   */
  async checkStatus(): Promise<AgentStatus> {
    try {
      if (!this.client || !this.client.isConnected()) {
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
  }

  /**
   * List connected Arduino boards
   */
  async listBoards(): Promise<Board[]> {
    try {
      if (!this.client) {
        throw new Error('Arduino client not initialized')
      }

      // Throttle list-boards calls to once every 5 seconds
      const now = Date.now()
      const timeSinceLastCall = now - this.lastListBoardsCall

      if (timeSinceLastCall < this.LIST_BOARDS_THROTTLE_MS) {
        console.log(
          `Throttling list-boards call. ${this.LIST_BOARDS_THROTTLE_MS - timeSinceLastCall}ms until next allowed call. Returning cached result.`
        )
        // Return cached result instead of making a new request
        return this.cachedBoardList
      }

      this.lastListBoardsCall = now

      // Request list of boards
      this.client.listBoards()

      // Wait for response
      const result = await this.waitForResponse('list-boards', 10000)

      if (!result.success) {
        throw new Error(result.error || 'Failed to list boards')
      }

      // Parse board list from output
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
      this.cachedBoardList = boards

      return boards
    } catch (error) {
      console.error('Error listing boards:', error)
      throw new Error(
        `Failed to list boards: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Get board information
   */
  async getBoardInfo(port: string): Promise<BoardInfo> {
    try {
      if (!this.client) {
        throw new Error('Arduino client not initialized')
      }

      // Check throttle for list-boards
      const now = Date.now()
      const timeSinceLastCall = now - this.lastListBoardsCall

      if (timeSinceLastCall < this.LIST_BOARDS_THROTTLE_MS) {
        console.log(
          `Throttling getBoardInfo list-boards call. ${this.LIST_BOARDS_THROTTLE_MS - timeSinceLastCall}ms until next allowed call`
        )
        throw new Error('Board list request throttled. Please wait a moment and try again.')
      }

      this.lastListBoardsCall = now

      // List all boards and find the one matching the port
      this.client.listBoards()
      const result = await this.waitForResponse('list-boards', 10000)

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
      console.error('Error getting board info:', error)
      throw new Error(
        `Failed to get board info: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Compile Arduino sketch
   */
  async compileSketch(workspacePath: string, boardConfig: BoardConfig): Promise<CompileResult> {
    try {
      if (!this.client) {
        throw new Error('Arduino client not initialized')
      }

      // Compile the sketch
      console.log(
        `Starting compile operation for workspace: ${workspacePath}, FQBN: ${boardConfig.fqbn}`
      )
      this.client.compile(workspacePath, boardConfig.fqbn)

      // Wait for response with longer timeout for compilation
      const result = await this.waitForResponse('compile', 120000)

      return {
        success: result.success,
        output: result.output,
        errors: result.error ? [{ message: result.error, severity: 'fatal' as const }] : undefined
      }
    } catch (error) {
      console.error('Error compiling sketch:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        output: `Compilation failed: ${errorMessage}`,
        errors: [{ message: errorMessage, severity: 'fatal' as const }],
        metrics: { duration: 0 }
      }
    }
  }

  /**
   * Upload sketch
   */
  async uploadSketch(
    port: string,
    boardConfig: BoardConfig,
    workspacePathOrBinary?: string
  ): Promise<UploadResult> {
    try {
      if (!this.client) {
        throw new Error('Arduino client not initialized')
      }

      // Upload the sketch
      console.log(
        `Starting upload operation to port: ${port}, FQBN: ${boardConfig.fqbn}, workspace: ${workspacePathOrBinary}`
      )
      this.client.upload(workspacePathOrBinary || '', boardConfig.fqbn, port)

      // Wait for response with longer timeout for upload
      const result = await this.waitForResponse('upload', 90000)

      return {
        success: result.success,
        output: result.output,
        error: result.error
      }
    } catch (error) {
      console.error('Error uploading sketch:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        output: `Upload failed: ${errorMessage}`,
        error: errorMessage
      }
    }
  }

  /**
   * Compile and upload sketch
   */
  async compileAndUpload(
    workspacePath: string,
    port: string,
    boardConfig: BoardConfig
  ): Promise<{ compile: CompileResult; upload: UploadResult }> {
    try {
      // Compile first
      const compileResult = await this.compileSketch(workspacePath, boardConfig)

      let uploadResult: UploadResult

      if (compileResult.success) {
        // Upload if compilation succeeded
        uploadResult = await this.uploadSketch(port, boardConfig, workspacePath)
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      return {
        compile: {
          success: false,
          output: `Error: ${errorMessage}`,
          errors: [{ message: errorMessage, severity: 'fatal' as const }],
          metrics: { duration: 0 }
        },
        upload: {
          success: false,
          output: '',
          error: errorMessage
        }
      }
    }
  }

  // ── library manager ────────────────────────────────────────────────────────

  private parseLibraries(output: string): LibraryEntry[] {
    return output
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as LibraryEntry
        } catch {
          return null
        }
      })
      .filter((l): l is LibraryEntry => l !== null)
  }

  async searchLibraries(query: string): Promise<LibraryEntry[]> {
    if (!this.client) throw new Error('Arduino client not initialized')
    this.client.libSearch(query)
    const result = await this.waitForResponse('lib-search', 60000)
    if (!result.success) throw new Error(result.error || 'Library search failed')
    return this.parseLibraries(result.output)
  }

  async listLibraries(): Promise<LibraryEntry[]> {
    if (!this.client) throw new Error('Arduino client not initialized')
    this.client.libList()
    const result = await this.waitForResponse('lib-list', 30000)
    if (!result.success) throw new Error(result.error || 'Library list failed')
    return this.parseLibraries(result.output)
  }

  async installLibrary(
    name: string,
    version?: string
  ): Promise<{ success: boolean; output: string; error?: string }> {
    if (!this.client) throw new Error('Arduino client not initialized')
    this.client.libInstall(name, version)
    return this.waitForResponse('lib-install', 300000)
  }

  async uninstallLibrary(
    name: string
  ): Promise<{ success: boolean; output: string; error?: string }> {
    if (!this.client) throw new Error('Arduino client not initialized')
    this.client.libUninstall(name)
    return this.waitForResponse('lib-uninstall', 60000)
  }

  // ── boards manager ───────────────────────────────────────────────────────────

  /** Parse JSON-lines output (one object/string per line) into a typed array. */
  private parseJsonLines<T>(output: string): T[] {
    return output
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as T
        } catch {
          return null
        }
      })
      .filter((x): x is T => x !== null)
  }

  async searchCores(query: string): Promise<PlatformEntry[]> {
    if (!this.client) throw new Error('Arduino client not initialized')
    this.client.coreSearch(query)
    const result = await this.waitForResponse('core-search', 60000)
    if (!result.success) throw new Error(result.error || 'Core search failed')
    return this.parseJsonLines<PlatformEntry>(result.output)
  }

  async listCores(): Promise<PlatformEntry[]> {
    if (!this.client) throw new Error('Arduino client not initialized')
    this.client.coreList()
    const result = await this.waitForResponse('core-list', 30000)
    if (!result.success) throw new Error(result.error || 'Core list failed')
    return this.parseJsonLines<PlatformEntry>(result.output)
  }

  async installCore(id: string, version?: string): Promise<ArduinoActionResult> {
    if (!this.client) throw new Error('Arduino client not initialized')
    this.client.coreInstall(id, version)
    // Cores (esp32 especially) are large — allow up to 10 minutes.
    return this.waitForResponse('core-install', 600000)
  }

  async uninstallCore(id: string): Promise<ArduinoActionResult> {
    if (!this.client) throw new Error('Arduino client not initialized')
    this.client.coreUninstall(id)
    return this.waitForResponse('core-uninstall', 120000)
  }

  async listAllBoards(): Promise<InstallableBoard[]> {
    if (!this.client) throw new Error('Arduino client not initialized')
    this.client.boardListall()
    const result = await this.waitForResponse('board-listall', 30000)
    if (!result.success) throw new Error(result.error || 'Board listall failed')
    return this.parseJsonLines<InstallableBoard>(result.output)
  }

  async listBoardUrls(): Promise<string[]> {
    if (!this.client) throw new Error('Arduino client not initialized')
    this.client.boardUrlList()
    const result = await this.waitForResponse('board-url-list', 15000)
    if (!result.success) throw new Error(result.error || 'Board URL list failed')
    return this.parseJsonLines<string>(result.output)
  }

  async addBoardUrl(url: string): Promise<ArduinoActionResult> {
    if (!this.client) throw new Error('Arduino client not initialized')
    this.client.boardUrlAdd(url)
    // Adding a URL also refreshes the index, which can take a while.
    return this.waitForResponse('board-url-add', 120000)
  }

  async removeBoardUrl(url: string): Promise<ArduinoActionResult> {
    if (!this.client) throw new Error('Arduino client not initialized')
    this.client.boardUrlRemove(url)
    return this.waitForResponse('board-url-remove', 30000)
  }

  // ── serial monitor (streaming, not request/response) ─────────────────────────

  openSerial(port: string, baud: number): void {
    if (this.client?.isConnected()) this.client.serialOpen(port, baud)
  }

  // Guard against a dropped backend: serialClose() sends over the socket, which
  // throws "WebSocket is not connected" if the backend already went away. That
  // throw escaped React cleanup and blanked the whole app, so skip it when the
  // socket is down — there's nothing to close anyway.
  closeSerial(): void {
    if (this.client?.isConnected()) this.client.serialClose()
  }

  writeSerial(data: string): void {
    if (this.client?.isConnected()) this.client.serialWrite(data)
  }

  /** Subscribe to streamed serial lines. Returns an unsubscribe function. */
  onSerialData(cb: (line: string) => void): () => void {
    if (!this.client) return () => {}
    return this.client.onMessage((message: OutgoingMessage) => {
      if (message.action === 'serial' && message.type === 'output') {
        cb((message.data as { output: string }).output)
      }
    })
  }

  /** Subscribe to serial open/close status. Returns an unsubscribe function. */
  onSerialStatus(cb: (status: { opened?: boolean; closed?: boolean }) => void): () => void {
    if (!this.client) return () => {}
    return this.client.onMessage((message: OutgoingMessage) => {
      if (message.action !== 'serial') return
      const d = message.data as { opened?: boolean; closed?: boolean }
      if (message.type === 'status' && d.opened) cb({ opened: true })
      if (message.type === 'complete' && d.closed) cb({ closed: true })
    })
  }
}
