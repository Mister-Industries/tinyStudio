/**
 * WebArduinoService - Arduino service implementation for web environment
 * Currently unimplemented - arduino-cli functionality is only available in Electron
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import {
  AgentStatus,
  ArduinoActionResult,
  ArduinoService,
  Board,
  BoardConfig,
  BoardInfo,
  CompileResult,
  InstallableBoard,
  LibraryEntry,
  PlatformEntry,
  UploadResult
} from './types'

const WEB_UNSUPPORTED =
  'Arduino operations are not supported in web environment. Use Electron app for Arduino functionality.'

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
  async compileSketch(_workspacePath: string, _boardConfig: BoardConfig): Promise<CompileResult> {
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
    _workspacePathOrBinary?: string
  ): Promise<UploadResult> {
    throw new Error(
      'Arduino operations are not supported in web environment. Use Electron app for Arduino functionality.'
    )
  }

  async searchLibraries(_query: string): Promise<LibraryEntry[]> {
    throw new Error(WEB_UNSUPPORTED)
  }

  async listLibraries(): Promise<LibraryEntry[]> {
    throw new Error(WEB_UNSUPPORTED)
  }

  async installLibrary(
    _name: string,
    _version?: string
  ): Promise<{ success: boolean; output: string; error?: string }> {
    throw new Error(WEB_UNSUPPORTED)
  }

  async uninstallLibrary(
    _name: string
  ): Promise<{ success: boolean; output: string; error?: string }> {
    throw new Error(WEB_UNSUPPORTED)
  }

  async searchCores(_query: string): Promise<PlatformEntry[]> {
    throw new Error(WEB_UNSUPPORTED)
  }

  async listCores(): Promise<PlatformEntry[]> {
    throw new Error(WEB_UNSUPPORTED)
  }

  async installCore(_id: string, _version?: string): Promise<ArduinoActionResult> {
    throw new Error(WEB_UNSUPPORTED)
  }

  async uninstallCore(_id: string): Promise<ArduinoActionResult> {
    throw new Error(WEB_UNSUPPORTED)
  }

  async listAllBoards(): Promise<InstallableBoard[]> {
    throw new Error(WEB_UNSUPPORTED)
  }

  async listBoardUrls(): Promise<string[]> {
    throw new Error(WEB_UNSUPPORTED)
  }

  async addBoardUrl(_url: string): Promise<ArduinoActionResult> {
    throw new Error(WEB_UNSUPPORTED)
  }

  async removeBoardUrl(_url: string): Promise<ArduinoActionResult> {
    throw new Error(WEB_UNSUPPORTED)
  }

  openSerial(_port: string, _baud: number): void {
    /* unsupported in web */
  }

  closeSerial(): void {
    /* unsupported in web */
  }

  writeSerial(_data: string): void {
    /* unsupported in web */
  }

  onSerialData(_cb: (line: string) => void): () => void {
    return () => {}
  }

  onSerialStatus(_cb: (status: { opened?: boolean; closed?: boolean }) => void): () => void {
    return () => {}
  }
}
