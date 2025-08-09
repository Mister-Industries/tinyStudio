/**
 * FileExplorer Component (Legacy)
 *
 * This file has been refactored and split into multiple components for better maintainability.
 * The new components are located in the FileExplorer/ directory.
 *
 * This file now serves as a simple re-export to maintain backward compatibility.
 *
 * New structure:
 * - FileExplorer/FileExplorer.tsx - Main component with tabs
 * - FileExplorer/FileExplorerContent.tsx - File explorer content
 * - FileExplorer/FileTree.tsx - File tree display
 * - FileExplorer/FileTreeItem.tsx - Individual tree items
 * - FileExplorer/CreateProjectDialog.tsx - Project creation dialog
 * - FileExplorer/useFileTree.ts - Custom hook for tree logic
 * - FileExplorer/types.ts - Type definitions
 * - FileExplorer/utils.ts - Utility functions
 * - FileExplorer/schemas.ts - Validation schemas
 */

// Re-export the main components for backward compatibility
export { FileExplorer, FileExplorerContent, CreateProjectDialog } from './FileExplorer/index'
