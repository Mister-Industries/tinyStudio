import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'

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

// Arduino API types
interface AgentStatus {
  connected: boolean
  version?: string
  lastCheck: number
  error?: string
}

interface BoardConfig {
  fqbn: string
  name: string
  architecture?: string
  package?: string
  properties?: { [key: string]: string }
}

interface Board {
  port: string
  config: BoardConfig
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

// Custom APIs for renderer
const api = {
  // File system operations
  fs: {
    selectFolder: (): Promise<string | null> => ipcRenderer.invoke('select-folder'),
    readDirectory: (dirPath: string, recursive = false): Promise<FileSystemItem[]> =>
      ipcRenderer.invoke('read-directory', dirPath, recursive),
    readFile: (filePath: string): Promise<string> => ipcRenderer.invoke('read-file', filePath),
    writeFile: (filePath: string, content: string): Promise<void> =>
      ipcRenderer.invoke('write-file', filePath, content),
    createFile: (filePath: string, content = ''): Promise<void> =>
      ipcRenderer.invoke('create-file', filePath, content),
    renameFile: (oldPath: string, newPath: string): Promise<void> =>
      ipcRenderer.invoke('rename-file', oldPath, newPath),
    createFolder: (folderPath: string): Promise<void> =>
      ipcRenderer.invoke('create-folder', folderPath),
    deleteFile: (targetPath: string): Promise<void> =>
      ipcRenderer.invoke('delete-file', targetPath),
    pathExists: (targetPath: string): Promise<boolean> =>
      ipcRenderer.invoke('path-exists', targetPath),
    getFileStats: (filePath: string): Promise<FileStats> =>
      ipcRenderer.invoke('get-file-stats', filePath)
  },

  // Arduino operations
  arduino: {
    checkStatus: (): Promise<AgentStatus> => ipcRenderer.invoke('arduino:checkStatus'),
    listBoards: (): Promise<Board[]> => ipcRenderer.invoke('arduino:listBoards'),
    getBoardInfo: (port: string): Promise<BoardInfo> =>
      ipcRenderer.invoke('arduino:getBoardInfo', port),
    compileSketch: (workspacePath: string, boardConfig: BoardConfig): Promise<CompileResult> =>
      ipcRenderer.invoke('arduino:compileSketch', workspacePath, boardConfig),
    uploadSketch: (
      port: string,
      boardConfig: BoardConfig,
      binaryPath?: string
    ): Promise<UploadResult> =>
      ipcRenderer.invoke('arduino:uploadSketch', port, boardConfig, binaryPath),
    compileAndUpload: (
      workspacePath: string,
      port: string,
      boardConfig: { fqbn: string; name: string }
    ): Promise<{ compile: CompileResult; upload: UploadResult }> =>
      ipcRenderer.invoke('arduino:compileAndUpload', workspacePath, port, boardConfig)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
