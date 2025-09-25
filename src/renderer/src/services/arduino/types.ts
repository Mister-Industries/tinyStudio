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
 * Arduino service interface
 * Provides abstraction over Arduino CLI (electron) - web environment is not supported
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
   * @param binaryPath Optional path to compiled binary
   * @returns Promise resolving to upload result
   */
  uploadSketch(port: string, boardConfig: BoardConfig, binaryPath?: string): Promise<UploadResult>

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
  'arduino:avr:uno': {
    fqbn: 'arduino:avr:uno',
    name: 'Arduino Uno',
    architecture: 'avr',
    package: 'arduino'
  },
  'arduino:avr:nano': {
    fqbn: 'arduino:avr:nano',
    name: 'Arduino Nano',
    architecture: 'avr',
    package: 'arduino'
  },
  'esp32:esp32:esp32': {
    fqbn: 'esp32:esp32:esp32',
    name: 'ESP32 Dev Module',
    architecture: 'esp32',
    package: 'esp32'
  },
  'arduino:samd:mkr1000': {
    fqbn: 'arduino:samd:mkr1000',
    name: 'Arduino MKR1000',
    architecture: 'samd',
    package: 'arduino'
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
