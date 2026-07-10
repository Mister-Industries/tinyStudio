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
  BoardDetails,
  BoardInfo,
  CompileResult,
  InstallableBoard,
  LibraryEntry,
  PlatformEntry,
  UploadResult
} from './types'
import { isVirtualPath, virtualFileSystem } from '@renderer/lib/virtualFileSystem'

const DEFAULT_SERVICE_URL = 'ws://localhost:3000'

/**
 * Gather a `mem://` sketch's files into a flat `{ relativePath: content }` map
 * plus a sketch folder name. The browser can't hand tinyService a real disk
 * path (the File System Access API hides absolute paths, and examples live only
 * in memory), so the web build ships the sketch's contents instead and the
 * service materializes them to a temp dir to compile/upload. Desktop never
 * calls this — it passes a real path straight through.
 */
async function collectVirtualSketch(
  sketchDir: string
): Promise<{ files: Record<string, string>; sketchName: string }> {
  const root = sketchDir.endsWith('/') ? sketchDir.slice(0, -1) : sketchDir
  const items = await virtualFileSystem.readDirectory(root, true)
  const files: Record<string, string> = {}
  for (const item of items) {
    if (item.isDirectory) continue
    const rel = item.path.startsWith(root + '/')
      ? item.path.slice(root.length + 1)
      : item.name
    files[rel] = await virtualFileSystem.readFile(item.path)
  }
  if (Object.keys(files).length === 0) {
    throw new Error(`No files found in ${root} to compile`)
  }
  return { files, sketchName: root.slice(root.lastIndexOf('/') + 1) }
}

/**
 * Resolve the tinyService URL. Order: explicit localStorage override (web
 * hosting), the Electron main process's answer (the backend may have bound a
 * non-default port when 3000 was taken), then the default.
 */
function resolveServiceUrl(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const override = localStorage.getItem('tinyservice.url')
      if (override) return override
    }
  } catch {
    /* localStorage may be unavailable (private mode); fall back to default */
  }
  try {
    const desktopUrl = window.api?.service?.getUrlSync?.()
    if (desktopUrl) return desktopUrl
  } catch {
    /* not the Electron build (or preload unavailable) */
  }
  return DEFAULT_SERVICE_URL
}

/**
 * Convert a backend BoardInfo into the renderer's Board shape. The FQBN is
 * passed through untouched: collapsing every tinyCore variant to one FQBN
 * (the old behavior) forced all tinyCore boards to compile for the S3
 * no-PSRAM variant and made other variants unselectable.
 */
function toBoard(info: SharedBoardInfo): Board {
  return {
    port: info.port || '',
    config: {
      fqbn: info.fqbn,
      name: info.name
    },
    connected: true,
    guess: (info as { guess?: boolean }).guess
  }
}

/**
 * Connects to the tinyService WebSocket backend and implements the full
 * Arduino feature set (compile, upload, serial, board/library managers).
 */
export class WebSocketArduinoService implements ArduinoService {
  protected client: TinyServiceClient
  private readonly serviceUrl: string
  /** Latest board list, kept in sync by the backend's board-events pushes. */
  private cachedBoardList: Board[] = []

  /** Last known board list (updated by list-boards replies and board-events pushes). */
  getCachedBoards(): Board[] {
    return this.cachedBoardList
  }

  constructor() {
    // Initialize the WebSocket client
    this.serviceUrl = resolveServiceUrl()
    this.client = new TinyServiceClient({
      url: this.serviceUrl,
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
   * Helper method to wait for Arduino service responses.
   *
   * `requestId` is the id returned by the client's send methods; the backend
   * echoes it on every reply, so concurrent requests of the same action no
   * longer cross-talk. When the backend doesn't echo ids (older tinyService),
   * matching falls back to the action name.
   */
  private waitForResponse(
    action: string,
    timeout = 60000,
    requestId?: string
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
          (output.includes('avrdude done') ||
            output.includes('Upload complete') ||
            // esptool (ESP32 family, incl. tinyCore) success markers
            output.includes('Hash of data verified') ||
            output.includes('Hard resetting'))
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
        // When both sides carry request ids, require an exact match so
        // concurrent requests of the same action don't cross-talk.
        if (requestId !== undefined && message.id !== undefined && message.id !== requestId) {
          return
        }

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
          } else if ((message.data as { details?: unknown }).details) {
            // board-details response — serialize the details object.
            safeResolve({
              success: !hasError,
              output: JSON.stringify((message.data as { details: unknown }).details),
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

      // No throttle/cache needed anymore: the backend serves this instantly
      // from its board watcher's in-memory state (no CLI spawn per call).
      const requestId = this.client.listBoards()
      const result = await this.waitForResponse('list-boards', 10000, requestId)

      if (!result.success) {
        throw new Error(result.error || 'Failed to list boards')
      }

      // Parse board list from output
      const boards: Board[] = []
      try {
        const lines = result.output.split('\n').filter((line) => line.trim())
        for (const line of lines) {
          try {
            boards.push(toBoard(JSON.parse(line) as SharedBoardInfo))
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

      // List all boards and find the one matching the port
      const requestId = this.client.listBoards()
      const result = await this.waitForResponse('list-boards', 10000, requestId)

      if (!result.success) {
        throw new Error(result.error || 'Failed to get board info')
      }

      // Parse and find the specific board
      const lines = result.output.split('\n').filter((line) => line.trim())
      for (const line of lines) {
        try {
          const boardData = JSON.parse(line) as SharedBoardInfo
          if (boardData.port === port) {
            return { ...toBoard(boardData), description: boardData.name }
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

      // Browser: the sketch lives in the in-memory FS with no disk path, so
      // ship its files for the service to materialize and build. Desktop passes
      // the real path straight through.
      let files: Record<string, string> | undefined
      let sketchName: string | undefined
      if (isVirtualPath(workspacePath)) {
        ;({ files, sketchName } = await collectVirtualSketch(workspacePath))
      }

      // Compile the sketch
      console.log(
        `Starting compile operation for workspace: ${workspacePath}, FQBN: ${boardConfig.fqbn}`
      )
      const requestId = this.client.compile(workspacePath, boardConfig.fqbn, files, sketchName)

      // Wait for response with longer timeout for compilation
      const result = await this.waitForResponse('compile', 120000, requestId)

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

      // Browser: ship the in-memory sketch's files; the service compiles them
      // into a temp dir before uploading (arduino-cli's upload needs a build
      // present). Desktop passes the real path and relies on its prior compile.
      let files: Record<string, string> | undefined
      let sketchName: string | undefined
      if (isVirtualPath(workspacePathOrBinary)) {
        ;({ files, sketchName } = await collectVirtualSketch(workspacePathOrBinary!))
      }

      // Upload the sketch
      console.log(
        `Starting upload operation to port: ${port}, FQBN: ${boardConfig.fqbn}, workspace: ${workspacePathOrBinary}`
      )
      const requestId = this.client.upload(
        workspacePathOrBinary || '',
        boardConfig.fqbn,
        port,
        files,
        sketchName
      )

      // Wait for response with longer timeout for upload
      const result = await this.waitForResponse('upload', 90000, requestId)

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
      // Browser: the service compiles the shipped files into a temp dir as part
      // of the upload, so a separate compile pass here would just build in a
      // throwaway dir and double the (slow) compile. Send one upload instead.
      if (isVirtualPath(workspacePath)) {
        const uploadResult = await this.uploadSketch(port, boardConfig, workspacePath)
        return {
          compile: {
            success: uploadResult.success,
            output: uploadResult.success
              ? 'Compiled and uploaded'
              : uploadResult.output || '',
            errors: uploadResult.success
              ? undefined
              : [{ message: uploadResult.error || 'Compilation failed', severity: 'fatal' }]
          },
          upload: uploadResult
        }
      }

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
    const requestId = this.client.libSearch(query)
    const result = await this.waitForResponse('lib-search', 60000, requestId)
    if (!result.success) throw new Error(result.error || 'Library search failed')
    return this.parseLibraries(result.output)
  }

  async listLibraries(): Promise<LibraryEntry[]> {
    if (!this.client) throw new Error('Arduino client not initialized')
    const requestId = this.client.libList()
    const result = await this.waitForResponse('lib-list', 30000, requestId)
    if (!result.success) throw new Error(result.error || 'Library list failed')
    return this.parseLibraries(result.output)
  }

  async installLibrary(
    name: string,
    version?: string
  ): Promise<{ success: boolean; output: string; error?: string }> {
    if (!this.client) throw new Error('Arduino client not initialized')
    const requestId = this.client.libInstall(name, version)
    return this.waitForResponse('lib-install', 300000, requestId)
  }

  async uninstallLibrary(
    name: string
  ): Promise<{ success: boolean; output: string; error?: string }> {
    if (!this.client) throw new Error('Arduino client not initialized')
    const requestId = this.client.libUninstall(name)
    return this.waitForResponse('lib-uninstall', 60000, requestId)
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
    const requestId = this.client.coreSearch(query)
    const result = await this.waitForResponse('core-search', 60000, requestId)
    if (!result.success) throw new Error(result.error || 'Core search failed')
    return this.parseJsonLines<PlatformEntry>(result.output)
  }

  async listCores(): Promise<PlatformEntry[]> {
    if (!this.client) throw new Error('Arduino client not initialized')
    const requestId = this.client.coreList()
    const result = await this.waitForResponse('core-list', 30000, requestId)
    if (!result.success) throw new Error(result.error || 'Core list failed')
    return this.parseJsonLines<PlatformEntry>(result.output)
  }

  async installCore(id: string, version?: string): Promise<ArduinoActionResult> {
    if (!this.client) throw new Error('Arduino client not initialized')
    const requestId = this.client.coreInstall(id, version)
    // Cores (esp32 especially) are large — allow up to 10 minutes.
    return this.waitForResponse('core-install', 600000, requestId)
  }

  async uninstallCore(id: string): Promise<ArduinoActionResult> {
    if (!this.client) throw new Error('Arduino client not initialized')
    const requestId = this.client.coreUninstall(id)
    return this.waitForResponse('core-uninstall', 120000, requestId)
  }

  async listAllBoards(): Promise<InstallableBoard[]> {
    if (!this.client) throw new Error('Arduino client not initialized')
    const requestId = this.client.boardListall()
    const result = await this.waitForResponse('board-listall', 30000, requestId)
    if (!result.success) throw new Error(result.error || 'Board listall failed')
    return this.parseJsonLines<InstallableBoard>(result.output)
  }

  async listBoardUrls(): Promise<string[]> {
    if (!this.client) throw new Error('Arduino client not initialized')
    const requestId = this.client.boardUrlList()
    const result = await this.waitForResponse('board-url-list', 15000, requestId)
    if (!result.success) throw new Error(result.error || 'Board URL list failed')
    return this.parseJsonLines<string>(result.output)
  }

  async addBoardUrl(url: string): Promise<ArduinoActionResult> {
    if (!this.client) throw new Error('Arduino client not initialized')
    const requestId = this.client.boardUrlAdd(url)
    // Adding a URL also refreshes the index, which can take a while.
    return this.waitForResponse('board-url-add', 120000, requestId)
  }

  async removeBoardUrl(url: string): Promise<ArduinoActionResult> {
    if (!this.client) throw new Error('Arduino client not initialized')
    const requestId = this.client.boardUrlRemove(url)
    return this.waitForResponse('board-url-remove', 30000, requestId)
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

  writeSerial(data: string, raw?: boolean): void {
    if (this.client?.isConnected()) this.client.serialWrite(data, raw)
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

  /**
   * Subscribe to serial open/close/error status. Returns an unsubscribe
   * function. The backend only reports `opened` after arduino-cli confirms
   * the port is live, and sends `error` with its explanation when the port
   * could not be opened (busy, missing, …).
   */
  onSerialStatus(
    cb: (status: { opened?: boolean; closed?: boolean; error?: string }) => void
  ): () => void {
    if (!this.client) return () => {}
    return this.client.onMessage((message: OutgoingMessage) => {
      if (message.action !== 'serial') return
      const d = message.data as { opened?: boolean; closed?: boolean; error?: string }
      if (message.type === 'status' && d.opened) cb({ opened: true })
      if (message.type === 'complete' && d.closed) cb({ closed: true })
      if (message.type === 'error' && d.error) cb({ error: d.error })
    })
  }

  // ── board events (server push) ───────────────────────────────────────────────

  /**
   * Subscribe to server-pushed board events. The backend watches
   * `arduino-cli board list --watch` and broadcasts the full board list on
   * every plug/unplug — no client polling. Returns an unsubscribe function.
   */
  onBoardEvents(cb: (boards: Board[]) => void): () => void {
    if (!this.client) return () => {}
    return this.client.onMessage((message: OutgoingMessage) => {
      if (message.action !== 'board-events' || message.type !== 'status') return
      const data = message.data as { boards?: SharedBoardInfo[] }
      if (!Array.isArray(data.boards)) return
      const boards = data.boards.map(toBoard)
      this.cachedBoardList = boards
      cb(boards)
    })
  }

  /**
   * Subscribe to streamed output of a request/response action ("upload",
   * "compile", …). Used e.g. to derive real upload progress from esptool /
   * avrdude output. Returns an unsubscribe function.
   */
  onActionOutput(action: string, cb: (output: string) => void): () => void {
    if (!this.client) return () => {}
    return this.client.onMessage((message: OutgoingMessage) => {
      if (message.action === action && message.type === 'output') {
        cb((message.data as { output: string }).output)
      }
    })
  }

  // ── board details (FQBN config options / programmers) ────────────────────────

  async boardDetails(fqbn: string): Promise<BoardDetails> {
    if (!this.client) throw new Error('Arduino client not initialized')
    const requestId = this.client.boardDetails(fqbn)
    const result = await this.waitForResponse('board-details', 20000, requestId)
    if (!result.success) throw new Error(result.error || 'board-details failed')
    return JSON.parse(result.output) as BoardDetails
  }

  // ── language server ──────────────────────────────────────────────────────────

  /**
   * WebSocket URL of the backend's LSP bridge for a given FQBN. The bridge
   * lives on the same host/port as the main service socket, path /lsp.
   */
  getLspUrl(fqbn: string): string | null {
    try {
      const base = this.serviceUrl.replace(/\/+$/, '')
      return `${base}/lsp?fqbn=${encodeURIComponent(fqbn)}`
    } catch {
      return null
    }
  }
}
