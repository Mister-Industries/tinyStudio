/**
 * WebArduinoService - Arduino service implementation for web environment
 * Currently unimplemented - arduino-cli functionality is only available in Electron
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
 * Arduino service implementation for web applications
 * All methods throw unimplemented errors since arduino-cli requires filesystem access
 */
export class WebArduinoService implements ArduinoService {
  constructor() {
    // No initialization needed for unimplemented service
  }

  /**
   * Check status - not supported in web environment
   */
  async checkStatus(): Promise<AgentStatus> {
    throw new Error(
      'Arduino operations are not supported in web environment. Use Electron app for Arduino functionality.'
    )
  }

  /**
   * List boards - not supported in web environment
   */
  async listBoards(): Promise<Board[]> {
    throw new Error(
      'Arduino operations are not supported in web environment. Use Electron app for Arduino functionality.'
    )
  }

  /**
   * Get board info - not supported in web environment
   */
  async getBoardInfo(_port: string): Promise<BoardInfo> {
    throw new Error(
      'Arduino operations are not supported in web environment. Use Electron app for Arduino functionality.'
    )
  }

  /**
   * Compile sketch - not supported in web environment
   */
  async compileSketch(_files: FileMap, _boardConfig: BoardConfig): Promise<CompileResult> {
    throw new Error(
      'Arduino operations are not supported in web environment. Use Electron app for Arduino functionality.'
    )
  }

  /**
   * Upload sketch - not supported in web environment
   */
  async uploadSketch(
    _port: string,
    _boardConfig: BoardConfig,
    _binaryPath?: string
  ): Promise<UploadResult> {
    throw new Error(
      'Arduino operations are not supported in web environment. Use Electron app for Arduino functionality.'
    )
  }
}
