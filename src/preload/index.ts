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
      ipcRenderer.invoke('get-file-stats', filePath),
    // Show a Save dialog and write the given content; returns the saved path or null.
    saveFileAs: (defaultName: string, content: string): Promise<string | null> =>
      ipcRenderer.invoke('save-file-as', defaultName, content),
    // Open a local file with the OS default app (e.g. exported HTML in a browser).
    openPath: (targetPath: string): Promise<string> => ipcRenderer.invoke('open-path', targetPath),
    // Open an external URL in the default browser.
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url)
  },

  // App settings (Studio AI). The renderer never sees the API key value —
  // only whether one is configured.
  settings: {
    getStatus: (): Promise<{ configured: boolean; source: 'stored' | 'env' | 'none' }> =>
      ipcRenderer.invoke('settings:status'),
    setApiKey: (key: string): Promise<void> => ipcRenderer.invoke('settings:set-key', key),
    clearApiKey: (): Promise<void> => ipcRenderer.invoke('settings:clear-key')
  },

  // Studio AI agent. send() returns immediately; results stream over onEvent().
  agent: {
    send: (args: {
      text: string
      workspaceRoot: string | null
      context?: { board?: string; openFile?: string; lastError?: string }
    }): Promise<void> => ipcRenderer.invoke('agent:send', args),
    abort: (): Promise<void> => ipcRenderer.invoke('agent:abort'),
    reset: (): Promise<void> => ipcRenderer.invoke('agent:reset'),
    respondPermission: (id: string, allow: boolean): Promise<void> =>
      ipcRenderer.invoke('agent:permission-response', id, allow),
    onEvent: (cb: (evt: unknown) => void): (() => void) => {
      const handler = (_e: unknown, evt: unknown): void => cb(evt)
      ipcRenderer.on('agent:event', handler)
      return () => ipcRenderer.removeListener('agent:event', handler)
    },
    onPermissionRequest: (cb: (req: unknown) => void): (() => void) => {
      const handler = (_e: unknown, req: unknown): void => cb(req)
      ipcRenderer.on('agent:permission-request', handler)
      return () => ipcRenderer.removeListener('agent:permission-request', handler)
    },
    onFileChanged: (cb: (info: { path: string }) => void): (() => void) => {
      const handler = (_e: unknown, info: { path: string }): void => cb(info)
      ipcRenderer.on('agent:file-changed', handler)
      return () => ipcRenderer.removeListener('agent:file-changed', handler)
    }
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
