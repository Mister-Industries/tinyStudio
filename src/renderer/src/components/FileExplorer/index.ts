/**
 * FileExplorer Module Exports
 * Main entry point for the FileExplorer component and related utilities
 */

// Main component
export { FileExplorer } from './FileExplorer'

// Sub-components (exported for potential reuse)
export { FileTree } from './FileTree'
export { FileTreeItem } from './FileTreeItem'
export { FileExplorerContent } from './FileExplorerContent'
export { CreateProjectDialog } from './CreateProjectDialog'

// Hooks
export { useFileTree } from './useFileTree'

// Types and schemas
export type {
  FileTreeProps,
  FileTreeItemProps,
  TreeNode,
  CreatingItemState,
  FileExplorerTab,
  CreateProjectDialogProps,
  CreateProjectFormData
} from './types'

export { createProjectSchema } from './schemas'

// Utilities
export { getFileIconType, createDefaultProjectFiles, getRandomProjectPlaceholder } from './utils'
