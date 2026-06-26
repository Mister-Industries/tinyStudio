/**
 *
 * FileExplorerContent Component
 * Main content area for the file explorer with workspace management
 */

import {
  CloseWorkspaceCommand,
  OpenWorkspaceCommand,
  RefreshWorkspaceCommand
} from '@renderer/commands/fileCommands'
import { BaseFileItem, startCreateItem, useAppDispatch, useAppSelector } from '@renderer/redux'
import { Folder, FolderOpen, FolderPlus, FolderSync, FolderX, Plus } from 'lucide-react'
import React from 'react'
import { Button } from '../ui/Button'
import { ScrollArea } from '../ui/ScrollArea'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'
import { CreateProjectDialog } from './CreateProjectDialog'
import { FileTreeItem } from './FileTreeItem'

export function FileExplorerContent(): React.JSX.Element {
  const isLoading = false
  const workspace = useAppSelector((state) => state.file.workspace)
  const dispatch = useAppDispatch()

  const handleSelectWorkspace = (): void => {
    // Logic to select a workspace
    const command = new OpenWorkspaceCommand(undefined)
    command.execute()
  }

  const handleOpenWorkspace = (workspacePath: string): Promise<void> => {
    const command = new OpenWorkspaceCommand(workspacePath)
    command.execute()
    return Promise.resolve()
  }

  const handleRefreshWorkspace = (): void => {
    if (!workspace) return
    const command = new RefreshWorkspaceCommand(workspace)
    command.execute()
  }

  const handleCloseWorkspace = (): void => {
    const command = new CloseWorkspaceCommand()
    command.execute()
  }

  const handleNewFolder = (): void => {
    dispatch(
      startCreateItem({
        id: crypto.randomUUID(),
        parentId: 'root',
        name: null,
        path: workspace!.path,
        type: 'folder',
        children: []
      } as BaseFileItem)
    )
  }

  const handleNewFile = (): void => {
    dispatch(
      startCreateItem({
        id: crypto.randomUUID(),
        name: null,
        path: workspace!.path,
        type: 'file'
      } as BaseFileItem)
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with workspace name and (hover-revealed) action buttons */}
      <div className="relative flex justify-between items-center px-3 pt-2.5 pb-1.5">
        <span className="inline-flex items-center gap-1.5 min-w-0 font-sans text-[12.5px] font-bold tracking-[0.01em] text-[var(--text-body)]">
          <Folder size={14} className="shrink-0 text-[var(--text-faint)]" />
          <span className="truncate">
            {workspace ? workspace.name : 'No workspace selected'}
          </span>
        </span>
        {workspace && (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex gap-px pl-2 bg-[var(--bg-raised)] opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
          // No workspace — keep the sidebar minimal; the editor shows the
          // primary "Open Folder" call to action.
          <div className="flex flex-col items-center justify-center py-10 px-4 gap-2">
            <Button
              variant="secondary"
              onClick={handleSelectWorkspace}
              className="w-40 gap-1.5"
            >
              <FolderOpen size={15} /> Open Folder
            </Button>
            <CreateProjectDialog openWorkspace={handleOpenWorkspace} />
          </div>
        ) : isLoading ? (
          // Loading state
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          // File tree display
          // TODO map through the open files
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
