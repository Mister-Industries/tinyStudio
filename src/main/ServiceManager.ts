import { app } from 'electron'
import path from 'path'

interface ServiceConfig {
  port: number
  allowedOrigins: string[]
}

interface TinyServiceInstance {
  start(): Promise<void>
  stop(): Promise<void>
}

export class ServiceManager {
  private service: TinyServiceInstance | null = null
  private config: ServiceConfig
  private isRunning = false

  constructor(config: ServiceConfig = { port: 3000, allowedOrigins: ['*'] }) {
    this.config = config
  }

  /**
   * Dynamically import TinyService (handles ESM in CommonJS context)
   */
  private async importTinyService() {
    const module = await import('@mister-industries/tinyservice')
    return module.TinyService
  }

  /**
   * Resolve the arduino-cli binary path based on the platform and architecture
   */
  private resolveArduinoCliPath(): string {
    // In development, use system arduino-cli
    if (!app.isPackaged) {
      return 'arduino-cli'
    }

    // In production, resolve from bundled resources
    const platform = process.platform
    const arch = process.arch

    // Map platform and arch to the directory structure
    let platformDir: string
    let binaryName: string

    if (platform === 'darwin') {
      platformDir = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'
      binaryName = 'arduino-cli'
    } else if (platform === 'win32') {
      platformDir = 'win32-x64'
      binaryName = 'arduino-cli.exe'
    } else if (platform === 'linux') {
      platformDir = arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
      binaryName = 'arduino-cli'
    } else {
      throw new Error(`Unsupported platform: ${platform}`)
    }

    const arduinoCliPath = path.join(process.resourcesPath, 'arduino-cli', platformDir, binaryName)

    return arduinoCliPath
  }

  /**
   * Start the TinyService WebSocket server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('TinyService is already running')
      return
    }

    try {
      const TinyService = await this.importTinyService()
      const arduinoCliPath = this.resolveArduinoCliPath()

      console.log(`Starting TinyService on port ${this.config.port}`)
      console.log(`Arduino CLI path: ${arduinoCliPath}`)

      this.service = new TinyService({
        port: this.config.port,
        arduinoCliPath,
        allowedOrigins: this.config.allowedOrigins
      })

      await this.service.start()

      this.isRunning = true
      console.log(`TinyService started successfully on ws://localhost:${this.config.port}`)
    } catch (error) {
      console.error('Failed to start TinyService:', error)
      throw error
    }
  }

  /**
   * Stop the TinyService WebSocket server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.service) {
      console.log('TinyService is not running')
      return
    }

    try {
      console.log('Stopping TinyService...')
      await this.service.stop()
      this.service = null
      this.isRunning = false
      console.log('TinyService stopped successfully')
    } catch (error) {
      console.error('Failed to stop TinyService:', error)
      throw error
    }
  }

  /**
   * Check if the service is currently running
   */
  isServiceRunning(): boolean {
    return this.isRunning
  }

  /**
   * Get the current service configuration
   */
  getConfig(): ServiceConfig {
    return { ...this.config }
  }
}
