import { spawn, type ChildProcess } from 'child_process'
import { app, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import path from 'path'

interface ServiceConfig {
  port: number
  allowedOrigins: string[]
}

interface HealthCheckResponse {
  status: string
  arduinoCli: {
    available: boolean
    path: string
  }
  service: {
    port: number
  }
}

export class ServiceManager {
  private child: ChildProcess | null = null
  private config: ServiceConfig
  private isRunning = false
  private mainWindow: BrowserWindow | null = null

  constructor(config: ServiceConfig = { port: 3000, allowedOrigins: ['*'] }) {
    this.config = config
  }

  /**
   * Set the main window for error reporting
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * Send error to renderer process
   */
  private sendErrorToRenderer(message: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[ServiceManager] ${message}:`, errorMessage)
    
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('service:error', {
        message,
        error: errorMessage
      })
    }
  }

  /**
   * Build the tiny Node program that boots TinyService in the child process.
   * We pass config explicitly (port, arduino-cli path) so we don't depend on the
   * service's own env/config handling. JSON.stringify keeps Windows paths valid.
   */
  private buildLauncherCode(arduinoCliPath: string): string {
    const opts = JSON.stringify({
      port: this.config.port,
      arduinoCliPath,
      allowedOrigins: this.config.allowedOrigins
    })
    return [
      `import('@mister-industries/tinyservice')`,
      `.then((m) => new m.TinyService(${opts}).start())`,
      `.then(() => console.log('[tinyService] started'))`,
      `.catch((e) => { console.error('[tinyService] failed to start:', (e && e.stack) || e); process.exit(1) })`
    ].join('\n')
  }

  /**
   * Resolve the arduino-cli binary path based on the platform and architecture
   */
  private resolveArduinoCliPath(): string {
    // In development, prefer the binary fetched into vendor/ (so a fresh clone
    // works after `npm install` with no global arduino-cli). Fall back to a
    // system arduino-cli on PATH if the vendored copy isn't present.
    if (!app.isPackaged) {
      return this.resolveVendoredArduinoCliPath() ?? 'arduino-cli'
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
   * Resolve the arduino-cli binary fetched by scripts/fetch-arduino-cli.mjs into
   * vendor/arduino-cli/<platform>/ (used in development). Returns null if it
   * isn't present so the caller can fall back to a system arduino-cli on PATH.
   *
   * Note: the vendor directory names (macos-x64, windows-x64, …) differ from the
   * packaged resourcesPath names (darwin-x64, win32-x64, …).
   */
  private resolveVendoredArduinoCliPath(): string | null {
    const arch = process.arch
    let platformDir: string
    let binaryName = 'arduino-cli'

    if (process.platform === 'win32') {
      platformDir = 'windows-x64'
      binaryName = 'arduino-cli.exe'
    } else if (process.platform === 'darwin') {
      platformDir = arch === 'arm64' ? 'macos-arm64' : 'macos-x64'
    } else if (process.platform === 'linux') {
      platformDir = arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
    } else {
      return null
    }

    const vendored = path.join(app.getAppPath(), 'vendor', 'arduino-cli', platformDir, binaryName)
    return existsSync(vendored) ? vendored : null
  }

  /**
   * Check service health via HTTP endpoint
   */
  private async checkServiceHealth(): Promise<HealthCheckResponse> {
    const response = await fetch(`http://localhost:${this.config.port}/health`)
    if (!response.ok) {
      throw new Error(`Health check failed with status ${response.status}`)
    }
    return await response.json()
  }

  /**
   * Verify service is running and configured correctly
   */
  private async verifyServiceHealth(maxRetries = 3, retryDelayMs = 1000): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[ServiceManager] Health check attempt ${attempt}/${maxRetries}`)
        const health = await this.checkServiceHealth()
        
        if (health.status !== 'ok') {
          throw new Error(`Service health check returned status: ${health.status}`)
        }

        console.log('[ServiceManager] Service health check passed')
        console.log(`[ServiceManager] Arduino CLI available: ${health.arduinoCli.available}`)
        console.log(`[ServiceManager] Arduino CLI path: ${health.arduinoCli.path}`)

        if (!health.arduinoCli.available) {
          const warningMessage = 'Arduino CLI is not available on the service'
          console.warn(`[ServiceManager] WARNING: ${warningMessage}`)
          this.sendErrorToRenderer(warningMessage, new Error('Arduino CLI not found at configured path'))
        }

        return
      } catch (error) {
        console.warn(`[ServiceManager] Health check attempt ${attempt} failed:`, error)
        
        if (attempt === maxRetries) {
          throw new Error(`Service health check failed after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`)
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelayMs))
      }
    }
  }

  /**
   * Start TinyService as a child Node process.
   *
   * We deliberately spawn it instead of importing it in-process: tinyService is
   * an ESM package, and Electron's main-process ESM loader can't reliably import
   * ESM that's bundled with the app. Running it under Electron's own binary in
   * Node mode (ELECTRON_RUN_AS_NODE) uses the plain Node ESM loader, which loads
   * it fine — and isolates the backend in its own process. `cwd` points at the
   * app root so the child resolves @mister-industries/tinyservice from
   * node_modules (which is why asar must stay disabled — see electron-builder.yml).
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[ServiceManager] TinyService is already running')
      return
    }

    try {
      const arduinoCliPath = this.resolveArduinoCliPath()
      // out/main → app root (two levels up); node_modules lives here in dev and
      // in the packaged app (asar disabled).
      const cwd = path.resolve(__dirname, '..', '..')

      console.log(`[ServiceManager] Spawning TinyService on port ${this.config.port}`)
      console.log(`[ServiceManager] Arduino CLI path: ${arduinoCliPath}`)
      console.log(`[ServiceManager] Service cwd: ${cwd}`)

      this.child = spawn(process.execPath, ['-e', this.buildLauncherCode(arduinoCliPath)], {
        cwd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      this.child.stdout?.on('data', (d: Buffer) => console.log(`[tinyService] ${d.toString().trim()}`))
      this.child.stderr?.on('data', (d: Buffer) =>
        console.error(`[tinyService] ${d.toString().trim()}`)
      )
      this.child.on('error', (err) => this.sendErrorToRenderer('TinyService process error', err))
      this.child.on('exit', (code) => {
        if (code) console.warn(`[ServiceManager] TinyService process exited with code ${code}`)
        this.isRunning = false
        this.child = null
      })

      // Give the spawned process time to boot, then confirm it's serving.
      await this.verifyServiceHealth(10, 1000)

      this.isRunning = true
      console.log(`[ServiceManager] TinyService started on ws://localhost:${this.config.port}`)
    } catch (error) {
      this.sendErrorToRenderer('Failed to start TinyService', error)
      if (this.child) {
        this.child.kill()
        this.child = null
      }
      throw error
    }
  }

  /**
   * Stop the TinyService child process.
   */
  async stop(): Promise<void> {
    if (!this.child) {
      console.log('[ServiceManager] TinyService is not running')
      this.isRunning = false
      return
    }

    try {
      console.log('[ServiceManager] Stopping TinyService...')
      this.child.kill()
      this.child = null
      this.isRunning = false
      console.log('[ServiceManager] TinyService stopped')
    } catch (error) {
      this.sendErrorToRenderer('Failed to stop TinyService', error)
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
