// React Hook for File System Operations
// Manages workspace state, loading states, and error handling

import { useState, useCallback, useEffect } from 'react'
import { fileSystem, type FileSystemItem } from '../lib/fileSystem'
import { useAppDispatch, useAppSelector } from '../redux/hooks'
import { selectOpenFiles, refreshFileContentFromDisk } from '../redux/fileSlice'

export interface UseFileSystemOptions {
  autoLoadWorkspace?: boolean
  watchChanges?: boolean
}

export interface FileSystemState {
  workspace: string | null
  files: FileSystemItem[]
  currentFile: string | null
  isLoading: boolean
  error: string | null
  unsavedChanges: Set<string>
}

export interface FileSystemActions {
  selectWorkspace: () => Promise<void>
  openWorkspace: (workspacePath: string) => Promise<void>
  refreshFiles: () => Promise<void>
  refreshOpenFileContents: () => Promise<void>
  loadDirectory: (dirPath: string) => Promise<FileSystemItem[]>
  openFile: (filePath: string) => Promise<string>
  saveFile: (filePath: string, content: string) => Promise<void>
  createFile: (filePath: string, content?: string) => Promise<void>
  createFolder: (folderPath: string) => Promise<void>
  deleteFile: (targetPath: string) => Promise<void>
  setCurrentFile: (filePath: string | null) => void
  markUnsaved: (filePath: string) => void
  markSaved: (filePath: string) => void
  hasUnsavedChanges: (filePath: string) => boolean
  clearError: () => void
}

export interface UseFileSystemReturn extends FileSystemState, FileSystemActions {}

export function useFileSystem(options: UseFileSystemOptions = {}): UseFileSystemReturn {
  const { autoLoadWorkspace = false, watchChanges = false } = options

  // Redux integration
  const dispatch = useAppDispatch()
  const openFiles = useAppSelector(selectOpenFiles)

  // State
  const [state, setState] = useState<FileSystemState>({
    workspace: null,
    files: [],
    currentFile: null,
    isLoading: false,
    error: null,
    unsavedChanges: new Set()
  })

  // Error handling helper
  const handleError = useCallback((error: unknown, action: string) => {
    const message = error instanceof Error ? error.message : `Unknown error during ${action}`
    console.error(`FileSystem ${action} error:`, error)
    setState((prev) => ({ ...prev, error: message, isLoading: false }))
  }, [])

  // Refresh open file contents in Redux
  const refreshOpenFileContents = useCallback(async () => {
    if (openFiles.length === 0) return

    try {
      // Update content for all currently open files
      for (const file of openFiles) {
        if (file.path) {
          try {
            const currentContent = await fileSystem.readFile(file.path)
            // Only update if content has changed to avoid unnecessary re-renders
            if (currentContent !== file.content) {
              dispatch(refreshFileContentFromDisk({ id: file.id, content: currentContent }))
            }
          } catch (error) {
            console.warn(`Failed to refresh content for file ${file.path}:`, error)
            // Continue with other files even if one fails
          }
        }
      }
    } catch (error) {
      console.error('Error refreshing open file contents:', error)
    }
  }, [openFiles, dispatch])

  // Refresh file list
  const refreshFiles = useCallback(async () => {
    if (!state.workspace) {
      setState((prev) => ({ ...prev, files: [], isLoading: false }))
      return
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }))

    try {
      const files = await fileSystem.readDirectory(state.workspace, false)
      setState((prev) => ({ ...prev, files, isLoading: false }))

      // Also refresh content of currently open files
      await refreshOpenFileContents()
    } catch (error) {
      handleError(error, 'file refresh')
    }
  }, [state.workspace, handleError, refreshOpenFileContents])

  // Select workspace folder
  const selectWorkspace = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }))

    try {
      const workspacePath = await fileSystem.selectFolder()
      if (workspacePath) {
        setState((prev) => ({ ...prev, workspace: workspacePath }))

        // Load files for the new workspace immediately
        try {
          const files = await fileSystem.readDirectory(workspacePath, false)
          setState((prev) => ({ ...prev, files, isLoading: false }))
        } catch (fileError) {
          handleError(fileError, 'file loading after workspace selection')
        }
      } else {
        setState((prev) => ({ ...prev, isLoading: false }))
      }
    } catch (error) {
      handleError(error, 'workspace selection')
    }
  }, [handleError])

  // Open workspace programmatically
  const openWorkspace = useCallback(
    async (workspacePath: string) => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))

      try {
        // Verify the path exists
        const exists = await fileSystem.pathExists(workspacePath)
        if (!exists) {
          throw new Error('Workspace path does not exist')
        }

        setState((prev) => ({ ...prev, workspace: workspacePath }))

        // Load files for the new workspace immediately
        try {
          const files = await fileSystem.readDirectory(workspacePath, false)
          setState((prev) => ({ ...prev, files, isLoading: false }))
        } catch (fileError) {
          handleError(fileError, 'file loading after workspace open')
        }
      } catch (error) {
        handleError(error, 'workspace open')
      }
    },
    [handleError]
  )

  // Open and read file
  const openFile = useCallback(
    async (filePath: string): Promise<string> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))

      try {
        const content = await fileSystem.readFile(filePath)
        setState((prev) => ({ ...prev, currentFile: filePath, isLoading: false }))
        return content
      } catch (error) {
        handleError(error, 'file open')
        throw error
      }
    },
    [handleError]
  )

  // Save file
  const saveFile = useCallback(
    async (filePath: string, content: string): Promise<void> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))

      try {
        await fileSystem.writeFile(filePath, content)
        setState((prev) => {
          const newUnsavedChanges = new Set(prev.unsavedChanges)
          newUnsavedChanges.delete(filePath)
          return { ...prev, unsavedChanges: newUnsavedChanges, isLoading: false }
        })
      } catch (error) {
        handleError(error, 'file save')
        throw error
      }
    },
    [handleError]
  )

  // Create new file
  const createFile = useCallback(
    async (filePath: string, content = ''): Promise<void> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))

      try {
        await fileSystem.createFile(filePath, content)
        await refreshFiles()
      } catch (error) {
        handleError(error, 'file creation')
        throw error
      }
    },
    [refreshFiles, handleError]
  )

  // Create new folder
  const createFolder = useCallback(
    async (folderPath: string): Promise<void> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))

      try {
        await fileSystem.createFolder(folderPath)
        await refreshFiles()
      } catch (error) {
        handleError(error, 'folder creation')
        throw error
      }
    },
    [refreshFiles, handleError]
  )

  // Delete file or folder
  const deleteFile = useCallback(
    async (targetPath: string): Promise<void> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))

      try {
        await fileSystem.deleteFile(targetPath)
        setState((prev) => {
          const newUnsavedChanges = new Set(prev.unsavedChanges)
          newUnsavedChanges.delete(targetPath)
          return {
            ...prev,
            unsavedChanges: newUnsavedChanges,
            currentFile: prev.currentFile === targetPath ? null : prev.currentFile
          }
        })
        await refreshFiles()
      } catch (error) {
        handleError(error, 'file deletion')
        throw error
      }
    },
    [refreshFiles, handleError]
  )

  // Set current file
  const setCurrentFile = useCallback((filePath: string | null) => {
    setState((prev) => ({ ...prev, currentFile: filePath }))
  }, [])

  // Mark file as having unsaved changes
  const markUnsaved = useCallback((filePath: string) => {
    setState((prev) => {
      const newUnsavedChanges = new Set(prev.unsavedChanges)
      newUnsavedChanges.add(filePath)
      return { ...prev, unsavedChanges: newUnsavedChanges }
    })
  }, [])

  // Mark file as saved
  const markSaved = useCallback((filePath: string) => {
    setState((prev) => {
      const newUnsavedChanges = new Set(prev.unsavedChanges)
      newUnsavedChanges.delete(filePath)
      return { ...prev, unsavedChanges: newUnsavedChanges }
    })
  }, [])

  // Check if file has unsaved changes
  const hasUnsavedChanges = useCallback(
    (filePath: string): boolean => {
      return state.unsavedChanges.has(filePath)
    },
    [state.unsavedChanges]
  )

  // Clear error
  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }))
  }, [])

  // Auto-load workspace on mount if enabled
  useEffect(() => {
    if (autoLoadWorkspace && !state.workspace) {
      selectWorkspace()
    }
  }, [autoLoadWorkspace, state.workspace, selectWorkspace])

  // Watch for changes if enabled (Electron only)
  useEffect(() => {
    if (!watchChanges || !fileSystem.isElectron() || !state.workspace) {
      return
    }

    // TODO: Implement file watching for Electron
    // This would require additional IPC handlers for fs.watch
    const watchInterval = setInterval(() => {
      refreshFiles()
    }, 5000) // Fallback: refresh every 5 seconds

    return () => clearInterval(watchInterval)
  }, [watchChanges, state.workspace, refreshFiles])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey) {
        switch (event.key) {
          case 'o':
            event.preventDefault()
            selectWorkspace()
            break
          case 's':
            if (state.currentFile && state.unsavedChanges.has(state.currentFile)) {
              event.preventDefault()
              // Note: This would need access to the file content from the editor
              // In practice, this would be handled by the editor component
            }
            break
          case 'n':
            event.preventDefault()
            // Could open a dialog to create new file
            break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectWorkspace, state.currentFile, state.unsavedChanges])

  // Load specific directory
  const loadDirectory = useCallback(
    async (dirPath: string): Promise<FileSystemItem[]> => {
      try {
        return await fileSystem.readDirectory(dirPath, false)
      } catch (error) {
        handleError(error, 'directory load')
        return []
      }
    },
    [handleError]
  )

  return {
    // State
    workspace: state.workspace,
    files: state.files,
    currentFile: state.currentFile,
    isLoading: state.isLoading,
    error: state.error,
    unsavedChanges: state.unsavedChanges,

    // Actions
    selectWorkspace,
    openWorkspace,
    refreshFiles,
    refreshOpenFileContents,
    openFile,
    saveFile,
    createFile,
    createFolder,
    deleteFile,
    setCurrentFile,
    markUnsaved,
    markSaved,
    hasUnsavedChanges,
    clearError,
    loadDirectory
  }
}

// Additional utility hooks

// Hook for file content management
export function useFileContent(filePath: string | null): {
  content: string
  setContent: (content: string) => void
  isLoading: boolean
  error: string | null
  reload: () => Promise<void>
} {
  const [content, setContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadContent = useCallback(async () => {
    if (!filePath) return

    setIsLoading(true)
    setError(null)

    try {
      const fileContent = await fileSystem.readFile(filePath)
      setContent(fileContent)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file')
    } finally {
      setIsLoading(false)
    }
  }, [filePath])

  useEffect(() => {
    loadContent()
  }, [loadContent])

  return {
    content,
    setContent,
    isLoading,
    error,
    reload: loadContent
  }
}

// Hook for file tree state management
export function useFileTree(files: FileSystemItem[]): {
  expandedFolders: Set<string>
  selectedFile: string | null
  setSelectedFile: (file: string | null) => void
  toggleFolder: (folderPath: string) => void
  isExpanded: (folderPath: string) => boolean
  expandAll: () => void
  collapseAll: () => void
} {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const toggleFolder = useCallback((folderPath: string) => {
    setExpandedFolders((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(folderPath)) {
        newSet.delete(folderPath)
      } else {
        newSet.add(folderPath)
      }
      return newSet
    })
  }, [])

  const isExpanded = useCallback(
    (folderPath: string): boolean => {
      return expandedFolders.has(folderPath)
    },
    [expandedFolders]
  )

  const expandAll = useCallback(() => {
    const allFolders = files.filter((file) => file.isDirectory).map((file) => file.path)
    setExpandedFolders(new Set(allFolders))
  }, [files])

  const collapseAll = useCallback(() => {
    setExpandedFolders(new Set())
  }, [])

  return {
    expandedFolders,
    selectedFile,
    setSelectedFile,
    toggleFolder,
    isExpanded,
    expandAll,
    collapseAll
  }
}
