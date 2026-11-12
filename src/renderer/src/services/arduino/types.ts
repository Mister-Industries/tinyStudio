/**
 * TypeScript interfaces and types for Arduino compilation and flashing
 */

/**
 * Map of file paths to their content for compilation
 * Keys are relative paths within the sketch directory
 */
export type FileMap = { [filePath: string]: string }

/**
 * Arduino board configuration
 */
export interface BoardConfig {
  /** Fully Qualified Board Name (e.g., "arduino:avr:uno") */
  fqbn: string
  /** Human-readable board name (e.g., "Arduino Uno") */
  name: string
  /** Board architecture (e.g., "avr", "esp32") */
  architecture?: string
  /** Board package (e.g., "arduino") */
  package?: string
  /** Additional board properties */
  properties?: { [key: string]: string }
}

/**
 * Connected Arduino board information
 */
export interface Board {
  /** Port identifier (e.g., "COM3", "/dev/ttyUSB0") */
  port: string
  /** Board configuration */
  config: BoardConfig
  /** Connection protocol (e.g., "serial") */
  protocol?: string
  /** Whether the board is currently connected */
  connected: boolean
  /**
   * True when the board identity was guessed from USB VID/PID rather than
   * matched by arduino-cli; the user should be able to override it via the
   * "choose board for this port" picker.
   */
  guess?: boolean
  /**
   * True for a discovery-only placeholder match (`hide=true` in boards.txt,
   * e.g. "ESP32 Family Device"): it names the port but can't be built for.
   */
  isHidden?: boolean
  /**
   * Where this port's board came from:
   *  - remembered: the user chose it for this device before (board history)
   *  - detected: arduino-cli matched the device to an installed board
   *  - assumed: a generic ESP32 (USB 303a:1001) with nothing more specific,
   *    defaulted to tinyCore
   *  - unknown: nothing matched; the user has to pick a board type
   */
  source?: 'remembered' | 'detected' | 'assumed' | 'unknown'
  /** Stable key for this physical device (see lib/boardHistory.ts). */
  deviceKey?: string
  /** Other boards arduino-cli matched on this port, for the picker. */
  alternatives?: BoardConfig[]
  /** Additional board metadata */
  metadata?: {
    vendorId?: string
    productId?: string
    serialNumber?: string
  }
}

/**
 * Detailed board information
 */
export interface BoardInfo extends Board {
  /** Board description */
  description?: string
  /** Supported upload protocols */
  uploadProtocols?: string[]
  /** Board capabilities */
  capabilities?: string[]
}

/**
 * Compilation result from Arduino CLI
 */
export interface CompileResult {
  /** Whether compilation was successful */
  success: boolean
  /** Compilation output/logs */
  output: string
  /** Error messages if compilation failed */
  errors?: CompilationError[]
  /** Warnings from compilation */
  warnings?: CompilationWarning[]
  /** Binary file path (for successful compilations) */
  binaryPath?: string
  /** Compilation metrics */
  metrics?: {
    /** Compilation time in milliseconds */
    duration: number
    /** Memory usage information */
    memoryUsage?: {
      flash: { used: number; total: number }
      ram: { used: number; total: number }
    }
  }
}

/**
 * Upload result from Arduino CLI
 */
export interface UploadResult {
  /** Whether upload was successful */
  success: boolean
  /** Upload output/logs */
  output: string
  /** Error message if upload failed */
  error?: string
  /** Upload progress information */
  progress?: {
    /** Current progress percentage (0-100) */
    percentage: number
    /** Current upload stage */
    stage: 'preparing' | 'uploading' | 'verifying' | 'complete'
  }
}

/**
 * Compilation error with location information
 */
export interface CompilationError {
  /** Error message */
  message: string
  /** File where the error occurred */
  file?: string
  /** Line number (1-based) */
  line?: number
  /** Column number (1-based) */
  column?: number
  /** Error severity */
  severity: 'error' | 'fatal'
}

/**
 * Compilation warning
 */
export interface CompilationWarning {
  /** Warning message */
  message: string
  /** File where the warning occurred */
  file?: string
  /** Line number (1-based) */
  line?: number
  /** Column number (1-based) */
  column?: number
}

/**
 * Arduino CLI status
 */
export interface AgentStatus {
  /** Whether arduino-cli is available and working */
  connected: boolean
  /** Arduino CLI version */
  version?: string
  /** Last connection check timestamp */
  lastCheck: number
  /** Connection error if any */
  error?: string
}

/**
 * Library metadata from the Arduino library index (search) or installed list
 */
export interface LibraryEntry {
  name: string
  author: string
  sentence: string
  version: string
}

/**
 * Platform (core) metadata from the Boards Manager index (search) or installed
 * list. A platform groups one or more boards (e.g. "esp32:esp32").
 */
export interface PlatformEntry {
  /** Platform id, e.g. "esp32:esp32" */
  id: string
  /** Human-readable name, e.g. "esp32 Boards" */
  name: string
  /** Installed version, or '' if not installed */
  installed: string
  /** Latest available version */
  latest: string
  /** Maintainer / author */
  maintainer?: string
}

/**
 * A single installable board (FQBN) provided by an installed platform. Used for
 * the manual board-type override in the Boards Manager.
 */
export interface InstallableBoard {
  name: string
  fqbn: string
}

/** Result shape shared by Boards Manager / Library mutation actions */
export interface ArduinoActionResult {
  success: boolean
  output: string
  error?: string
}

/** One selectable value of an FQBN config option */
export interface BoardConfigOptionValue {
  value: string
  valueLabel: string
  selected?: boolean
}

/**
 * One FQBN config option of a board (PSRAM, CPU frequency, partition scheme…).
 * Selected values are appended to the FQBN as `base:option=value,option2=value2`.
 */
export interface BoardConfigOption {
  option: string
  optionLabel: string
  values: BoardConfigOptionValue[]
}

/** Result of board-details: identity + Tools-menu equivalents */
export interface BoardDetails {
  fqbn: string
  name: string
  configOptions: BoardConfigOption[]
  programmers: { id: string; name: string }[]
}

/**
 * Arduino service interface
 * Abstraction over the tinyService WebSocket backend. Implemented identically in
 * the desktop (Electron) and browser (web) builds: both connect to a local
 * tinyService on ws://localhost:3000.
 */
export interface ArduinoService {
  /**
   * Compile an Arduino sketch
   * @param workspacePath Path to the workspace directory containing the sketch
   * @param boardConfig Target board configuration
   * @returns Promise resolving to compilation result
   */
  compileSketch(workspacePath: string, boardConfig: BoardConfig): Promise<CompileResult>

  /**
   * Upload compiled sketch to board
   * @param port Target port
   * @param boardConfig Target board configuration
   * @param workspacePathOrBinary Optional workspace path or compiled binary path
   * @returns Promise resolving to upload result
   */
  uploadSketch(
    port: string,
    boardConfig: BoardConfig,
    workspacePathOrBinary?: string
  ): Promise<UploadResult>

  /**
   * List all connected Arduino boards
   * @returns Promise resolving to array of boards
   */
  listBoards(): Promise<Board[]>

  /**
   * Get detailed information about a specific board
   * @param port Port identifier
   * @returns Promise resolving to board information
   */
  getBoardInfo(port: string): Promise<BoardInfo>

  /**
   * Check if the service is available and working
   * @returns Promise resolving to service status
   */
  checkStatus(): Promise<AgentStatus>

  /** Search the Arduino library index */
  searchLibraries(query: string): Promise<LibraryEntry[]>

  /** List installed libraries */
  listLibraries(): Promise<LibraryEntry[]>

  /** Install a library by name (optionally pinned to a version) */
  installLibrary(
    name: string,
    version?: string
  ): Promise<{ success: boolean; output: string; error?: string }>

  /** Uninstall a library by name */
  uninstallLibrary(name: string): Promise<{ success: boolean; output: string; error?: string }>

  // ── Boards Manager ─────────────────────────────────────────────────────────

  /** Search the platform (core) index, including any additional board URLs */
  searchCores(query: string): Promise<PlatformEntry[]>

  /** List installed platforms (cores) */
  listCores(): Promise<PlatformEntry[]>

  /** Install a platform (core) by id (optionally pinned to a version) */
  installCore(id: string, version?: string): Promise<ArduinoActionResult>

  /** Uninstall a platform (core) by id */
  uninstallCore(id: string): Promise<ArduinoActionResult>

  /** List every board (FQBN) provided by the installed platforms */
  listAllBoards(): Promise<InstallableBoard[]>

  /** List the configured additional board-manager URLs */
  listBoardUrls(): Promise<string[]>

  /** Add an additional board-manager URL (refreshes the core index) */
  addBoardUrl(url: string): Promise<ArduinoActionResult>

  /** Remove an additional board-manager URL */
  removeBoardUrl(url: string): Promise<ArduinoActionResult>

  /** Fetch FQBN config options + programmers for a board (arduino-cli board details) */
  boardDetails(fqbn: string): Promise<BoardDetails>

  /** Open the serial monitor on a port at a baud rate */
  openSerial(port: string, baud: number): void

  /** Close the serial monitor */
  closeSerial(): void

  /**
   * Send data to the serial port. With `raw: true` the payload is written
   * exactly as provided (caller applies its own line ending); otherwise the
   * backend appends "\n" (legacy behavior).
   */
  writeSerial(data: string, raw?: boolean): void

  /** Subscribe to streamed serial lines; returns an unsubscribe function */
  onSerialData(cb: (line: string) => void): () => void

  /**
   * Subscribe to serial open/close/error status; returns an unsubscribe
   * function. `error` carries the backend's explanation when a port could
   * not be opened (busy, missing, …).
   */
  onSerialStatus(
    cb: (status: { opened?: boolean; closed?: boolean; error?: string }) => void
  ): () => void

  /**
   * Subscribe to the backend's package-operation state: the install or
   * uninstall running now (with download progress) and the automatic board
   * setup. Fired on connect and on every change. Returns an unsubscribe
   * function.
   */
  onPackageJobs(cb: (state: PackageJobsState) => void): () => void

  /** The last package-operation state received, or null before the first. */
  getPackageJobs(): PackageJobsState | null

  /**
   * Run the backend's board setup again: board URLs, index, and any default
   * platform (tinyCore, ESP32) that is missing.
   */
  runBoardSetup(): Promise<ArduinoActionResult>

  /**
   * Subscribe to server-pushed board events (event-driven detection via
   * `arduino-cli board list --watch`). Fired with the full current board list
   * whenever a device is plugged/unplugged. Returns an unsubscribe function.
   */
  onBoardEvents(cb: (boards: Board[]) => void): () => void

  /**
   * Subscribe to streamed output lines of a request/response action
   * ("upload", "compile", …), e.g. to derive real upload progress from
   * esptool/avrdude output. Returns an unsubscribe function.
   */
  onActionOutput(action: string, cb: (output: string) => void): () => void

  /** Whether the tinyService backend is currently connected */
  isConnected(): boolean

  /** Subscribe to backend connect/disconnect transitions; returns an unsubscribe function */
  onConnectionChange(cb: (connected: boolean) => void): () => void

  /**
   * WebSocket URL of the backend's LSP bridge for a given FQBN, or null when
   * unsupported in this environment.
   */
  getLspUrl(fqbn: string): string | null
}

/**
 * Environment detection for service factory
 */
export type Environment = 'web' | 'electron'

/**



/**
 * Common Arduino board configurations
 */
export const COMMON_BOARDS: { [key: string]: BoardConfig } = {
  'tinyCore:esp32:tiny_core_esp32s3_nopsram': {
    fqbn: 'tinyCore:esp32:tiny_core_esp32s3_nopsram',
    name: 'tinyCore',
    architecture: 'ESP32-S3',
    package: 'tinyCore'
  },
  'esp32:esp32:esp32s3': {
    fqbn: 'esp32:esp32:esp32s3',
    name: 'ESP32-S3 Dev Module',
    architecture: 'ESP32-S3',
    package: 'esp32'
  },
  'arduino:avr:uno': {
    fqbn: 'arduino:avr:uno',
    name: 'Arduino Uno',
    architecture: 'ATmega328P',
    package: 'arduino'
  },
  'arduino:avr:nano': {
    fqbn: 'arduino:avr:nano',
    name: 'Arduino Nano',
    architecture: 'ATmega328P',
    package: 'arduino'
  },
  'esp32:esp32:esp32': {
    fqbn: 'esp32:esp32:esp32',
    name: 'ESP32 Dev Module',
    architecture: 'esp32',
    package: 'esp32'
  }
} as const

/**
 * Arduino file extensions
 */
export const ARDUINO_FILE_EXTENSIONS = ['.ino', '.cpp', '.c', '.h', '.hpp'] as const

/**
 * Default compilation timeout in milliseconds
 */
export const DEFAULT_COMPILE_TIMEOUT = 60000 // 1 minute

/**
 * Default upload timeout in milliseconds
 */
export const DEFAULT_UPLOAD_TIMEOUT = 30000 // 30 seconds

// ── package operations (mirrors @mister-industries/shared >= 1.3) ─────────────

/**
 * One package operation (platform/library install or uninstall, index
 * update). tinyService runs one at a time and pushes its state to every client.
 */
export interface PackageJob {
  id: string
  kind:
    | 'core-install'
    | 'core-uninstall'
    | 'lib-install'
    | 'lib-uninstall'
    | 'index-update'
    | 'url-add'
  /** e.g. "esp32:esp32", a library name, or a URL */
  target: string
  /** e.g. "Installing esp32:esp32" */
  label: string
  /** A user request, or the automatic board setup */
  origin: 'user' | 'setup'
  startedAt: number
  state: 'running' | 'succeeded' | 'failed'
  /** What arduino-cli is working on right now */
  current?: {
    item: string
    phase: 'downloading' | 'installing' | 'configuring'
    /** 0–100 while downloading */
    percent?: number
    /** e.g. "590.0 MiB" */
    total?: string
  }
  /** Items finished so far */
  done: string[]
  lastLine?: string
  error?: string
  finishedAt?: number
}

/** One platform the automatic board setup takes care of. */
export interface SetupPlatform {
  id: string
  name: string
  status: 'pending' | 'installed' | 'installing' | 'failed' | 'skipped'
  error?: string
}

/** The automatic board setup tinyService runs at start. */
export interface BoardSetupState {
  state: 'idle' | 'running' | 'done' | 'failed' | 'disabled'
  message?: string
  platforms: SetupPlatform[]
  error?: string
}

/** Payload of tinyService's "package-jobs" push. */
export interface PackageJobsState {
  active: PackageJob | null
  last: PackageJob | null
  setup: BoardSetupState
}
