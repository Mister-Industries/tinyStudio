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
      {/* Header with workspace name and action buttons */}
      <div className="flex justify-between items-center px-4 py-3 text-[11px] font-semibold tracking-[0.16em] text-fg-3 border-b border-navy-600">
        <div className="flex items-center gap-2 min-w-0">
          <Folder size={14} className="shrink-0" />
          <span className="truncate">
            {workspace ? workspace.name.toUpperCase() : 'NO WORKSPACE SELECTED'}
          </span>
        </div>
        <div className="flex gap-1">
          {workspace && (
            <>
              {/* Refresh Files Button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-4"
                    onClick={handleRefreshWorkspace}
                  >
                    <FolderSync size={12} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh files</TooltipContent>
              </Tooltip>
              {/* New Folder Button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-4" onClick={handleNewFolder}>
                    <FolderPlus size={12} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>New folder</TooltipContent>
              </Tooltip>
              {/* New File Button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-4" onClick={handleNewFile}>
                    <Plus size={12} />
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
                    className="size-4"
                    onClick={handleSelectWorkspace}
                  >
                    <FolderOpen size={12} />
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
                    className="size-4"
                    onClick={handleCloseWorkspace}
                  >
                    <FolderX size={12} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Close workspace</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <ScrollArea className="flex-1">
        {!workspace ? (
          // No workspace — keep the sidebar minimal; the editor shows the
          // primary "Open Folder" call to action.
          <div className="flex flex-col items-center justify-center text-fg-4 py-10 px-4 gap-3 text-center">
            <Folder size={32} className="opacity-50" />
            <p className="text-xs">No workspace selected</p>
            <Button variant="outline" size="sm" onClick={handleSelectWorkspace} className="gap-1.5">
              <FolderOpen size={14} /> Open Folder
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
          <>
            {workspace.root.map((item) => (
              <FileTreeItem key={item.id} item={item} />
            ))}
          </>
        )}
      </ScrollArea>
    </div>
  )
}
