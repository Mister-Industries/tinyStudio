// Unified File System Service
// Provides consistent API for both Electron and web environments

import { webFileSystem, type FileSystemItem, type FileStats } from './webFileSystem'

// Environment detection
const isElectron = (): boolean => {
  return typeof window !== 'undefined' && window.electron != null
}

export interface UnifiedFileSystemAPI {
  selectFolder(): Promise<string | null>
  readDirectory(dirPath?: string, recursive?: boolean): Promise<FileSystemItem[]>
  readFile(filePath: string): Promise<string>
  writeFile(filePath: string, content: string): Promise<void>
  createFile(filePath: string, content?: string): Promise<void>
  createFolder(folderPath: string): Promise<void>
  deleteFile(targetPath: string): Promise<void>
  pathExists(targetPath: string): Promise<boolean>
  getFileStats(filePath: string): Promise<FileStats>
  isElectron(): boolean
  supportsFileSystemAccess(): boolean
}

class UnifiedFileSystemService implements UnifiedFileSystemAPI {
  private currentWorkspace: string | null = null

  // Environment detection
  isElectron(): boolean {
    return isElectron()
  }

  supportsFileSystemAccess(): boolean {
    return !this.isElectron() && 'showDirectoryPicker' in window
  }

  // Select folder
  async selectFolder(): Promise<string | null> {
    try {
      if (this.isElectron()) {
        const result = await window.api.fs.selectFolder()
        this.currentWorkspace = result
        return result
      } else {
        const result = await webFileSystem.selectFolder()
        this.currentWorkspace = result
        return result
      }
    } catch (error) {
      console.error('Error selecting folder:', error)
      throw new Error(`Failed to select folder: ${(error as Error).message}`)
    }
  }

  // Read directory contents
  async readDirectory(dirPath = '', recursive = false): Promise<FileSystemItem[]> {
    try {
      if (this.isElectron()) {
        const targetPath = dirPath || this.currentWorkspace
        if (!targetPath) {
          throw new Error('No directory path provided and no workspace selected')
        }
        return await window.api.fs.readDirectory(targetPath, recursive)
      } else {
        return await webFileSystem.readDirectory(dirPath, recursive)
      }
    } catch (error) {
      console.error('Error reading directory:', error)
      throw new Error(`Failed to read directory: ${(error as Error).message}`)
    }
  }

  // Read file content
  async readFile(filePath: string): Promise<string> {
    try {
      if (this.isElectron()) {
        return await window.api.fs.readFile(filePath)
      } else {
        return await webFileSystem.readFile(filePath)
      }
    } catch (error) {
      console.error('Error reading file:', error)
      throw new Error(`Failed to read file: ${(error as Error).message}`)
    }
  }

  // Write file content
  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      if (this.isElectron()) {
        await window.api.fs.writeFile(filePath, content)
      } else {
        await webFileSystem.writeFile(filePath, content)
      }
    } catch (error) {
      console.error('Error writing file:', error)
      throw new Error(`Failed to write file: ${(error as Error).message}`)
    }
  }

  // Create new file
  async createFile(filePath: string, content = ''): Promise<void> {
    try {
      if (this.isElectron()) {
        await window.api.fs.createFile(filePath, content)
      } else {
        await webFileSystem.createFile(filePath, content)
      }
    } catch (error) {
      console.error('Error creating file:', error)
      throw new Error(`Failed to create file: ${(error as Error).message}`)
    }
  }

  // Create new folder
  async createFolder(folderPath: string): Promise<void> {
    try {
      if (this.isElectron()) {
        await window.api.fs.createFolder(folderPath)
      } else {
        await webFileSystem.createFolder(folderPath)
      }
    } catch (error) {
      console.error('Error creating folder:', error)
      throw new Error(`Failed to create folder: ${(error as Error).message}`)
    }
  }

  // Delete file or directory
  async deleteFile(targetPath: string): Promise<void> {
    try {
      if (this.isElectron()) {
        await window.api.fs.deleteFile(targetPath)
      } else {
        await webFileSystem.deleteFile(targetPath)
      }
    } catch (error) {
      console.error('Error deleting file/folder:', error)
      throw new Error(`Failed to delete file/folder: ${(error as Error).message}`)
    }
  }

  // Check if path exists
  async pathExists(targetPath: string): Promise<boolean> {
    try {
      if (this.isElectron()) {
        return await window.api.fs.pathExists(targetPath)
      } else {
        return await webFileSystem.pathExists(targetPath)
      }
    } catch (error) {
      console.error('Error checking path existence:', error)
      return false
    }
  }

  // Get file stats
  async getFileStats(filePath: string): Promise<FileStats> {
    try {
      if (this.isElectron()) {
        return await window.api.fs.getFileStats(filePath)
      } else {
        return await webFileSystem.getFileStats(filePath)
      }
    } catch (error) {
      console.error('Error getting file stats:', error)
      throw new Error(`Failed to get file stats: ${(error as Error).message}`)
    }
  }

  // Get current workspace
  getCurrentWorkspace(): string | null {
    return this.currentWorkspace
  }

  // Set current workspace
  setCurrentWorkspace(workspace: string | null): void {
    this.currentWorkspace = workspace
  }

  // Utility methods
  getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.')
    return lastDot === -1 ? '' : fileName.substring(lastDot + 1).toLowerCase()
  }

  getFileName(filePath: string): string {
    return filePath.split('/').pop() || filePath.split('\\').pop() || ''
  }

  getDirectoryPath(filePath: string): string {
    const parts = filePath.split(/[/\\]/)
    parts.pop()
    return parts.join('/')
  }

  joinPath(...parts: string[]): string {
    return parts.filter(Boolean).join('/')
  }

  normalizePath(path: string): string {
    return path.replace(/\\/g, '/')
  }

  // File type detection
  isTextFile(fileName: string): boolean {
    const textExtensions = [
      'txt',
      'md',
      'js',
      'ts',
      'jsx',
      'tsx',
      'json',
      'html',
      'css',
      'scss',
      'sass',
      'less',
      'xml',
      'yaml',
      'yml',
      'toml',
      'ini',
      'cfg',
      'conf',
      'log',
      'py',
      'java',
      'c',
      'cpp',
      'h',
      'hpp',
      'cs',
      'php',
      'rb',
      'go',
      'rs',
      'swift',
      'kt',
      'scala',
      'sh',
      'ps1',
      'bat',
      'cmd',
      'dockerfile',
      'gitignore',
      'gitattributes',
      'editorconfig',
      'prettierrc',
      'eslintrc',
      'babelrc'
    ]
    const extension = this.getFileExtension(fileName)
    return textExtensions.includes(extension) || !extension
  }

  isImageFile(fileName: string): boolean {
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp', 'webp', 'ico']
    return imageExtensions.includes(this.getFileExtension(fileName))
  }

  isCodeFile(fileName: string): boolean {
    const codeExtensions = [
      'js',
      'ts',
      'jsx',
      'tsx',
      'vue',
      'svelte',
      'py',
      'java',
      'c',
      'cpp',
      'cs',
      'php',
      'rb',
      'go',
      'rs',
      'swift',
      'kt',
      'scala',
      'html',
      'css',
      'scss',
      'sass',
      'less'
    ]
    return codeExtensions.includes(this.getFileExtension(fileName))
  }
}

// Create singleton instance
export const fileSystem = new UnifiedFileSystemService()

// Export types
export type { FileSystemItem, FileStats }
