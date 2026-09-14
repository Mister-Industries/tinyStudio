/**
 *
 * FileExplorerContent Component
 * Main content area for the file explorer with workspace management
 */

import { useWorkspaceActions } from '@renderer/hooks/useWorkspaceActions'
import { useAppSelector } from '@renderer/redux'
import { Folder, FolderOpen, FolderPlus, FolderSync, FolderX, Plus } from 'lucide-react'
import React from 'react'
import { Button } from '../ui/Button'
import { ScrollArea } from '../ui/ScrollArea'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'
import { FileTreeItem } from './FileTreeItem'

export function FileExplorerContent(): React.JSX.Element {
  const isLoading = false
  const workspace = useAppSelector((state) => state.file.workspace)
  const {
    openWorkspace: handleSelectWorkspace,
    refreshWorkspace: handleRefreshWorkspace,
    closeWorkspace: handleCloseWorkspace,
    newFolder: handleNewFolder,
    newFile: handleNewFile
  } = useWorkspaceActions()

  return (
    <div className="h-full flex flex-col">
      {/* Header with workspace name and (hover-revealed) action buttons */}
      <div className="group/dir relative flex justify-between items-center px-3 pt-2.5 pb-1.5">
        <span className="inline-flex items-center gap-1.5 min-w-0 font-sans text-[12.5px] font-bold tracking-[0.01em] text-[var(--text-body)]">
          <Folder size={14} className="shrink-0 text-[var(--text-faint)]" />
          <span className="truncate">{workspace ? workspace.name : 'No project open'}</span>
        </span>
        {workspace && (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex gap-px pl-2 bg-[var(--bg-raised)] opacity-0 transition-opacity group-hover/dir:opacity-100 focus-within:opacity-100">
            {/* Refresh Files Button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-[var(--text-muted)] hover:text-[var(--text-strong)]"
                  onClick={handleRefreshWorkspace}
                >
                  <FolderSync size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh files</TooltipContent>
            </Tooltip>
            {/* New Folder Button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-[var(--text-muted)] hover:text-[var(--text-strong)]"
                  onClick={handleNewFolder}
                >
                  <FolderPlus size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New folder</TooltipContent>
            </Tooltip>
            {/* New File Button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-[var(--text-muted)] hover:text-[var(--text-strong)]"
                  onClick={handleNewFile}
                >
                  <Plus size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New file</TooltipContent>
            </Tooltip>
            {/* Open a Different Folder Button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-[var(--text-muted)] hover:text-[var(--text-strong)]"
                  onClick={handleSelectWorkspace}
                >
                  <FolderOpen size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open a different folder</TooltipContent>
            </Tooltip>
            {/* Close Workspace Button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-[var(--text-muted)] hover:text-[var(--text-strong)]"
                  onClick={handleCloseWorkspace}
                >
                  <FolderX size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Close workspace</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <ScrollArea className="flex-1">
        {!workspace ? (
          // No project: creating and opening live on the start screen and in
          // the tinyStudio menu, so this panel only says so.
          <div className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">
            No project open
          </div>
        ) : isLoading ? (
          // Loading state
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          // File tree display
          <div className="px-2 py-1">
            {workspace.root.map((item) => (
              <FileTreeItem key={item.id} item={item} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
