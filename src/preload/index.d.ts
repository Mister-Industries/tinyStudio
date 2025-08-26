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
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      fs: FileSystemAPI
    }
  }
}
