import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

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
      ipcRenderer.invoke('get-file-stats', filePath)
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
