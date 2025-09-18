/**
 * useArduino - Main hook for Arduino operations (compile, upload, board management)
 */

import { getArduinoService } from '@renderer/services/arduino/ArduinoServiceFactory'
import {
  Board,
  BoardConfig,
  CompileResult,
  FileMap,
  UploadResult
} from '@renderer/services/arduino/types'
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
  compileSketch: (files: FileMap, boardConfig?: BoardConfig) => Promise<CompileResult>
  isCompiling: boolean
  lastCompileResult: CompileResult | null

  // Upload
  uploadSketch: (port?: string, boardConfig?: BoardConfig) => Promise<UploadResult>
  compileAndUpload: (
    files: FileMap,
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

  const [isCompiling, setIsCompiling] = useState(false)
  const [lastCompileResult, setLastCompileResult] = useState<CompileResult | null>(null)

  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const [lastUploadResult, setLastUploadResult] = useState<UploadResult | null>(null)

  const [logs, setLogs] = useState<ArduinoLogEntry[]>([])

  // Services
  const arduinoService = getArduinoService()
  const { isConnected: isAgentConnected, checkStatus: checkAgentStatus } = useArduinoAgent()

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

      addLog({
        type: 'info',
        message: `Found ${boardsList.length} board(s)`,
        details: boardsList.map((b) => `${b.config.name} on ${b.port}`).join(', ')
      })

      // Auto-select first board if none selected
      if (!selectedBoard && boardsList.length > 0) {
        setSelectedBoard(boardsList[0])
      }

      // Update selected board if it's no longer available
      if (selectedBoard && !boardsList.find((b) => b.port === selectedBoard.port)) {
        setSelectedBoard(boardsList[0] || null)
        if (boardsList.length === 0) {
          toast.warning('Previously selected board is no longer connected')
        }
      }
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
  }, [isLoadingBoards, arduinoService, addLog, selectedBoard])

  /**
   * Compile an Arduino sketch
   */
  const compileSketch = useCallback(
    async (files: FileMap, boardConfig?: BoardConfig): Promise<CompileResult> => {
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

      try {
        const result = await arduinoService.compileSketch(files, targetBoard)
        setLastCompileResult(result)

        if (result.success) {
          addLog({
            type: 'compile',
            message: 'Compilation successful',
            details: `Completed in ${result.metrics?.duration}ms`
          })
          toast.success('Compilation successful')
        } else {
          addLog({
            type: 'error',
            message: 'Compilation failed',
            details: result.output
          })
          toast.error('Compilation failed', {
            description: result.errors?.[0]?.message || 'See output for details'
          })
        }

        return result
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        const result: CompileResult = {
          success: false,
          output: `Compilation error: ${errorMessage}`,
          errors: [{ message: errorMessage, severity: 'fatal' }]
        }

        setLastCompileResult(result)
        addLog({
          type: 'error',
          message: 'Compilation error',
          details: errorMessage
        })
        toast.error('Compilation error', { description: errorMessage })

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
    async (port?: string, boardConfig?: BoardConfig): Promise<UploadResult> => {
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

      try {
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

        const result = await arduinoService.uploadSketch(targetPort, targetBoard)
        clearInterval(progressTimer)

        setLastUploadResult(result)
        setUploadProgress({ percentage: 100, stage: 'complete' })

        if (result.success) {
          addLog({
            type: 'upload',
            message: 'Upload successful',
            details: result.output
          })
          toast.success('Upload successful')
        } else {
          addLog({
            type: 'error',
            message: 'Upload failed',
            details: result.error || result.output
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
        const result: UploadResult = {
          success: false,
          output: '',
          error: errorMessage
        }

        setLastUploadResult(result)
        setUploadProgress(null)

        addLog({
          type: 'error',
          message: 'Upload error',
          details: errorMessage
        })
        toast.error('Upload error', { description: errorMessage })

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
      files: FileMap,
      port?: string,
      boardConfig?: BoardConfig
    ): Promise<{ compile: CompileResult; upload: UploadResult }> => {
      // First compile
      const compileResult = await compileSketch(files, boardConfig)

      // Only upload if compilation was successful
      if (compileResult.success) {
        const uploadResult = await uploadSketch(port, boardConfig)
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
   */
  useEffect(() => {
    if (isAgentConnected && boards.length === 0) {
      refreshBoards()
    }
  }, [isAgentConnected, boards.length, refreshBoards])

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
