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
  /** Folder picker. The chosen folder joins the folders tinyStudio may read and write. */
  selectFolder: (defaultPath?: string) => Promise<string | null>
  /** Whether file access is allowed at this path (a chosen folder or the examples folder). */
  hasAccess: (targetPath: string) => Promise<boolean>
  readDirectory: (dirPath: string, recursive?: boolean) => Promise<FileSystemItem[]>
  readFile: (filePath: string) => Promise<string>
  writeFile: (filePath: string, content: string) => Promise<void>
  createFile: (filePath: string, content?: string) => Promise<void>
  renameFile: (oldPath: string, newPath: string) => Promise<void>
  createFolder: (folderPath: string) => Promise<void>
  deleteFile: (targetPath: string) => Promise<void>
  pathExists: (targetPath: string) => Promise<boolean>
  getFileStats: (filePath: string) => Promise<FileStats>
  saveFileAs: (defaultName: string, content: string) => Promise<string | null>
  openPath: (targetPath: string) => Promise<string>
  openExternal: (url: string) => Promise<void>
  showInFolder: (targetPath: string) => Promise<void>
}

/** Parts development: watch a local tinyparts checkout (npm run dev). */
interface PartsDevAPI {
  watch: (dir: string) => Promise<void>
  unwatch: () => Promise<void>
  /** batched file changes, as paths relative to the watched folder */
  onChanged: (cb: (info: { dir: string; paths: string[] }) => void) => () => void
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
  /** The Studio AI model id (shared/agentModels.ts), the default when none was chosen. */
  getModel: () => Promise<string>
  /** Rejects an id that isn't in the offered list. */
  setModel: (model: string) => Promise<void>
}

interface AppAPI {
  getExamplesDir: () => Promise<string>
  /** running unpackaged (npm run dev) */
  isDev: () => boolean
}

/** A signed-in GitHub account. The token is held in memory by the renderer only. */
export interface GitHubAccountInfo {
  login: string
  name: string
  avatarUrl: string
  token: string
}

export interface DeviceFlowStart {
  deviceCode: string
  /** the short code the user types on github.com */
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

interface GitHubAuthAPI {
  /** False when no OAuth client ID was built in; the UI falls back to a token. */
  isConfigured: () => Promise<boolean>
  getAccount: () => Promise<GitHubAccountInfo | null>
  startDeviceFlow: () => Promise<DeviceFlowStart>
  /** Resolves only once the user finishes authorising on github.com. */
  poll: (deviceCode: string, interval: number, expiresIn: number) => Promise<GitHubAccountInfo>
  cancelSignIn: () => Promise<void>
  signOut: () => Promise<void>
  signInWithToken: (token: string) => Promise<GitHubAccountInfo>
}

export interface ServiceError {
  message: string
  error: string
  /** The backend isn't running and won't restart on its own. */
  stopped: boolean
}

interface ServiceAPI {
  /** Real ws:// URL of the spawned tinyService backend (port may differ from 3000). */
  getUrl: () => Promise<string>
  /** Synchronous variant for construction-time use. */
  getUrlSync: () => string
  /** Whether the backend is running, and the last fatal error if it isn't. */
  getStatus: () => Promise<{ running: boolean; error: string | null }>
  /** Stop and start the backend again on the same port. */
  restart: () => Promise<{ ok: boolean; error?: string }>
  /** Backend problems found by the main process. */
  onError: (cb: (info: ServiceError) => void) => () => void
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
  context?: {
    board?: string
    openFile?: string
    lastError?: string
    view?: 'code' | 'circuit' | 'visual'
  }
}

export interface AgentStudioRequest {
  id: string
  method: 'inspectCircuit' | 'findParts' | 'readSerial'
  arg: string | number
}

interface AgentAPI {
  send: (args: AgentSendArgs) => Promise<void>
  abort: () => Promise<void>
  reset: () => Promise<void>
  respondPermission: (id: string, allow: boolean) => Promise<void>
  onEvent: (cb: (evt: AgentEvent) => void) => () => void
  onPermissionRequest: (cb: (req: AgentPermissionRequest) => void) => () => void
  onFileChanged: (cb: (info: { path: string }) => void) => () => void
  /** Desktop only: the main-process agent asking the renderer for live app state. */
  onStudioRequest?: (cb: (req: AgentStudioRequest) => void) => () => void
  respondStudio?: (id: string, answer: { ok: boolean; value: string }) => Promise<void>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      fs: FileSystemAPI
      arduino: ArduinoAPI
      settings: SettingsAPI
      github: GitHubAuthAPI
      agent: AgentAPI
      app: AppAPI
      service: ServiceAPI
      parts: PartsDevAPI
    }
  }
}
