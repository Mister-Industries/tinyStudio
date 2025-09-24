/**
 * WebArduinoService - Arduino service implementation for web environment
 * Communicates with Arduino Create Agent via the official JavaScript client
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import {
  AgentStatus,
  ArduinoService,
  Board,
  BoardConfig,
  BoardInfo,
  CompileResult,
  FileMap,
  UploadResult
} from './types'

/**
 * Arduino service implementation for web applications
 * Uses Arduino Create Agent JavaScript client
 */
export class WebArduinoService implements ArduinoService {
  private daemon: any // Arduino Create Agent client doesn't export types
  private readonly boardsIndexUrl: string
  private isInitialized: boolean = false
  private currentStatus: AgentStatus = { connected: false, lastCheck: 0 }

  constructor(boardsIndexUrl: string = 'https://downloads.arduino.cc/packages/package_index.json') {
    this.boardsIndexUrl = boardsIndexUrl
    this.initializeDaemon()
  }

  /**
   * Initialize the Arduino Create Agent daemon
   */
  private initializeDaemon(): void {
    // Subscribe to agent connection status
    this.daemon.agentFound.subscribe((connected: boolean) => {
      this.currentStatus = {
        connected,
        lastCheck: Date.now(),
        error: connected ? undefined : 'Arduino Create Agent not found'
      }
      this.isInitialized = true
    })

    // Subscribe to channel open status
    this.daemon.channelOpenStatus.subscribe((channelOpen: boolean) => {
      if (this.currentStatus.connected && !channelOpen) {
        this.currentStatus = {
          ...this.currentStatus,
          error: 'Communication channel closed'
        }
      }
    })

    // Subscribe to errors
    this.daemon.error.subscribe((error: any) => {
      console.error('Arduino Create Agent error:', error)
      this.currentStatus = {
        connected: false,
        lastCheck: Date.now(),
        error: error?.message || 'Unknown agent error'
      }
    })
  }

  /**
   * Wait for daemon initialization
   */
  private async waitForInitialization(timeoutMs: number = 5000): Promise<void> {
    const startTime = Date.now()
    while (!this.isInitialized && Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!this.isInitialized) {
      throw new Error('Arduino Create Agent initialization timeout')
    }
  }

  /**
   * Check if Arduino Create Agent is running and available
   */
  async checkStatus(): Promise<AgentStatus> {
    try {
      await this.waitForInitialization()
      return { ...this.currentStatus }
    } catch (error) {
      return {
        connected: false,
        lastCheck: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * List all connected Arduino boards
   */
  async listBoards(): Promise<Board[]> {
    try {
      await this.waitForInitialization()

      if (!this.currentStatus.connected) {
        throw new Error('Arduino Create Agent not connected')
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Board listing timeout'))
        }, 10000)

        // Subscribe to device list updates
        this.daemon.devicesList.subscribe(({ serial, network }: any) => {
          clearTimeout(timeout)

          const boards: Board[] = []

          // Add serial devices
          if (Array.isArray(serial)) {
            boards.push(...serial.map((device: any) => this.convertSerialDeviceToBoard(device)))
          }

          // Add network devices
          if (Array.isArray(network)) {
            boards.push(...network.map((device: any) => this.convertNetworkDeviceToBoard(device)))
          }

          resolve(boards)
        })
      })
    } catch (error) {
      console.error('Error listing boards:', error)
      throw new Error(
        `Failed to list boards: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Get detailed information about a specific board
   */
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

  /**
   * Compile an Arduino sketch using Arduino Create Agent
   * Note: The JS client doesn't have direct compile-only functionality
   */
  async compileSketch(_files: FileMap, _boardConfig: BoardConfig): Promise<CompileResult> {
    const startTime = Date.now()

    try {
      await this.waitForInitialization()

      if (!this.currentStatus.connected) {
        throw new Error('Arduino Create Agent not connected')
      }

      return {
        success: false,
        output:
          'Compilation-only not supported by Arduino Create Agent client. Use compileAndUpload instead.',
        errors: [
          {
            message: 'Use compileAndUpload for compilation and upload together',
            severity: 'error' as const
          }
        ],
        metrics: { duration: Date.now() - startTime }
      }
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown compilation error'

      return {
        success: false,
        output: `Compilation failed: ${errorMessage}`,
        errors: [
          {
            message: errorMessage,
            severity: 'fatal' as const
          }
        ],
        metrics: { duration }
      }
    }
  }

  /**
   * Upload compiled sketch to Arduino board
   */
  async uploadSketch(
    _port: string,
    _boardConfig: BoardConfig,
    _binaryPath?: string
  ): Promise<UploadResult> {
    try {
      throw new Error('Upload requires compilation. Use compileAndUpload instead.')
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : 'Unknown upload error'
      }
    }
  }

  /**
   * Compile and upload sketch in one operation (Arduino Create Agent style)
   */
  async compileAndUpload(
    files: FileMap,
    port: string,
    boardConfig: BoardConfig
  ): Promise<{ compile: CompileResult; upload: UploadResult }> {
    const startTime = Date.now()

    try {
      await this.waitForInitialization()

      if (!this.currentStatus.connected) {
        throw new Error('Arduino Create Agent not connected')
      }

      // Convert FileMap to compilation result format
      const compilationResult = this.convertFileMapToCompilationResult(files, boardConfig)

      // Find the target board
      const boards = await this.listBoards()
      const targetBoard = boards.find((b) => b.port === port)

      if (!targetBoard) {
        throw new Error(`Target board not found on port ${port}`)
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Upload timeout'))
        }, 60000) // 60 second timeout

        let uploadResult: UploadResult = {
          success: false,
          output: '',
          error: 'Upload not completed'
        }

        // Subscribe to upload progress
        this.daemon.uploading.subscribe((status: any) => {
          console.log('Upload status:', status)

          if (status.ProgrammerStatus === 'Done') {
            clearTimeout(timeout)

            const duration = Date.now() - startTime
            const success = status.Flash === 'Ok'

            uploadResult = {
              success,
              output: status.Msg || 'Upload completed',
              progress: { percentage: 100, stage: 'complete' }
            }

            resolve({
              compile: {
                success,
                output: uploadResult.output,
                metrics: { duration }
              },
              upload: uploadResult
            })
          } else if (status.ProgrammerStatus === 'Error') {
            clearTimeout(timeout)

            uploadResult = {
              success: false,
              output: status.Msg || 'Upload failed',
              error: status.Msg || 'Upload error'
            }

            resolve({
              compile: {
                success: false,
                output: uploadResult.output,
                errors: [
                  { message: uploadResult.error || 'Upload failed', severity: 'error' as const }
                ],
                metrics: { duration: Date.now() - startTime }
              },
              upload: uploadResult
            })
          }
        })

        // Start the upload
        try {
          if (targetBoard.protocol === 'network') {
            this.daemon.uploadNetwork(targetBoard, 'sketch', compilationResult)
          } else {
            this.daemon.uploadSerial(targetBoard, 'sketch', compilationResult, false)
          }
        } catch (uploadError) {
          clearTimeout(timeout)
          reject(uploadError)
        }
      })
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      return {
        compile: {
          success: false,
          output: `Error: ${errorMessage}`,
          errors: [{ message: errorMessage, severity: 'fatal' as const }],
          metrics: { duration }
        },
        upload: {
          success: false,
          output: '',
          error: errorMessage
        }
      }
    }
  }

  /**
   * Convert serial device from daemon to Board format
   */
  private convertSerialDeviceToBoard(device: any): Board {
    return {
      port: device.Name || device.port,
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

  /**
   * Convert network device from daemon to Board format
   */
  private convertNetworkDeviceToBoard(device: any): Board {
    return {
      port: device.address || device.ip,
      config: {
        fqbn: device.fqbn || 'esp32:esp32:esp32',
        name: device.name || 'Network Board'
      },
      protocol: 'network',
      connected: true,
      metadata: {
        vendorId: device.vid,
        productId: device.pid
      }
    }
  }

  /**
   * Infer FQBN from device VID/PID
   */
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

  /**
   * Infer board name from device VID/PID
   */
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

  /**
   * Convert FileMap to compilation result format expected by daemon
   */
  private convertFileMapToCompilationResult(files: FileMap, boardConfig: BoardConfig): any {
    // The daemon expects a compilation result object
    // Since we don't have actual compilation, we'll create a mock structure
    const mainFile = Object.keys(files).find((path) => path.endsWith('.ino'))

    if (!mainFile) {
      throw new Error('No .ino file found in sketch')
    }

    // Create a mock hex content (this would normally come from actual compilation)
    const mockHex = btoa(files[mainFile] || '') // Base64 encode the source for now

    return {
      board: boardConfig.fqbn,
      hex: mockHex,
      filename: mainFile.replace('.ino', '.hex'),
      commandline: '',
      signature: '',
      extra: {
        auth: {
          username: null,
          password: null,
          private_key: null,
          port: null
        },
        use_1200bps_touch: true,
        wait_for_upload_port: true
      }
    }
  }
}
