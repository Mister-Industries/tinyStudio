/**
 * FileExplorerContent Component
 * Main content area for the file explorer with workspace management
 */

import { useAppSelector } from '@renderer/redux'
import { Folder, FolderOpen, FolderPlus, FolderSync, Plus } from 'lucide-react'
import React from 'react'
import { Button } from '../ui/Button'
import { ScrollArea } from '../ui/ScrollArea'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'
import { CreateProjectDialog } from './CreateProjectDialog'

export function FileExplorerContent(): React.JSX.Element {
  const isLoading = false
  const workspace = useAppSelector((state) => state.file.workspace)

  const handleSelectWorkspace = (): void => {
    // Logic to select a workspace
  }

  const handleOpenWorkspace = (workspacePath: string): Promise<void> => {
    // Logic to open a workspace
    console.log(workspacePath)
    return Promise.resolve()
  }

  const handleRefreshWorkspace = (): void => {
    // Logic to refresh the workspace
  }

  const handleNewFolder = (): void => {
    // Logic to create a new folder
  }

  const handleNewFile = (): void => {
    // Logic to create a new file
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with workspace name and action buttons */}
      <div className="flex justify-between items-center px-4 py-3 text-xs font-semibold border-b border-border">
        <div className="flex items-center gap-2">
          <Folder size={14} />
          {workspace ? workspace.name.toUpperCase() : 'WORKSPACE'}
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
            </>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <ScrollArea className="flex-1">
        {!workspace ? (
          // No workspace state - show welcome screen
          <div className="flex flex-col items-center justify-center text-muted-foreground py-8 px-4 gap-2">
            <Folder size={48} className="mb-4 opacity-50" />
            <p className="text-sm mb-4 text-center">Open a folder to start working with files</p>
            <Button onClick={handleSelectWorkspace} className="w-40">
              Open Folder
              <FolderOpen size={14} />
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
          <></>
        )}
      </ScrollArea>
    </div>
  )
}
