/**
 * FileTree Component
 * Displays a hierarchical file tree with support for creation, deletion, and navigation
 */

import React, { useCallback } from 'react'
import { Folder } from 'lucide-react'
import { FileTreeItem } from './FileTreeItem'
import { FileTreeProps, TreeNode } from './types'
import { useFileTree } from './useFileTree'

export function FileTree({
  files,
  onFileSelect,
  selectedFile,
  loadDirectory,
  onCreateFile,
  onCreateFolder,
  onDeleteItem,
  refreshFiles,
  triggerRootFileCreation = false,
  onRootFileCreationComplete,
  triggerRootFolderCreation = false,
  onRootFolderCreationComplete,
  workspacePath
}: FileTreeProps): React.JSX.Element {
  // Use custom hook for file tree logic
  const {
    tree,
    isExpanded,
    toggleFolder,
    handleStartCreate,
    handleConfirmCreate,
    handleCancelCreate,
    handleStartRename,
    handleConfirmRename,
    handleCancelRename
  } = useFileTree({
    files,
    workspacePath,
    triggerRootFileCreation,
    onRootFileCreationComplete,
    triggerRootFolderCreation,
    onRootFolderCreationComplete,
    loadDirectory,
    onCreateFile,
    onCreateFolder,
    refreshFiles
  })

  /**
   * Recursively render tree items with proper nesting
   */
  const renderTreeItems = useCallback(
    (nodes: TreeNode[], level = 0): React.ReactNode => {
      return nodes.map((node) => {
        const isSelected = selectedFile === node.path
        const expanded = isExpanded(node.path)

        return (
          <div key={node.path}>
            <FileTreeItem
              item={node}
              level={level}
              isExpanded={expanded}
              isSelected={isSelected}
              onToggle={() => node.isDirectory && toggleFolder(node.path)}
              onSelect={() => !node.isDirectory && onFileSelect(node.path)}
              onContextMenu={(contextItem) => {
                // Log context menu interaction for debugging
                console.log('Context menu for:', contextItem.name)
              }}
              onCreateFile={(parentPath) => handleStartCreate(parentPath, 'file')}
              onCreateFolder={(parentPath) => handleStartCreate(parentPath, 'folder')}
              onDeleteItem={onDeleteItem}
              onRenameItem={handleStartRename}
              onConfirmCreate={handleConfirmCreate}
              onCancelCreate={handleCancelCreate}
              onConfirmRename={handleConfirmRename}
              onCancelRename={handleCancelRename}
              isCreating={node.isCreating}
              creationType={node.creationType}
              isRenaming={node.isRenaming}
            />
            {/* Recursively render children if directory is expanded */}
            {node.isDirectory && expanded && node.children && (
              <div>{renderTreeItems(node.children, level + 1)}</div>
            )}
          </div>
        )
      })
    },
    [
      selectedFile,
      isExpanded,
      toggleFolder,
      onFileSelect,
      handleStartCreate,
      onDeleteItem,
      handleConfirmCreate,
      handleCancelCreate,
      handleStartRename,
      handleConfirmRename,
      handleCancelRename
    ]
  )

  // Show empty state if no files
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-muted-foreground py-8 px-4">
        <Folder size={48} className="mb-4 opacity-50" />
        <p className="text-sm mb-4 text-center">No files in workspace</p>
      </div>
    )
  }

  return <div className="py-2">{renderTreeItems(tree)}</div>
}
