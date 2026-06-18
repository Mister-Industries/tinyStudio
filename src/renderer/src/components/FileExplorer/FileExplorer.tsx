/**
 * FileExplorer Component
 * Main file explorer with tabs for file browser and source control
 */

import { Folder, GitBranch } from 'lucide-react'
import React, { useState } from 'react'
import { FileExplorerContent } from './FileExplorerContent'
import { SourceControl } from './SourceControl'

// Tab types for file explorer navigation
export type FileExplorerTab = 'file-explorer' | 'source-control'

export function FileExplorer(): React.JSX.Element {
  const [openTab, setOpenTab] = useState<FileExplorerTab>('file-explorer')

  return (
    <div className="size-full flex flex-col bg-navy-700">
      {/* Tab Navigation */}
      <div className="flex w-full text-xs font-semibold border-b border-navy-600">
        <button
          data-active={openTab === 'file-explorer'}
          className="flex justify-center items-center gap-2 border-b-2 border-transparent flex-1 px-2 py-3 text-fg-3 data-[active=true]:text-fg-1 data-[active=true]:border-cyan hover:text-fg-1 cursor-pointer transition-colors"
          onClick={() => setOpenTab('file-explorer')}
        >
          <Folder size={14} />
          Files
        </button>
        <button
          data-active={openTab === 'source-control'}
          className="flex justify-center items-center gap-2 border-b-2 border-transparent flex-1 px-2 py-3 text-fg-3 data-[active=true]:text-fg-1 data-[active=true]:border-cyan hover:text-fg-1 cursor-pointer transition-colors"
          onClick={() => setOpenTab('source-control')}
        >
          <GitBranch size={14} />
          Source Control
        </button>
      </div>

      {/* Tab Content */}
      {openTab === 'file-explorer' && <FileExplorerContent />}
      {openTab === 'source-control' && <SourceControl />}
    </div>
  )
}
