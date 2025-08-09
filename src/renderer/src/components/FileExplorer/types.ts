/**
 * Type definitions for FileExplorer components
 * Contains interfaces for props and state objects used throughout the file explorer
 */

import { FileSystemItem } from '../../lib/fileSystem'

// File tree item component props
export interface FileTreeItemProps {
  item: FileSystemItem
  level: number
  isExpanded: boolean
  isSelected: boolean
  onToggle: () => void
  onSelect: () => void
  onContextMenu: (item: FileSystemItem) => void
  onCreateFile: (parentPath: string) => void
  onCreateFolder: (parentPath: string) => void
  onDeleteItem: (itemPath: string) => void
  onRenameItem: (itemPath: string) => void
  onConfirmCreate?: (parentPath: string, name: string, type: 'file' | 'folder') => void
  onCancelCreate?: () => void
  onConfirmRename?: (oldPath: string, newName: string) => void
  onCancelRename?: () => void
  isCreating?: boolean
  creationType?: 'file' | 'folder'
  isRenaming?: boolean
}

// File tree component props
export interface FileTreeProps {
  files: FileSystemItem[]
  onFileSelect: (filePath: string) => void
  selectedFile: string | null
  loadDirectory: (dirPath: string) => Promise<FileSystemItem[]>
  onCreateFile: (parentPath: string) => void
  onCreateFolder: (parentPath: string) => void
  onDeleteItem: (itemPath: string) => void
  refreshFiles: () => Promise<void>
  triggerRootFileCreation?: boolean
  onRootFileCreationComplete?: () => void
  triggerRootFolderCreation?: boolean
  onRootFolderCreationComplete?: () => void
  workspacePath?: string
}

// Extended tree node with additional properties for UI state
export interface TreeNode extends FileSystemItem {
  children?: TreeNode[]
  isLoaded?: boolean
  isCreating?: boolean
  creationType?: 'file' | 'folder'
  isRenaming?: boolean
}

// State for managing creation of new items
export interface CreatingItemState {
  parentPath: string
  type: 'file' | 'folder'
}

// Tab types for file explorer navigation
export type FileExplorerTab = 'file-explorer' | 'source-control'

// Create project dialog props
export interface CreateProjectDialogProps {
  openWorkspace: (workspacePath: string) => Promise<void>
}

// Project creation form data
export interface CreateProjectFormData {
  projectTitle: string
  projectLocation: string
}
