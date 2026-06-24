import { ElectronAPI } from '@electron-toolkit/preload'

// File system API types
interface FileSystemItem {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  lastModified?: number
}

interface FileStats {
  isDirectory: boolean
  isFile: boolean
  size: number
  lastModified: number
  created: number
}

interface FileSystemAPI {
  selectFolder: () => Promise<string | null>
  readDirectory: (dirPath: string, recursive?: boolean) => Promise<FileSystemItem[]>
  readFile: (filePath: string) => Promise<string>
  writeFile: (filePath: string, content: string) => Promise<void>
  createFile: (filePath: string, content?: string) => Promise<void>
  renameFile: (oldPath: string, newPath: string) => Promise<void>
  createFolder: (folderPath: string) => Promise<void>
  deleteFolder: (folderPath: string) => Promise<void>
  deleteFile: (targetPath: string) => Promise<void>
  pathExists: (targetPath: string) => Promise<boolean>
  getFileStats: (filePath: string) => Promise<FileStats>
  saveFileAs: (defaultName: string, content: string) => Promise<string | null>
  openPath: (targetPath: string) => Promise<string>
  openExternal: (url: string) => Promise<void>
}

// Arduino API types
interface AgentStatus {
  connected: boolean
  version?: string
  lastCheck: number
  error?: string
}

interface Board {
  port: string
  config: {
    fqbn: string
    name: string
    architecture?: string
    package?: string
  }
  protocol: 'serial' | 'network'
  connected: boolean
  metadata?: {
    vendorId?: string
    productId?: string
    serialNumber?: string
  }
}

interface BoardInfo extends Board {
  description: string
  uploadProtocols: string[]
  capabilities: string[]
}

interface CompileResult {
  success: boolean
  output: string
  errors?: Array<{
    message: string
    severity: 'error' | 'warning' | 'fatal'
    file?: string
    line?: number
    column?: number
  }>
  metrics?: {
    duration: number
  }
  binaryPath?: string
}

interface UploadResult {
  success: boolean
  output: string
  error?: string
  progress?: {
    percentage: number
    stage: string
  }
}

interface BoardConfig {
  fqbn: string
  name: string
  architecture?: string
  package?: string
  properties?: { [key: string]: string }
}

interface ArduinoAPI {
  checkStatus: () => Promise<AgentStatus>
  listBoards: () => Promise<Board[]>
  getBoardInfo: (port: string) => Promise<BoardInfo>
  compileSketch: (workspacePath: string, boardConfig: BoardConfig) => Promise<CompileResult>
  uploadSketch: (
    port: string,
    boardConfig: BoardConfig,
    binaryPath?: string
  ) => Promise<UploadResult>
  compileAndUpload: (
    workspacePath: string,
    port: string,
    boardConfig: { fqbn: string; name: string }
  ) => Promise<{ compile: CompileResult; upload: UploadResult }>
}

// Studio AI agent + settings types
interface SettingsStatus {
  configured: boolean
  source: 'stored' | 'env' | 'none'
}

interface SettingsAPI {
  getStatus: () => Promise<SettingsStatus>
  setApiKey: (key: string) => Promise<void>
  clearApiKey: () => Promise<void>
}

interface AppAPI {
  getExamplesDir: () => Promise<string>
}

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; message: string }

export interface AgentPermissionRequest {
  id: string
  tool: string
  action: string
  path: string
  preview: string
}

interface AgentSendArgs {
  text: string
  workspaceRoot: string | null
  context?: { board?: string; openFile?: string; lastError?: string }
}

interface AgentAPI {
  send: (args: AgentSendArgs) => Promise<void>
  abort: () => Promise<void>
  reset: () => Promise<void>
  respondPermission: (id: string, allow: boolean) => Promise<void>
  onEvent: (cb: (evt: AgentEvent) => void) => () => void
  onPermissionRequest: (cb: (req: AgentPermissionRequest) => void) => () => void
  onFileChanged: (cb: (info: { path: string }) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      fs: FileSystemAPI
      arduino: ArduinoAPI
      settings: SettingsAPI
      agent: AgentAPI
      app: AppAPI
    }
  }
}
