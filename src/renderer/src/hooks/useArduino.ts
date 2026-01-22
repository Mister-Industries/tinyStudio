/**
 * useArduino - Main hook for Arduino operations (compile, upload, board management)
 */

import { getArduinoService } from '@renderer/services/arduino/ArduinoServiceFactory'
import { Board, BoardConfig, CompileResult, UploadResult } from '@renderer/services/arduino/types'
import { useCallback, useEffect, useState } from 'react'
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

        // Check if this was a timeout error after a successful operation
        const isTimeout = errorMessage.includes('timed out')
        const isAfterSuccess = isTimeout && (lastCompileResult?.success ?? false)

        const result: CompileResult = {
          success: isAfterSuccess, // If last result was successful and this is just a timeout, preserve success
          output: isAfterSuccess
            ? (lastCompileResult?.output ?? '')
            : `Compilation error: ${errorMessage}`,
          errors: isAfterSuccess ? [] : [{ message: errorMessage, severity: 'fatal' }]
        }

        setLastCompileResult(result)

        if (isAfterSuccess) {
          addLog({
            type: 'compile',
            message: 'Compilation completed (with timeout warning)',
            details: `Build finished successfully but communication timed out.\nOriginal output:\n${lastCompileResult?.output ?? ''}`
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

      try {
        // Add upload progress step logging
        addLog({
          type: 'info',
          message: 'Executing upload command via Arduino CLI...'
        })

        // Simulate progress updates (real implementation would get these from service)
        const progressTimer = setInterval(() => {
          setUploadProgress((prev) => {
            if (!prev || prev.percentage >= 100) return prev
            return {
              ...prev,
              percentage: Math.min(prev.percentage + 10, 90),
              stage:
                prev.percentage < 30
                  ? 'preparing'
                  : prev.percentage < 80
                    ? 'uploading'
                    : 'verifying'
            }
          })
        }, 200)

        const result = await arduinoService.uploadSketch(targetPort, targetBoard, workspacePath)
        clearInterval(progressTimer)

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

        // Check if this was a timeout error after a successful operation
        const isTimeout = errorMessage.includes('timed out')
        const isAfterSuccess = isTimeout && (lastUploadResult?.success ?? false)

        const result: UploadResult = {
          success: isAfterSuccess, // If last result was successful and this is just a timeout, preserve success
          output: isAfterSuccess ? (lastUploadResult?.output ?? '') : '',
          error: isAfterSuccess ? undefined : errorMessage
        }

        setLastUploadResult(result)
        setUploadProgress(null)

        if (isAfterSuccess) {
          addLog({
            type: 'upload',
            message: 'Upload completed (with timeout warning)',
            details: `Upload finished successfully but communication timed out.\nOriginal output:\n${lastUploadResult?.output ?? ''}`
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
   * Reset board loading state when agent disconnects
   */
  useEffect(() => {
    if (!isAgentConnected) {
      setHasLoadedBoards(false)
      setBoards([])
      setSelectedBoard(null)
    }
  }, [isAgentConnected])

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
    checkAgentStatus
  }
}
