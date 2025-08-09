/**
 * useFileTree Hook
 * Manages file tree state, expansion, loading, and operations
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
import { FileSystemItem, fileSystem } from '../../lib/fileSystem'
import { TreeNode, CreatingItemState } from './types'

interface UseFileTreeProps {
  files: FileSystemItem[]
  workspacePath?: string
  triggerRootFileCreation?: boolean
  onRootFileCreationComplete?: () => void
  triggerRootFolderCreation?: boolean
  onRootFolderCreationComplete?: () => void
  loadDirectory: (dirPath: string) => Promise<FileSystemItem[]>
  onCreateFile: (filePath: string) => void
  onCreateFolder: (folderPath: string) => void
  refreshFiles: () => Promise<void>
}

export function useFileTree({
  files,
  workspacePath,
  triggerRootFileCreation = false,
  onRootFileCreationComplete,
  triggerRootFolderCreation = false,
  onRootFolderCreationComplete,
  loadDirectory,
  onCreateFile,
  onCreateFolder,
  refreshFiles
}: UseFileTreeProps): {
  tree: TreeNode[]
  expandedFolders: Set<string>
  isExpanded: (folderPath: string) => boolean
  toggleFolder: (folderPath: string) => Promise<void>
  handleStartCreate: (parentPath: string, type: 'file' | 'folder') => void
  handleConfirmCreate: (parentPath: string, name: string, type: 'file' | 'folder') => Promise<void>
  handleCancelCreate: () => void
  handleStartRename: (itemPath: string) => void
  handleConfirmRename: (oldPath: string, newName: string) => Promise<void>
  handleCancelRename: () => void
} {
  // State management
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [loadedDirectories, setLoadedDirectories] = useState<Map<string, FileSystemItem[]>>(
    new Map()
  )
  const [creatingItem, setCreatingItem] = useState<CreatingItemState | null>(null)
  const [renamingItemPath, setRenamingItemPath] = useState<string | null>(null)

  /**
   * Build hierarchical tree structure from flat file list
   */
  const tree = useMemo(() => {
    const buildTree = (items: FileSystemItem[], parentPath = ''): TreeNode[] => {
      const nodes: TreeNode[] = []

      // Sort items: directories first, then files alphabetically
      const sortedItems = [...items].sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      })

      for (const item of sortedItems) {
        const node: TreeNode = {
          ...item,
          children: item.isDirectory ? [] : undefined,
          isLoaded: !item.isDirectory || loadedDirectories.has(item.path),
          isRenaming: renamingItemPath === item.path
        }

        // If this directory is loaded, add its children recursively
        if (item.isDirectory && loadedDirectories.has(item.path)) {
          const children = loadedDirectories.get(item.path) || []
          node.children = buildTree(children, item.path)
        }

        nodes.push(node)
      }

      // Add creating item if it belongs to this level
      if (
        creatingItem &&
        (creatingItem.parentPath === parentPath ||
          (parentPath === '' && creatingItem.parentPath === workspacePath))
      ) {
        const creatingNode: TreeNode = {
          name: '',
          path: `${creatingItem.parentPath}`,
          isDirectory: creatingItem.type === 'folder',
          size: 0,
          lastModified: Date.now(),
          isCreating: true,
          creationType: creatingItem.type
        }

        if (creatingItem.type === 'folder') {
          // Insert folder in alphabetical position among other directories
          const dirIndex = nodes.findIndex((n) => !n.isDirectory)
          if (dirIndex === -1) {
            nodes.push(creatingNode)
          } else {
            nodes.splice(dirIndex, 0, creatingNode)
          }
        } else {
          // Insert file at the end
          nodes.push(creatingNode)
        }
      }

      return nodes
    }

    return buildTree(files)
  }, [files, loadedDirectories, creatingItem, workspacePath, renamingItemPath])

  /**
   * Auto-expand folders that were previously expanded when files change
   */
  useEffect(() => {
    const expandPreviouslyExpandedFolders = async (): Promise<void> => {
      const foldersToExpand = Array.from(expandedFolders)

      for (const folderPath of foldersToExpand) {
        // Check if this folder still exists in the current file list
        const folderExists = files.some((file) => file.path === folderPath && file.isDirectory)

        if (folderExists && !loadedDirectories.has(folderPath)) {
          try {
            const children = await loadDirectory(folderPath)
            setLoadedDirectories((prev) => new Map(prev).set(folderPath, children))
          } catch (error) {
            console.error('Failed to reload directory:', folderPath, error)
            // Remove from expanded folders if it can't be loaded
            setExpandedFolders((prev) => {
              const newSet = new Set(prev)
              newSet.delete(folderPath)
              return newSet
            })
          }
        }
      }
    }

    expandPreviouslyExpandedFolders()
  }, [files, expandedFolders, loadedDirectories, loadDirectory])

  /**
   * Toggle folder expansion state and load directory contents if needed
   */
  const toggleFolder = useCallback(
    async (folderPath: string) => {
      const isExpanded = expandedFolders.has(folderPath)

      if (isExpanded) {
        // Collapse folder
        setExpandedFolders((prev) => {
          const newSet = new Set(prev)
          newSet.delete(folderPath)
          return newSet
        })
      } else {
        // Expand folder
        setExpandedFolders((prev) => new Set(prev).add(folderPath))

        // Load directory contents if not already loaded
        if (!loadedDirectories.has(folderPath)) {
          try {
            const children = await loadDirectory(folderPath)
            setLoadedDirectories((prev) => new Map(prev).set(folderPath, children))
          } catch (error) {
            console.error('Failed to load directory:', error)
          }
        }
      }
    },
    [expandedFolders, loadedDirectories, loadDirectory]
  )

  /**
   * Check if a folder is currently expanded
   */
  const isExpanded = useCallback(
    (folderPath: string) => {
      return expandedFolders.has(folderPath)
    },
    [expandedFolders]
  )

  /**
   * Start creating a new file or folder
   */
  const handleStartCreate = useCallback(
    (parentPath: string, type: 'file' | 'folder') => {
      setCreatingItem({ parentPath, type })
      // Auto-expand the parent folder if it's not expanded
      if (!expandedFolders.has(parentPath)) {
        setExpandedFolders((prev) => new Set(prev).add(parentPath))
      }
    },
    [expandedFolders]
  )

  // Handle root file creation trigger
  useEffect(() => {
    if (triggerRootFileCreation && workspacePath) {
      handleStartCreate(workspacePath, 'file')
      onRootFileCreationComplete?.()
    }
  }, [triggerRootFileCreation, workspacePath, handleStartCreate, onRootFileCreationComplete])

  // Handle root folder creation trigger
  useEffect(() => {
    if (triggerRootFolderCreation && workspacePath) {
      handleStartCreate(workspacePath, 'folder')
      onRootFolderCreationComplete?.()
    }
  }, [triggerRootFolderCreation, workspacePath, handleStartCreate, onRootFolderCreationComplete])

  /**
   * Confirm creation of new file or folder
   */
  const handleConfirmCreate = useCallback(
    async (parentPath: string, name: string, type: 'file' | 'folder') => {
      if (!name.trim()) return

      setCreatingItem(null)

      const fullPath = fileSystem.joinPath(parentPath, name)

      if (type === 'file') {
        onCreateFile(fullPath)
      } else {
        onCreateFolder(fullPath)
      }
    },
    [onCreateFile, onCreateFolder]
  )

  /**
   * Cancel creation process
   */
  const handleCancelCreate = useCallback(() => {
    setCreatingItem(null)
  }, [])

  /**
   * Start renaming an item
   */
  const handleStartRename = useCallback((itemPath: string) => {
    setRenamingItemPath(itemPath)
  }, [])

  /**
   * Confirm renaming of an item
   */
  const handleConfirmRename = useCallback(
    async (oldPath: string, newName: string) => {
      if (!newName.trim()) return

      setRenamingItemPath(null)

      const parentPath = fileSystem.getDirectoryPath(oldPath)
      const newPath = fileSystem.joinPath(parentPath, newName)

      try {
        const stats = await fileSystem.getFileStats(oldPath)
        if (stats.isDirectory) {
          // For directories, show an informative message for now
          alert(
            'Folder renaming is not yet fully implemented. Please use your file manager to rename folders.'
          )
          return
        } else {
          // For files: read content, create new file, delete old file
          const content = await fileSystem.readFile(oldPath)
          await fileSystem.createFile(newPath, content)
          await fileSystem.deleteFile(oldPath)
        }

        // Call the parent's refresh to update the file list
        await refreshFiles()
      } catch (err) {
        console.error('Failed to rename item:', err)
        alert(`Failed to rename item: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    },
    [refreshFiles]
  )

  /**
   * Cancel renaming process
   */
  const handleCancelRename = useCallback(() => {
    setRenamingItemPath(null)
  }, [])

  return {
    tree,
    expandedFolders,
    isExpanded,
    toggleFolder,
    handleStartCreate,
    handleConfirmCreate,
    handleCancelCreate,
    handleStartRename,
    handleConfirmRename,
    handleCancelRename
  }
}
