/**
 * ElectronArduinoService - Arduino service implementation for Electron environment
 * Uses IPC to communicate with main process Arduino Create Agent client
 */

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
 * Arduino service implementation for Electron applications
 * Communicates with main process via IPC for Arduino operations
 */
export class ElectronArduinoService implements ArduinoService {
  constructor() {
    // Verify we're in Electron environment
    if (typeof window === 'undefined' || !window.api?.arduino) {
      throw new Error('ElectronArduinoService can only be used in Electron renderer process')
    }
  }

  /**
   * Check Arduino Create Agent status via IPC
   */
  async checkStatus(): Promise<AgentStatus> {
    try {
      return await window.api.arduino.checkStatus()
    } catch (error) {
      return {
        connected: false,
        lastCheck: Date.now(),
        error: error instanceof Error ? error.message : 'IPC communication error'
      }
    }
  }

  /**
   * List connected Arduino boards via IPC
   */
  async listBoards(): Promise<Board[]> {
    try {
      return await window.api.arduino.listBoards()
    } catch (error) {
      console.error('Error listing boards via IPC:', error)
      throw new Error(
        `Failed to list boards: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Get board information via IPC
   */
  async getBoardInfo(port: string): Promise<BoardInfo> {
    try {
      return await window.api.arduino.getBoardInfo(port)
    } catch (error) {
      console.error('Error getting board info via IPC:', error)
      throw new Error(
        `Failed to get board info: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Compile Arduino sketch - redirects to compileAndUpload
   * Note: Arduino Create Agent client doesn't support compile-only
   */
  async compileSketch(_files: FileMap, _boardConfig: BoardConfig): Promise<CompileResult> {
    return {
      success: false,
      output:
        'Compilation-only not supported by Arduino Create Agent. Use compileAndUpload instead.',
      errors: [
        {
          message: 'Use compileAndUpload for compilation and upload together',
          severity: 'error' as const
        }
      ],
      metrics: { duration: 0 }
    }
  }

  /**
   * Upload sketch - requires prior compilation
   */
  async uploadSketch(
    _port: string,
    _boardConfig: BoardConfig,
    _binaryPath?: string
  ): Promise<UploadResult> {
    return {
      success: false,
      output: '',
      error: 'Upload requires compilation. Use compileAndUpload instead.'
    }
  }

  /**
   * Compile and upload sketch via IPC
   */
  async compileAndUpload(
    files: FileMap,
    port: string,
    boardConfig: BoardConfig
  ): Promise<{ compile: CompileResult; upload: UploadResult }> {
    try {
      const config = {
        fqbn: boardConfig.fqbn,
        name: boardConfig.name
      }

      const result = await window.api.arduino.compileAndUpload(files, port, config)

      // Cast the result to match our service types
      return {
        compile: {
          ...result.compile,
          errors: result.compile.errors?.map((error) => ({
            ...error,
            severity: error.severity === 'warning' ? 'error' : error.severity
          })) as CompileResult['errors']
        },
        upload: {
          ...result.upload,
          progress: result.upload.progress
            ? {
                percentage: result.upload.progress.percentage,
                stage: result.upload.progress.stage as
                  | 'preparing'
                  | 'uploading'
                  | 'verifying'
                  | 'complete'
              }
            : undefined
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      return {
        compile: {
          success: false,
          output: `Error: ${errorMessage}`,
          errors: [{ message: errorMessage, severity: 'fatal' as const }],
          metrics: { duration: 0 }
        },
        upload: {
          success: false,
          output: '',
          error: errorMessage
        }
      }
    }
  }
}
