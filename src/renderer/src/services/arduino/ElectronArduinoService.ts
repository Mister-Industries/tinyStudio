/**
 * ElectronArduinoService - Arduino service implementation for Electron environment
 * Connects directly to the Arduino service via WebSocket using @mister-industries/shared
 */

import {
  TinyServiceClient,
  type CompleteData,
  type OutgoingMessage,
  type BoardInfo as SharedBoardInfo
} from '@mister-industries/shared'
import {
  AgentStatus,
  ArduinoService,
  Board,
  BoardConfig,
  BoardInfo,
  CompileResult,
  UploadResult
} from './types'

// Helper function to normalize tinyCore FQBN
function normalizeTinyCoreFqbn(fqbn: string): string {
  if (fqbn.startsWith('tinyCore:')) {
    return 'tinyCore:esp32:tiny_core_esp32s3_nopsram'
  }
  return fqbn
}

/**
 * Arduino service implementation for Electron applications
 * Connects directly to the Arduino service WebSocket from the renderer process
 */
export class ElectronArduinoService implements ArduinoService {
  private client: TinyServiceClient
  private lastListBoardsCall = 0
  private readonly LIST_BOARDS_THROTTLE_MS = 5000 // 5 seconds
  private cachedBoardList: Board[] = []

  constructor() {
    // Initialize the WebSocket client
    this.client = new TinyServiceClient({
      url: 'ws://localhost:3000',
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
}
