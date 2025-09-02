/**
 * FileExplorer Component
 * Main file explorer with tabs for file browser and source control
 */

import { Construction, Folder, GitBranch } from 'lucide-react'
import React, { useState } from 'react'
import { FileExplorerContent } from './FileExplorerContent'

// Tab types for file explorer navigation
export type FileExplorerTab = 'file-explorer' | 'source-control'

export function FileExplorer(): React.JSX.Element {
  const [openTab, setOpenTab] = useState<FileExplorerTab>('file-explorer')

  return (
    <div className="size-full flex flex-col">
      {/* Tab Navigation */}
      <div className="flex w-full text-xs font-semibold border-b-2 border-border">
        {/* File Explorer Tab */}
        <div
          data-active={openTab === 'file-explorer'}
          className="flex justify-center items-center gap-2 border-b-2 border-transparent flex-1 px-2 py-4 data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:border-accent cursor-pointer"
          onClick={() => setOpenTab('file-explorer')}
        >
          <Folder size={14} />
          File Explorer
        </div>
        {/* Source Control Tab */}
        <div
          data-active={openTab === 'source-control'}
          className="flex justify-center items-center gap-2 border-b-2 border-transparent flex-1 px-2 py-4 data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:border-accent cursor-pointer"
          onClick={() => setOpenTab('source-control')}
        >
          <GitBranch size={14} />
          Source Control
        </div>
      </div>

      {/* Tab Content */}
      {openTab === 'file-explorer' && <FileExplorerContent />}
      {openTab === 'source-control' && (
        <div className="flex-1 flex flex-col gap-2 items-center text-muted-foreground">
          {/* Source Control Header */}
          <div className="flex w-full justify-between items-center px-4 py-3 text-xs font-semibold border-b border-border">
            <div className="flex items-center gap-2">
              <GitBranch size={14} />
              SOURCE CONTROL
            </div>
          </div>
          {/* Under Construction Message */}
          <div className="flex flex-col items-center justify-center text-muted-foreground py-8 px-4 gap-2">
            <Construction size={48} className="mb-4 opacity-50" />
            <p className="text-sm mb-4 text-center">Source Control is under construction</p>
          </div>
        </div>
      )}
    </div>
  )
}
