// Web File System Service using File System Access API
// Provides equivalent functionality to Electron's file system APIs for web browsers

// Type declarations for File System Access API
declare global {
  interface Window {
    showDirectoryPicker(): Promise<FileSystemDirectoryHandle>
    showOpenFilePicker(): Promise<FileSystemFileHandle[]>
  }
}

export interface FileSystemItem {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  lastModified?: number
  handle?: FileSystemHandle
}

export interface FileStats {
  isDirectory: boolean
  isFile: boolean
  size: number
  lastModified: number
  created: number
}

class WebFileSystemService {
  private directoryHandle: FileSystemDirectoryHandle | null = null
  private fileHandles: Map<string, FileSystemFileHandle> = new Map()

  // Check if File System Access API is supported
  static isSupported(): boolean {
    return 'showDirectoryPicker' in window && 'showOpenFilePicker' in window
  }

  // Get the name of the currently selected root directory
  get rootDirectoryName(): string | null {
    return this.directoryHandle?.name || null
  }

  // Select folder using File System Access API
  async selectFolder(): Promise<string | null> {
    try {
      if (!WebFileSystemService.isSupported()) {
        throw new Error('File System Access API not supported')
      }

      this.directoryHandle = await window.showDirectoryPicker()
      return this.directoryHandle?.name || null
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return null // User cancelled
      }
      console.error('Error selecting folder:', error)
      throw error
    }
  }

  // Fallback folder selection using input element
  async selectFolderFallback(): Promise<FileList | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.webkitdirectory = true
      input.multiple = true

      input.onchange = () => {
        resolve(input.files)
      }

      input.oncancel = () => {
        resolve(null)
      }

      input.click()
    })
  }

  // Read directory contents
  async readDirectory(dirPath = '', recursive = false): Promise<FileSystemItem[]> {
    try {
      if (!this.directoryHandle) {
        throw new Error('No directory selected')
      }

      const items: FileSystemItem[] = []

      // If dirPath is empty or matches the root directory name, use the root directory handle
      let targetHandle: FileSystemDirectoryHandle | null
      if (!dirPath || dirPath === this.directoryHandle.name) {
        targetHandle = this.directoryHandle
        dirPath = '' // Ensure we use empty string for root directory
      } else {
        targetHandle = await this.getDirectoryHandle(dirPath)
      }

      if (!targetHandle) {
        throw new Error('Directory not found')
      }

      await this.readDirectoryRecursive(targetHandle, dirPath, items, recursive)
      return items
    } catch (error) {
      console.error('Error reading directory:', error)
      throw error
    }
  }

  private async readDirectoryRecursive(
    dirHandle: FileSystemDirectoryHandle,
    currentPath: string,
    items: FileSystemItem[],
    recursive: boolean
  ): Promise<void> {
    // @ts-expect-error - entries() method exists but TypeScript doesn't know about it
    for await (const [name, handle] of dirHandle.entries()) {
      const fullPath = currentPath ? `${currentPath}/${name}` : name
      let size: number | undefined
      let lastModified: number | undefined

      if (handle.kind === 'file') {
        try {
          const file = await (handle as FileSystemFileHandle).getFile()
          size = file.size
          lastModified = file.lastModified
          this.fileHandles.set(fullPath, handle as FileSystemFileHandle)
        } catch {
          // Handle may be inaccessible
        }
      }

      const item: FileSystemItem = {
        name,
        path: fullPath,
        isDirectory: handle.kind === 'directory',
        size,
        lastModified,
        handle
      }

      items.push(item)

      if (recursive && handle.kind === 'directory') {
        await this.readDirectoryRecursive(
          handle as FileSystemDirectoryHandle,
          fullPath,
          items,
          recursive
        )
      }
    }
  }

  // Read file content
  async readFile(filePath: string): Promise<string> {
    try {
      const normalizedPath = this.normalizePath(filePath)
      const fileHandle =
        this.fileHandles.get(normalizedPath) ||
        this.fileHandles.get(filePath) ||
        (await this.getFileHandle(normalizedPath))

      if (!fileHandle) {
        throw new Error('File not found')
      }

      const file = await fileHandle.getFile()
      return await file.text()
    } catch (error) {
      console.error('Error reading file:', error)
      throw error
    }
  }

  // Write file content
  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      // Normalize the file path
      const normalizedPath = this.normalizePath(filePath)

      let fileHandle = this.fileHandles.get(normalizedPath) || this.fileHandles.get(filePath)

      if (!fileHandle) {
        // Create new file
        const pathParts = normalizedPath.split('/')
        const fileName = pathParts.pop()!
        const dirPath = pathParts.join('/')

        const dirHandle = await this.resolveDirectoryHandle(dirPath)
        fileHandle = await dirHandle.getFileHandle(fileName, { create: true })
        this.fileHandles.set(normalizedPath, fileHandle)
        this.fileHandles.set(filePath, fileHandle) // Store both normalized and original paths
      }

      const writable = await fileHandle.createWritable()
      await writable.write(content)
      await writable.close()
    } catch (error) {
      console.error('Error writing file:', error)
      throw error
    }
  }

  // Create new file
  async createFile(filePath: string, content = ''): Promise<void> {
    try {
      const normalizedPath = this.normalizePath(filePath)
      // Check if file already exists using both paths
      if (this.fileHandles.has(normalizedPath) || this.fileHandles.has(filePath)) {
        throw new Error('File already exists')
      }

      await this.writeFile(filePath, content)
    } catch (error) {
      console.error('Error creating file:', error)
      throw error
    }
  }

  // Create new folder
  async createFolder(folderPath: string): Promise<void> {
    try {
      const normalizedPath = this.normalizePath(folderPath)
      const pathParts = normalizedPath.split('/')
      const folderName = pathParts.pop()!
      const parentPath = pathParts.join('/')

      const parentHandle = await this.resolveDirectoryHandle(parentPath)
      await parentHandle.getDirectoryHandle(folderName, { create: true })
    } catch (error) {
      console.error('Error creating folder:', error)
      throw error
    }
  }

  // Delete file or directory
  async deleteFile(targetPath: string): Promise<void> {
    try {
      const normalizedPath = this.normalizePath(targetPath)
      const pathParts = normalizedPath.split('/')
      const name = pathParts.pop()!
      const parentPath = pathParts.join('/')

      const parentHandle = await this.resolveDirectoryHandle(parentPath)
      await parentHandle.removeEntry(name, { recursive: true })

      // Delete from file handles using both paths
      this.fileHandles.delete(normalizedPath)
      this.fileHandles.delete(targetPath)
    } catch (error) {
      console.error('Error deleting file/folder:', error)
      throw error
    }
  }

  // Check if path exists
  async pathExists(targetPath: string): Promise<boolean> {
    try {
      if (!this.directoryHandle) return false

      // Normalize the path first
      const normalizedPath = this.normalizePath(targetPath)

      // If the normalized path is empty, it means we're checking for the root directory
      if (!normalizedPath) {
        return true // Root directory always exists
      }

      const pathParts = normalizedPath.split('/').filter(Boolean)
      let currentHandle: FileSystemDirectoryHandle = this.directoryHandle

      for (const part of pathParts.slice(0, -1)) {
        try {
          currentHandle = await currentHandle.getDirectoryHandle(part)
        } catch {
          return false
        }
      }

      const finalPart = pathParts[pathParts.length - 1]
      try {
        await currentHandle.getFileHandle(finalPart)
        return true
      } catch {
        try {
          await currentHandle.getDirectoryHandle(finalPart)
          return true
        } catch {
          return false
        }
      }
    } catch (error) {
      console.error('Error in pathExists:', error)
      return false
    }
  }

  // Get file stats
  async getFileStats(filePath: string): Promise<FileStats> {
    try {
      const normalizedPath = this.normalizePath(filePath)
      const fileHandle =
        this.fileHandles.get(normalizedPath) ||
        this.fileHandles.get(filePath) ||
        (await this.getFileHandle(normalizedPath))

      if (!fileHandle) {
        throw new Error('File not found')
      }

      const file = await fileHandle.getFile()
      return {
        isDirectory: false,
        isFile: true,
        size: file.size,
        lastModified: file.lastModified,
        created: file.lastModified // Web API doesn't provide creation time
      }
    } catch (error) {
      console.error('Error getting file stats:', error)
      throw error
    }
  }

  // Helper methods
  private normalizePath(path: string): string {
    if (!path || !this.directoryHandle) return path

    // If path starts with the root directory name, remove it
    // This handles cases where paths are constructed with workspace name included
    if (path.startsWith(this.directoryHandle.name + '/')) {
      path = path.substring(this.directoryHandle.name.length + 1)
    }

    // If path is exactly the root directory name, return empty string
    if (path === this.directoryHandle.name) {
      path = ''
    }

    return path
  }

  private async getDirectoryHandle(path: string): Promise<FileSystemDirectoryHandle | null> {
    if (!this.directoryHandle) return null

    // Normalize the path first
    path = this.normalizePath(path)

    // Handle empty path or root directory
    if (!path) {
      return this.directoryHandle
    }

    const pathParts = path.split('/').filter(Boolean)
    let currentHandle = this.directoryHandle

    try {
      for (const part of pathParts) {
        currentHandle = await currentHandle.getDirectoryHandle(part)
      }
      return currentHandle
    } catch (error) {
      console.error(`Error getting directory handle for path "${path}":`, error)
      return null
    }
  }

  // Helper method to resolve directory handle with better error handling
  private async resolveDirectoryHandle(path: string): Promise<FileSystemDirectoryHandle> {
    if (!this.directoryHandle) {
      throw new Error('No directory selected')
    }

    // Normalize the path first
    path = this.normalizePath(path)

    // Handle empty path or root directory
    if (!path) {
      return this.directoryHandle
    }

    const pathParts = path.split('/').filter(Boolean)
    let currentHandle = this.directoryHandle

    try {
      for (const part of pathParts) {
        currentHandle = await currentHandle.getDirectoryHandle(part)
      }
      return currentHandle
    } catch (error) {
      console.error(`Error resolving directory handle for path "${path}":`, error)
      throw new Error(`Directory not found: ${path}`)
    }
  }

  private async getFileHandle(path: string): Promise<FileSystemFileHandle | null> {
    const pathParts = path.split('/')
    const fileName = pathParts.pop()!
    const dirPath = pathParts.join('/')

    try {
      const dirHandle = await this.resolveDirectoryHandle(dirPath)
      const fileHandle = await dirHandle.getFileHandle(fileName)
      this.fileHandles.set(path, fileHandle)
      return fileHandle
    } catch {
      return null
    }
  }
}

export const webFileSystem = new WebFileSystemService()
