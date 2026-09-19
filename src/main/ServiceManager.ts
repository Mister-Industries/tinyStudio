import { spawn, type ChildProcess } from 'child_process'
import { app, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import os from 'os'
import path from 'path'
import { findFreePort } from './freePort'
import { decideAfterExit } from './serviceRestart'

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
  // start() in progress, so a second caller waits for it instead of spawning twice.
  private starting: Promise<void> | null = null
  // stop() asked the child to exit, so its exit isn't a crash.
  private stopping = false
  // When the last automatic restart happened (serviceRestart.ts).
  private lastRestartAt: number | null = null
  // The port is chosen once. The renderer builds its WebSocket URL at startup
  // and never re-reads it, so every restart must reuse the same port.
  private portChosen = false
  // Why the service isn't running, for a renderer that mounts after the fact.
  private lastError: string | null = null

  constructor(config: ServiceConfig) {
    this.config = config
  }

  /**
   * Set the main window for error reporting
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * Send an error to the renderer (BackendPrompt listens). `stopped` means the
   * service isn't running and won't come back on its own; the renderer then
   * offers a Restart button.
   */
  private sendErrorToRenderer(message: string, error: unknown, opts?: { stopped: boolean }): void {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[ServiceManager] ${message}:`, errorMessage)
    if (opts?.stopped) this.lastError = errorMessage

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('service:error', {
        message,
        error: errorMessage,
        stopped: opts?.stopped ?? false
      })
    }
  }

  /** Report a start failure to the renderer; the caller decides the wording. */
  reportStartFailure(message: string, error: unknown): void {
    this.sendErrorToRenderer(message, error, { stopped: true })
  }

  /**
   * Build the tiny Node program that boots TinyService in the child process.
   * We pass config explicitly (port, arduino-cli path) so we don't depend on the
   * service's own env/config handling. JSON.stringify keeps Windows paths valid.
   */
  private buildLauncherCode(arduinoCliPath: string): string {
    const lsPaths = this.resolveLanguageServerPaths()
    const opts = JSON.stringify({
      port: this.config.port,
      arduinoCliPath,
      allowedOrigins: this.config.allowedOrigins,
      // Language-server integration (optional; the service degrades to
      // "lsp-unavailable" when the binaries aren't present).
      lspServerPath: lsPaths?.lspServerPath,
      clangdPath: lsPaths?.clangdPath,
      cliConfigPath: this.resolveArduinoCliConfigPath()
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
   * Resolve the arduino-language-server + clangd binaries fetched by
   * scripts/fetch-language-server.mjs into vendor/language-server/<platform>/
   * (dev) or bundled resources (packaged). Returns null when missing; the
   * backend then reports the LSP as unavailable and the editor degrades to
   * syntax-highlighting only.
   */
  private resolveLanguageServerPaths(): {
    lspServerPath: string
    clangdPath: string
  } | null {
    const arch = process.arch
    let platformDir: string
    let exe = ''

    if (process.platform === 'win32') {
      platformDir = 'windows-x64'
      exe = '.exe'
    } else if (process.platform === 'darwin') {
      platformDir = arch === 'arm64' ? 'macos-arm64' : 'macos-x64'
    } else if (process.platform === 'linux') {
      platformDir = arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
    } else {
      return null
    }

    const root = app.isPackaged
      ? path.join(process.resourcesPath, 'language-server', platformDir)
      : path.join(app.getAppPath(), 'vendor', 'language-server', platformDir)

    const lspServerPath = path.join(root, `arduino-language-server${exe}`)
    const clangdPath = path.join(root, `clangd${exe}`)
    if (existsSync(lspServerPath) && existsSync(clangdPath)) {
      return { lspServerPath, clangdPath }
    }
    return null
  }

  /**
   * Default arduino-cli.yaml location (the language server wants the config
   * file arduino-cli itself uses). Returns undefined when the file doesn't
   * exist yet; arduino-cli works on defaults without one.
   */
  private resolveArduinoCliConfigPath(): string | undefined {
    let candidate: string
    if (process.platform === 'win32') {
      candidate = path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'Arduino15',
        'arduino-cli.yaml'
      )
    } else if (process.platform === 'darwin') {
      candidate = path.join(os.homedir(), 'Library', 'Arduino15', 'arduino-cli.yaml')
    } else {
      candidate = path.join(os.homedir(), '.arduino15', 'arduino-cli.yaml')
    }
    return existsSync(candidate) ? candidate : undefined
  }

  /**
   * ws:// URL of the running service (port may differ from the default 3000).
   * 127.0.0.1 rather than localhost: tinyService 1.2 binds IPv4 loopback only,
   * and a client that resolves localhost to ::1 first would be refused.
   */
  getServiceUrl(): string {
    return `ws://127.0.0.1:${this.config.port}`
  }

  /**
   * Check service health via HTTP endpoint
   */
  private async checkServiceHealth(): Promise<HealthCheckResponse> {
    const response = await fetch(`http://127.0.0.1:${this.config.port}/health`)
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
          this.sendErrorToRenderer(
            warningMessage,
            new Error('Arduino CLI not found at configured path')
          )
        }

        return
      } catch (error) {
        console.warn(`[ServiceManager] Health check attempt ${attempt} failed:`, error)

        if (attempt === maxRetries) {
          throw new Error(
            `Service health check failed after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`
          )
        }

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
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
   * it fine, and isolates the backend in its own process. `cwd` points at the
   * app root so the child resolves @mister-industries/tinyservice from
   * node_modules (which is why asar must stay disabled; see electron-builder.yml).
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[ServiceManager] TinyService is already running')
      return
    }
    if (!this.starting) {
      this.starting = this.spawnAndVerify().finally(() => {
        this.starting = null
      })
    }
    return this.starting
  }

  private async spawnAndVerify(): Promise<void> {
    this.stopping = false
    try {
      // Bind to a free port: 3000 may be taken by another dev server. Only on
      // the first start: restarts keep the port (see portChosen).
      if (!this.portChosen) {
        this.config.port = await findFreePort(this.config.port)
        this.portChosen = true
      }

      const arduinoCliPath = this.resolveArduinoCliPath()
      // out/main → app root (two levels up); node_modules lives here in dev and
      // in the packaged app (asar disabled).
      const cwd = path.resolve(__dirname, '..', '..')

      console.log(`[ServiceManager] Spawning TinyService on port ${this.config.port}`)
      console.log(`[ServiceManager] Arduino CLI path: ${arduinoCliPath}`)
      console.log(`[ServiceManager] Service cwd: ${cwd}`)

      const child = spawn(process.execPath, ['-e', this.buildLauncherCode(arduinoCliPath)], {
        cwd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      this.child = child

      child.stdout?.on('data', (d: Buffer) => console.log(`[tinyService] ${d.toString().trim()}`))
      child.stderr?.on('data', (d: Buffer) => console.error(`[tinyService] ${d.toString().trim()}`))
      // A spawn failure also fails the health check below, which reports it.
      child.on('error', (err) => console.error('[ServiceManager] TinyService process error:', err))
      child.on('exit', (code, signal) => {
        // A child we've already replaced must not touch the current state.
        if (this.child !== child) return
        this.isRunning = false
        this.child = null
        void this.handleExit(code, signal)
      })

      // Give the spawned process time to boot, then confirm it's serving. A
      // cold start on a busy or slow machine can take well over ten seconds.
      await this.verifyServiceHealth(30, 1000)

      this.isRunning = true
      this.lastError = null
      console.log(`[ServiceManager] TinyService started on ${this.getServiceUrl()}`)
    } catch (error) {
      if (this.child) {
        this.child.kill()
        this.child = null
      }
      throw error
    }
  }

  /**
   * The child exited without stop() asking. Restart it once on the same port
   * so the renderer's URL stays valid. If the restart fails, or the service
   * dies again within a minute, tell the renderer instead (it shows the error
   * with a Restart button).
   */
  private async handleExit(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    const reason = signal ? `was killed by ${signal}` : `exited with code ${code}`
    const decision = decideAfterExit({
      stopping: this.stopping,
      lastRestartAt: this.lastRestartAt,
      now: Date.now()
    })
    if (decision === 'ignore') return
    console.warn(`[ServiceManager] TinyService ${reason}`)
    if (decision === 'give-up') {
      this.sendErrorToRenderer(
        'tinyService stopped',
        new Error(`It ${reason} less than a minute after being restarted.`),
        { stopped: true }
      )
      return
    }
    this.lastRestartAt = Date.now()
    console.log('[ServiceManager] Restarting TinyService')
    try {
      await this.start()
      console.log('[ServiceManager] TinyService restarted')
    } catch (error) {
      this.sendErrorToRenderer(
        'tinyService stopped',
        new Error(
          `It ${reason} and couldn't be restarted: ${error instanceof Error ? error.message : String(error)}`
        ),
        { stopped: true }
      )
    }
  }

  /** Restart on request from the renderer. Resets the automatic-restart budget. */
  async restart(): Promise<void> {
    await this.stop()
    this.lastRestartAt = null
    await this.start()
  }

  /** For a renderer that mounts after the service already failed. */
  getStatus(): { running: boolean; error: string | null } {
    return { running: this.isRunning, error: this.lastError }
  }

  /**
   * Stop the TinyService child process.
   */
  async stop(): Promise<void> {
    const child = this.child
    if (!child) {
      console.log('[ServiceManager] TinyService is not running')
      this.isRunning = false
      return
    }

    console.log('[ServiceManager] Stopping TinyService...')
    // Mark the exit as ours before it happens, then wait for it (briefly) so
    // a restart doesn't race the old child's exit handler.
    this.stopping = true
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill()
    })
    if (this.child === child) this.child = null
    this.isRunning = false
    console.log('[ServiceManager] TinyService stopped')
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
