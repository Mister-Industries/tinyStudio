/**
 * useArduino - Main hook for Arduino operations (compile, upload, board management)
 */

import { parseCompileDiagnostics } from '@renderer/lib/compileErrors'
import { getArduinoService } from '@renderer/services/arduino/ArduinoServiceFactory'
import {
  ArduinoActionResult,
  Board,
  BoardConfig,
  BoardDetails,
  CompileResult,
  InstallableBoard,
  LibraryEntry,
  PlatformEntry,
  UploadResult
} from '@renderer/services/arduino/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useArduinoAgent } from './useArduinoAgent'

/**
 * Log entry for compilation/upload operations
 */
export interface ArduinoLogEntry {
  id: string
  timestamp: number
  type: 'compile' | 'upload' | 'error' | 'info'
  message: string
  details?: string
}

/**
 * Upload progress information
 */
export interface UploadProgress {
  percentage: number
  stage: 'preparing' | 'uploading' | 'verifying' | 'complete'
  message?: string
}

/**
 * Return type for useArduino hook
 */
export interface UseArduinoReturn {
  // Board management
  boards: Board[]
  selectedBoard: Board | null
  setSelectedBoard: (board: Board | null) => void
  refreshBoards: () => Promise<void>
  isLoadingBoards: boolean

  // Compilation
  compileSketch: (workspacePath: string, boardConfig?: BoardConfig) => Promise<CompileResult>
  isCompiling: boolean
  lastCompileResult: CompileResult | null

  // Upload
  uploadSketch: (
    port?: string,
    boardConfig?: BoardConfig,
    workspacePath?: string
  ) => Promise<UploadResult>
  compileAndUpload: (
    workspacePath: string,
    port?: string,
    boardConfig?: BoardConfig
  ) => Promise<{
    compile: CompileResult
    upload: UploadResult
  }>
  isUploading: boolean
  uploadProgress: UploadProgress | null
  lastUploadResult: UploadResult | null

  // Logs and output
  logs: ArduinoLogEntry[]
  clearLogs: () => void
  addLog: (entry: Omit<ArduinoLogEntry, 'id' | 'timestamp'>) => void

  // Agent connectivity
  isAgentConnected: boolean
  checkAgentStatus: () => Promise<void>

  // Library manager
  searchLibraries: (query: string) => Promise<LibraryEntry[]>
  listLibraries: () => Promise<LibraryEntry[]>
  installLibrary: (
    name: string,
    version?: string
  ) => Promise<{ success: boolean; output: string; error?: string }>
  uninstallLibrary: (
    name: string
  ) => Promise<{ success: boolean; output: string; error?: string }>

  // Boards manager
  searchCores: (query: string) => Promise<PlatformEntry[]>
  listCores: () => Promise<PlatformEntry[]>
  installCore: (id: string, version?: string) => Promise<ArduinoActionResult>
  uninstallCore: (id: string) => Promise<ArduinoActionResult>
  listAllBoards: () => Promise<InstallableBoard[]>
  listBoardUrls: () => Promise<string[]>
  addBoardUrl: (url: string) => Promise<ArduinoActionResult>
  removeBoardUrl: (url: string) => Promise<ArduinoActionResult>
  /** FQBN config options + programmers for a board (Tools-menu equivalents) */
  boardDetails: (fqbn: string) => Promise<BoardDetails>

  // Serial monitor
  openSerial: (port: string, baud: number) => void
  closeSerial: () => void
  writeSerial: (data: string, raw?: boolean) => void
  onSerialData: (cb: (line: string) => void) => () => void
  onSerialStatus: (
    cb: (status: { opened?: boolean; closed?: boolean; error?: string }) => void
  ) => () => void
}

/**
 * Main Arduino hook for compilation, upload, and board management
 */
export function useArduino(): UseArduinoReturn {
  // State management
  const [boards, setBoards] = useState<Board[]>([])
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null)
  const [isLoadingBoards, setIsLoadingBoards] = useState(false)
  const [hasLoadedBoards, setHasLoadedBoards] = useState(false)

  const [isCompiling, setIsCompiling] = useState(false)
  const [lastCompileResult, setLastCompileResult] = useState<CompileResult | null>(null)

  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const [lastUploadResult, setLastUploadResult] = useState<UploadResult | null>(null)

  // Refs mirroring the last results so long-lived callbacks (the timeout
  // recovery paths) read the CURRENT value instead of a stale closure.
  const lastCompileResultRef = useRef<CompileResult | null>(null)
  lastCompileResultRef.current = lastCompileResult
  const lastUploadResultRef = useRef<UploadResult | null>(null)
  lastUploadResultRef.current = lastUploadResult

  const [logs, setLogs] = useState<ArduinoLogEntry[]>([])

  // Services
  const arduinoService = getArduinoService()
  const {
    isConnected: isAgentConnected,
    checkStatus: checkAgentStatus,
    startChecking
  } = useArduinoAgent()

  /**
   * Start agent monitoring on mount (only once)
   */
  useEffect(() => {
    startChecking()
  }, [startChecking])

  /**
   * Add a log entry
   */
  const addLog = useCallback((entry: Omit<ArduinoLogEntry, 'id' | 'timestamp'>): void => {
    const logEntry: ArduinoLogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: Date.now()
    }
    setLogs((prev) => [...prev, logEntry])
  }, [])

  /**
   * Clear all logs
   */
  const clearLogs = useCallback((): void => {
    setLogs([])
  }, [])

  /**
   * Refresh the list of connected boards
   */
  const refreshBoards = useCallback(async (): Promise<void> => {
    if (isLoadingBoards) return

    setIsLoadingBoards(true)
    addLog({
      type: 'info',
      message: 'Scanning for connected boards...'
    })

    try {
      const boardsList = await arduinoService.listBoards()
      setBoards(boardsList)
      setHasLoadedBoards(true) // Mark that we've completed at least one board scan

      addLog({
        type: 'info',
        message: `Found ${boardsList.length} board(s)`,
        details:
          boardsList.length > 0
            ? boardsList
                .map((b, index) => {
                  const status = b.connected ? '✓ Connected' : '✗ Disconnected'
                  return `${index + 1}. ${b.config.name} on ${b.port} - ${status}`
                })
                .join('\n')
            : 'No Arduino boards detected. Please ensure your board is connected via USB and drivers are installed.'
      })

      // Auto-select first board if none selected
      setSelectedBoard((currentBoard) => {
        // If no board is currently selected, select the first one
        if (!currentBoard && boardsList.length > 0) {
          return boardsList[0]
        }

        // If current board is no longer available, select first available or null
        if (currentBoard && !boardsList.find((b) => b.port === currentBoard.port)) {
          if (boardsList.length === 0) {
            toast.warning('Previously selected board is no longer connected')
          }
          return boardsList[0] || null
        }

        // Keep current selection
        return currentBoard
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      addLog({
        type: 'error',
        message: 'Failed to scan for boards',
        details: errorMessage
      })
      toast.error('Failed to scan for boards', {
        description: errorMessage
      })
    } finally {
      setIsLoadingBoards(false)
    }
  }, [isLoadingBoards, arduinoService, addLog])

  /**
   * Compile an Arduino sketch
   */
  const compileSketch = useCallback(
    async (workspacePath: string, boardConfig?: BoardConfig): Promise<CompileResult> => {
      if (isCompiling) {
        throw new Error('Compilation already in progress')
      }

      const targetBoard = boardConfig || selectedBoard?.config
      if (!targetBoard) {
        throw new Error('No board selected for compilation')
      }

      setIsCompiling(true)
      addLog({
        type: 'compile',
        message: `Starting compilation for ${targetBoard.name}...`
      })

      // Add a log for the build process start
      addLog({
        type: 'info',
        message: 'Initializing Arduino CLI build process...',
        details: `Board: ${targetBoard.name} (${targetBoard.fqbn})\nWorkspace: ${workspacePath}`
      })

      try {
        // Add build progress logging
        const buildStartTime = Date.now()

        addLog({
          type: 'info',
          message: 'Running Arduino CLI compile command...'
        })

        const result = await arduinoService.compileSketch(workspacePath, targetBoard)
        const buildDuration = Date.now() - buildStartTime

        // Extract file:line:col diagnostics from the compiler output so the
        // editor can render them inline (squiggles) and make them clickable.
        if (!result.success) {
          const diagText = [result.output, ...(result.errors?.map((e) => e.message) ?? [])].join(
            '\n'
          )
          const parsed = parseCompileDiagnostics(diagText)
          if (parsed.length > 0) {
            result.errors = parsed
              .filter((d) => d.severity === 'error')
              .map((d) => ({
                message: d.message,
                file: d.file,
                line: d.line,
                column: d.column,
                severity: 'error' as const
              }))
            result.warnings = parsed
              .filter((d) => d.severity === 'warning')
              .map((d) => ({ message: d.message, file: d.file, line: d.line, column: d.column }))
          }
        }
        setLastCompileResult(result)

        if (result.success) {
          // Log detailed build output for successful compilations
          const buildDetails: string[] = []

          // Include compilation output if available
          if (result.output && result.output.trim()) {
            buildDetails.push(result.output.trim())
          }

          // Include metrics information
          if (result.metrics?.duration) {
            buildDetails.push(`Build time: ${result.metrics.duration}ms`)
          } else {
            buildDetails.push(`Build time: ${buildDuration}ms`)
          }

          // Include memory usage if available
          if (result.metrics?.memoryUsage) {
            const { flash, ram } = result.metrics.memoryUsage
            buildDetails.push(
              `Memory: Flash ${flash.used}/${flash.total} bytes, RAM ${ram.used}/${ram.total} bytes`
            )
          }

          addLog({
            type: 'compile',
            message: 'Compilation successful',
            details: buildDetails.join('\n\n')
          })
          toast.success('Compilation successful')
        } else {
          // Log detailed build output for failed compilations
          const errorDetails: string[] = []

          // Include compilation output
          if (result.output && result.output.trim()) {
            errorDetails.push('Build Output:')
            errorDetails.push(result.output.trim())
          }

          // Include specific errors if available
          if (result.errors && result.errors.length > 0) {
            errorDetails.push('\nCompilation Errors:')
            result.errors.forEach((error, index) => {
              let errorLine = `${index + 1}. ${error.message}`
              if (error.file) {
                errorLine += ` (${error.file}${error.line ? `:${error.line}` : ''}${error.column ? `:${error.column}` : ''})`
              }
              errorDetails.push(errorLine)
            })
          }

          addLog({
            type: 'error',
            message: 'Compilation failed',
            details: errorDetails.join('\n')
          })
          toast.error('Compilation failed', {
            description: result.errors?.[0]?.message || 'See output for details'
          })
        }

        return result
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        // Check if this was a timeout error after a successful operation.
        // (Read through the ref — the state value in this closure is stale.)
        const prevCompile = lastCompileResultRef.current
        const isTimeout = errorMessage.includes('timed out')
        const isAfterSuccess = isTimeout && (prevCompile?.success ?? false)

        const result: CompileResult = {
          success: isAfterSuccess, // If last result was successful and this is just a timeout, preserve success
          output: isAfterSuccess
            ? (prevCompile?.output ?? '')
            : `Compilation error: ${errorMessage}`,
          errors: isAfterSuccess ? [] : [{ message: errorMessage, severity: 'fatal' }]
        }

        setLastCompileResult(result)

        if (isAfterSuccess) {
          addLog({
            type: 'compile',
            message: 'Compilation completed (with timeout warning)',
            details: `Build finished successfully but communication timed out.\nOriginal output:\n${prevCompile?.output ?? ''}`
          })
          toast.warning('Compilation completed with timeout', {
            description: 'Build succeeded but communication was slow'
          })
        } else {
          addLog({
            type: 'error',
            message: 'Compilation error',
            details: errorMessage
          })
          toast.error('Compilation error', { description: errorMessage })
        }

        return result
      } finally {
        setIsCompiling(false)
      }
    },
    [isCompiling, selectedBoard, arduinoService, addLog]
  )

  /**
   * Upload compiled sketch to board
   */
  const uploadSketch = useCallback(
    async (
      port?: string,
      boardConfig?: BoardConfig,
      workspacePath?: string
    ): Promise<UploadResult> => {
      if (isUploading) {
        throw new Error('Upload already in progress')
      }

      const targetPort = port || selectedBoard?.port
      const targetBoard = boardConfig || selectedBoard?.config

      if (!targetPort || !targetBoard) {
        throw new Error('No board/port selected for upload')
      }

      setIsUploading(true)
      setUploadProgress({ percentage: 0, stage: 'preparing' })

      addLog({
        type: 'upload',
        message: `Starting upload to ${targetBoard.name} on ${targetPort}...`
      })

      // Add detailed upload initialization log
      addLog({
        type: 'info',
        message: 'Preparing sketch for upload...',
        details: `Target: ${targetBoard.name}\nPort: ${targetPort}\nFQBN: ${targetBoard.fqbn}\nWorkspace: ${workspacePath || 'Using compiled binary'}`
      })

      let offProgress: (() => void) | null = null
      try {
        // Add upload progress step logging
        addLog({
          type: 'info',
          message: 'Executing upload command via Arduino CLI...'
        })

        // Real progress: parse the flasher's streamed output. esptool (ESP32
        // family, incl. tinyCore) prints "Writing at 0x... (NN %)"; avrdude
        // prints "Writing | ### ... | NN%". Falls back to indeterminate
        // stages when the tool prints no percentages.
        offProgress = arduinoService.onActionOutput('upload', (chunk) => {
          const matches = chunk.match(/\((\d{1,3})\s*%\)|\s(\d{1,3})%/g)
          if (matches && matches.length > 0) {
            const last = matches[matches.length - 1]
            const num = parseInt(last.replace(/[^0-9]/g, ''), 10)
            if (!Number.isNaN(num)) {
              setUploadProgress({
                percentage: Math.min(num, 99),
                stage: num >= 99 ? 'verifying' : 'uploading'
              })
              return
            }
          }
          if (/Connecting|Chip is|Uploading stub|esptool/i.test(chunk)) {
            setUploadProgress((prev) => prev ?? { percentage: 0, stage: 'preparing' })
          }
          if (/Hash of data verified|verif/i.test(chunk)) {
            setUploadProgress((prev) =>
              prev ? { ...prev, stage: 'verifying' } : { percentage: 99, stage: 'verifying' }
            )
          }
        })

        // Release the serial port before flashing — esptool needs exclusive
        // access to the COM port, and the monitor may still be holding it, so
        // close it and give the OS a moment to free the handle (otherwise the
        // upload fails with "uploading error: exit status 2").
        try {
          arduinoService.closeSerial()
        } catch {
          /* port was not open */
        }
        await new Promise((r) => setTimeout(r, 500))

        const result = await arduinoService.uploadSketch(targetPort, targetBoard, workspacePath)

        setLastUploadResult(result)
        setUploadProgress({ percentage: 100, stage: 'complete' })

        if (result.success) {
          // Log detailed upload output
          const uploadDetails: string[] = []

          if (result.output && result.output.trim()) {
            uploadDetails.push('Upload Output:')
            uploadDetails.push(result.output.trim())
          }

          uploadDetails.push(`Successfully uploaded to ${targetBoard.name} on ${targetPort}`)

          addLog({
            type: 'upload',
            message: 'Upload successful',
            details: uploadDetails.join('\n\n')
          })
          toast.success('Upload successful')
        } else {
          // Log detailed upload error information
          const errorDetails: string[] = []

          if (result.output && result.output.trim()) {
            errorDetails.push('Upload Output:')
            errorDetails.push(result.output.trim())
          }

          if (result.error && result.error.trim()) {
            errorDetails.push('\nError Details:')
            errorDetails.push(result.error.trim())
          }

          addLog({
            type: 'error',
            message: 'Upload failed',
            details: errorDetails.join('\n')
          })
          toast.error('Upload failed', {
            description: result.error || 'See output for details'
          })
        }

        // Clear progress after delay
        setTimeout(() => setUploadProgress(null), 3000)

        return result
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        // Check if this was a timeout error after a successful operation.
        // (Read through the ref — the state value in this closure is stale.)
        const prevUpload = lastUploadResultRef.current
        const isTimeout = errorMessage.includes('timed out')
        const isAfterSuccess = isTimeout && (prevUpload?.success ?? false)

        const result: UploadResult = {
          success: isAfterSuccess, // If last result was successful and this is just a timeout, preserve success
          output: isAfterSuccess ? (prevUpload?.output ?? '') : '',
          error: isAfterSuccess ? undefined : errorMessage
        }

        setLastUploadResult(result)
        setUploadProgress(null)

        if (isAfterSuccess) {
          addLog({
            type: 'upload',
            message: 'Upload completed (with timeout warning)',
            details: `Upload finished successfully but communication timed out.\nOriginal output:\n${prevUpload?.output ?? ''}`
          })
          toast.warning('Upload completed with timeout', {
            description: 'Upload succeeded but communication was slow'
          })
        } else {
          addLog({
            type: 'error',
            message: 'Upload error',
            details: errorMessage
          })
          toast.error('Upload error', { description: errorMessage })
        }

        return result
      } finally {
        offProgress?.()
        setIsUploading(false)
      }
    },
    [isUploading, selectedBoard, arduinoService, addLog]
  )

  /**
   * Compile and upload in one operation
   */
  const compileAndUpload = useCallback(
    async (
      workspacePath: string,
      port?: string,
      boardConfig?: BoardConfig
    ): Promise<{ compile: CompileResult; upload: UploadResult }> => {
      // First compile
      const compileResult = await compileSketch(workspacePath, boardConfig)

      // Only upload if compilation was successful
      if (compileResult.success) {
        const uploadResult = await uploadSketch(port, boardConfig, workspacePath)
        return { compile: compileResult, upload: uploadResult }
      } else {
        return {
          compile: compileResult,
          upload: {
            success: false,
            output: '',
            error: 'Cannot upload: compilation failed'
          }
        }
      }
    },
    [compileSketch, uploadSketch]
  )

  /**
   * Load boards on mount and when agent connects
   * Note: refreshBoards is intentionally omitted from deps to prevent re-fetching when selectedBoard changes
   */
  useEffect(() => {
    if (isAgentConnected && !hasLoadedBoards) {
      refreshBoards()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAgentConnected, hasLoadedBoards])

  /**
   * Event-driven board detection: the backend watches
   * `arduino-cli board list --watch` and pushes the full board list on every
   * plug/unplug. This replaces the old 8-second poll (which stopped polling
   * once a board was found, so unplugs went unnoticed until manual refresh).
   * The selection is reconciled on every event: kept if the same port is
   * still present, cleared (with a heads-up) if its board was unplugged.
   */
  useEffect(() => {
    const off = arduinoService.onBoardEvents((boardsList) => {
      setBoards(boardsList)
      setHasLoadedBoards(true)
      setSelectedBoard((currentBoard) => {
        if (!currentBoard) {
          return boardsList[0] || null
        }
        // Same port still present: keep the user's choice (incl. any manual
        // board override / FQBN options), but follow arduino-cli if the
        // board on that port changed identity.
        const samePort = boardsList.find((b) => b.port === currentBoard.port)
        if (samePort) return currentBoard
        if (boardsList.length === 0) {
          toast.warning('Board disconnected', {
            description: `${currentBoard.config.name} on ${currentBoard.port} was unplugged.`
          })
          return null
        }
        toast.info('Board changed', {
          description: `${currentBoard.port} is gone — switched to ${boardsList[0].config.name} (${boardsList[0].port}).`
        })
        return boardsList[0]
      })
    })
    return off
  }, [arduinoService])

  /**
   * Reset board loading state when agent disconnects
   */
  useEffect(() => {
    if (!isAgentConnected) {
      setHasLoadedBoards(false)
      setBoards([])
      setSelectedBoard(null)
    }
  }, [isAgentConnected])

  // ── library manager ─────────────────────────────────────────────────────
  const searchLibraries = useCallback(
    (query: string) => arduinoService.searchLibraries(query),
    [arduinoService]
  )
  const listLibraries = useCallback(() => arduinoService.listLibraries(), [arduinoService])
  const installLibrary = useCallback(
    (name: string, version?: string) => arduinoService.installLibrary(name, version),
    [arduinoService]
  )
  const uninstallLibrary = useCallback(
    (name: string) => arduinoService.uninstallLibrary(name),
    [arduinoService]
  )

  // ── boards manager ──────────────────────────────────────────────────────
  const searchCores = useCallback(
    (query: string) => arduinoService.searchCores(query),
    [arduinoService]
  )
  const listCores = useCallback(() => arduinoService.listCores(), [arduinoService])
  const installCore = useCallback(
    (id: string, version?: string) => arduinoService.installCore(id, version),
    [arduinoService]
  )
  const uninstallCore = useCallback(
    (id: string) => arduinoService.uninstallCore(id),
    [arduinoService]
  )
  const listAllBoards = useCallback(() => arduinoService.listAllBoards(), [arduinoService])
  const boardDetails = useCallback(
    (fqbn: string) => arduinoService.boardDetails(fqbn),
    [arduinoService]
  )
  const listBoardUrls = useCallback(() => arduinoService.listBoardUrls(), [arduinoService])
  const addBoardUrl = useCallback(
    (url: string) => arduinoService.addBoardUrl(url),
    [arduinoService]
  )
  const removeBoardUrl = useCallback(
    (url: string) => arduinoService.removeBoardUrl(url),
    [arduinoService]
  )

  // ── serial monitor ──────────────────────────────────────────────────────
  const openSerial = useCallback(
    (port: string, baud: number) => arduinoService.openSerial(port, baud),
    [arduinoService]
  )
  const closeSerial = useCallback(() => arduinoService.closeSerial(), [arduinoService])
  const writeSerial = useCallback(
    (data: string, raw?: boolean) => arduinoService.writeSerial(data, raw),
    [arduinoService]
  )
  const onSerialData = useCallback(
    (cb: (line: string) => void) => arduinoService.onSerialData(cb),
    [arduinoService]
  )
  const onSerialStatus = useCallback(
    (cb: (status: { opened?: boolean; closed?: boolean; error?: string }) => void) =>
      arduinoService.onSerialStatus(cb),
    [arduinoService]
  )

  return {
    // Board management
    boards,
    selectedBoard,
    setSelectedBoard,
    refreshBoards,
    isLoadingBoards,

    // Compilation
    compileSketch,
    isCompiling,
    lastCompileResult,

    // Upload
    uploadSketch,
    compileAndUpload,
    isUploading,
    uploadProgress,
    lastUploadResult,

    // Logs
    logs,
    clearLogs,
    addLog,

    // Agent
    isAgentConnected,
    checkAgentStatus,

    // Library manager
    searchLibraries,
    listLibraries,
    installLibrary,
    uninstallLibrary,

    // Boards manager
    searchCores,
    listCores,
    installCore,
    uninstallCore,
    listAllBoards,
    listBoardUrls,
    addBoardUrl,
    removeBoardUrl,
    boardDetails,

    // Serial monitor
    openSerial,
    closeSerial,
    writeSerial,
    onSerialData,
    onSerialStatus
  }
}
