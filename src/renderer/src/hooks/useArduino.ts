/**
 * useArduino - Main hook for Arduino operations (compile, upload, board management)
 */

import { resolveBuildTarget } from '@renderer/lib/boardFallbacks'
import {
  type BoardHistory,
  deviceKey,
  forgetBoard,
  loadBoardHistory,
  rememberBoard
} from '@renderer/lib/boardHistory'
import { resolveDetectedBoards } from '@renderer/lib/detectedBoards'
import { reconcileSelection } from '@renderer/lib/boardSelection'
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
  PackageJobsState,
  PlatformEntry,
  UploadResult
} from '@renderer/services/arduino/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  /** One entry per detected port (several for a port with competing matches). */
  boards: Board[]
  selectedBoard: Board | null
  /**
   * Select a board. A board with a port is remembered for that device, so the
   * same choice (options included) comes back whenever it is plugged in.
   */
  setSelectedBoard: (board: Board | null) => void
  /** Forget the remembered board for a device and go back to detection. */
  forgetBoardChoice: (deviceKey: string) => void
  refreshBoards: () => Promise<void>
  isLoadingBoards: boolean

  // Package operations (installs, the automatic board setup)
  /** What tinyService is installing right now, and the board setup's state. */
  packageJobs: PackageJobsState | null
  /** Install any default board platform (tinyCore, ESP32) that is missing. */
  runBoardSetup: () => Promise<ArduinoActionResult>

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
  uninstallLibrary: (name: string) => Promise<{ success: boolean; output: string; error?: string }>

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
  // Raw entries from tinyService (one per board arduino-cli matched on a
  // port); `boards` is what the UI offers after applying the board history.
  const [rawBoards, setRawBoards] = useState<Board[]>([])
  const [history, setHistory] = useState<BoardHistory>(() => loadBoardHistory())
  const [installedFqbns, setInstalledFqbns] = useState<ReadonlySet<string> | undefined>()
  const boards = useMemo(
    () => resolveDetectedBoards(rawBoards, history, installedFqbns),
    [rawBoards, history, installedFqbns]
  )
  const rawBoardsRef = useRef(rawBoards)
  rawBoardsRef.current = rawBoards
  const [selectedBoard, setSelectedBoardState] = useState<Board | null>(null)
  const [isLoadingBoards, setIsLoadingBoards] = useState(false)
  const [hasLoadedBoards, setHasLoadedBoards] = useState(false)
  const [packageJobs, setPackageJobs] = useState<PackageJobsState | null>(null)

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
      setRawBoards(boardsList)
      setHasLoadedBoards(true) // Mark that we've completed at least one board scan

      const ports = new Set(boardsList.map((b) => b.port))
      addLog({
        type: 'info',
        message: `Found ${ports.size} device(s)`,
        details:
          boardsList.length > 0
            ? boardsList
                .map((b, i) => `${i + 1}. ${b.config.name || 'Unknown'} on ${b.port}`)
                .join('\n')
            : 'No boards detected. Please ensure your board is connected via USB and drivers are installed.'
      })
      // The selection follows `boards` in the reconcile effect below.
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

      const selected = boardConfig || selectedBoard?.config
      if (!selected) {
        throw new Error('No board selected for compilation')
      }
      // A USB-discovery placeholder can be detected but not built; swap in the
      // real board of the same platform (boardFallbacks.ts).
      const targetBoard = resolveBuildTarget(selected)
      if (targetBoard.fqbn !== selected.fqbn) {
        addLog({
          type: 'info',
          message: `Building as ${targetBoard.name}`,
          details: `${selected.name} (${selected.fqbn}) is a USB-discovery placeholder, not a buildable board. Using ${targetBoard.fqbn} instead.`
        })
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
        // (Read through the ref; the state value in this closure is stale.)
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
      const selected = boardConfig || selectedBoard?.config

      if (!targetPort || !selected) {
        throw new Error('No board/port selected for upload')
      }

      // Same placeholder swap as compileSketch (boardFallbacks.ts).
      const targetBoard = resolveBuildTarget(selected)

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

        // Release the serial port before flashing: esptool needs exclusive
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
        // (Read through the ref; the state value in this closure is stale.)
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
   * plug/unplug, so an unplug shows up at once instead of at the next manual
   * refresh. The selection follows in the reconcile effect below.
   */
  useEffect(() => {
    const off = arduinoService.onBoardEvents((boardsList) => {
      setRawBoards(boardsList)
      setHasLoadedBoards(true)
    })
    return off
  }, [arduinoService])

  /**
   * Keep the selection in step with the detected boards.
   *
   *  - Same device still present: keep the user's choice (board type and
   *    options); follow detection only if the selection was detection's own
   *    guess and the device's identity changed (e.g. a platform was installed).
   *  - Device gone: keep the selection, marked disconnected, for a grace
   *    period. An ESP32 drops off USB for a moment on every reset (uploads
   *    included), and Verify still works without a port. When it comes back,
   *    the selection re-attaches quietly. Only after the grace period does it
   *    move to another connected board.
   *  - Nothing selected: take the first board.
   */
  const selectedRef = useRef<Board | null>(null)
  selectedRef.current = selectedBoard
  const disconnectedAtRef = useRef<number | null>(null)
  const [graceTick, setGraceTick] = useState(0)
  useEffect(() => {
    const decision = reconcileSelection(
      selectedRef.current,
      boards,
      disconnectedAtRef.current,
      Date.now()
    )
    disconnectedAtRef.current = decision.disconnectedAt
    if (decision.next !== selectedRef.current) setSelectedBoardState(decision.next)
    if (decision.switchedFrom && decision.next) {
      toast.info('Board changed', {
        description: `${decision.switchedFrom.config.name} on ${decision.switchedFrom.port} is gone; switched to ${decision.next.config.name} (${decision.next.port}).`
      })
    }
    if (decision.recheckInMs !== undefined) {
      const timer = setTimeout(() => setGraceTick((t) => t + 1), decision.recheckInMs)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [boards, graceTick])

  /** User-facing selection: remembers the choice for the device. */
  const setSelectedBoard = useCallback((board: Board | null): void => {
    if (!board) {
      setSelectedBoardState(null)
      return
    }
    // The device's identity comes from what is detected on the chosen port,
    // not from the board object: the port picker passes the previous
    // selection with a new port, which still carries the old device's key.
    const raw = board.port ? rawBoardsRef.current.find((b) => b.port === board.port) : undefined
    const metadata = raw ? raw.metadata : board.metadata
    const key = !board.port
      ? undefined
      : raw
        ? deviceKey(raw)
        : (board.deviceKey ?? deviceKey({ port: board.port, protocol: board.protocol, metadata }))
    if (key && board.config.fqbn) {
      setHistory((h) => rememberBoard(h, key, board.config))
    }
    setSelectedBoardState({
      ...board,
      metadata,
      deviceKey: key,
      source: key ? 'remembered' : board.source,
      guess: false
    })
  }, [])

  const forgetBoardChoice = useCallback((key: string): void => {
    setHistory((h) => forgetBoard(h, key))
    // Let detection decide for that device again.
    setSelectedBoardState((current) =>
      current?.deviceKey === key ? { ...current, source: 'detected' } : current
    )
  }, [])

  /**
   * Install state from tinyService. When a platform install or removal
   * finishes, refresh the list of installed boards (it decides which tinyCore
   * FQBN a generic ESP32 gets) and rescan so the new identities show.
   */
  const lastFinishedJobRef = useRef<string | null>(null)
  const refreshInstalledBoards = useCallback(async (): Promise<void> => {
    try {
      const all = await arduinoService.listAllBoards()
      setInstalledFqbns(new Set(all.map((b) => b.fqbn)))
    } catch {
      /* keep the previous list */
    }
  }, [arduinoService])
  useEffect(() => {
    const off = arduinoService.onPackageJobs((state) => {
      setPackageJobs(state)
      const last = state.last
      if (
        last &&
        last.id !== lastFinishedJobRef.current &&
        last.state === 'succeeded' &&
        (last.kind === 'core-install' || last.kind === 'core-uninstall')
      ) {
        lastFinishedJobRef.current = last.id
        void refreshInstalledBoards()
      }
    })
    return off
  }, [arduinoService, refreshInstalledBoards])
  useEffect(() => {
    if (isAgentConnected) void refreshInstalledBoards()
  }, [isAgentConnected, refreshInstalledBoards])

  const runBoardSetup = useCallback(() => arduinoService.runBoardSetup(), [arduinoService])

  /**
   * Reset board loading state when agent disconnects
   */
  useEffect(() => {
    if (!isAgentConnected) {
      setHasLoadedBoards(false)
      setRawBoards([])
      setSelectedBoardState(null)
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
    forgetBoardChoice,
    refreshBoards,
    isLoadingBoards,

    // Package operations
    packageJobs,
    runBoardSetup,

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
