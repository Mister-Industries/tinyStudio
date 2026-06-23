/**
 * FileExplorer Module Exports
 * Main entry point for the FileExplorer component and related utilities
 */

// Main component
export { FileExplorer } from './FileExplorer'

// Sub-components (exported for potential reuse)
export { CreateProjectDialog } from './CreateProjectDialog'
export { FileExplorerContent } from './FileExplorerContent'
export { FileTreeItem } from './FileTreeItem'

// Schemas
export { createProjectSchema } from './schemas'

// Utilities
export { createDefaultProjectFiles, getFileIconType, getRandomProjectPlaceholder } from './utils'
