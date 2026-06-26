/**
 * FileExplorer Component
 * Main file explorer with tabs for file browser and source control
 */

import { Folder, Github } from 'lucide-react'
import React, { useState } from 'react'
import { FileExplorerContent } from './FileExplorerContent'
import { SourceControl } from './SourceControl'

// Tab types for file explorer navigation
export type FileExplorerTab = 'file-explorer' | 'source-control'

export function FileExplorer(): React.JSX.Element {
  const [openTab, setOpenTab] = useState<FileExplorerTab>('file-explorer')

  // Underline tab — the two tabs split the strip evenly and center their labels.
  const tab =
    "relative flex flex-1 items-center justify-center gap-[7px] py-[9px] text-xs font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text-body)] cursor-pointer data-[active=true]:text-[var(--text-strong)] after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-[1.5px] after:h-[2.5px] after:origin-bottom after:scale-x-0 after:rounded-t-[2px] after:bg-[var(--brand)] after:transition-transform after:content-[''] data-[active=true]:after:scale-x-100"

  return (
    // `group` enables the VS Code–style hover-reveal of the tree action icons.
    <div className="size-full flex flex-col bg-[var(--bg-raised)] group">
      {/* Tab Navigation */}
      <div className="flex items-stretch h-[36px] border-b-[1.5px] border-[var(--border-default)]">
        <button
          data-active={openTab === 'file-explorer'}
          className={tab}
          onClick={() => setOpenTab('file-explorer')}
        >
          <Folder size={15} />
          Files
        </button>
        <button
          data-active={openTab === 'source-control'}
          className={tab}
          onClick={() => setOpenTab('source-control')}
        >
          <Github size={15} />
          GitHub
        </button>
      </div>

      {/* Tab Content */}
      {openTab === 'file-explorer' && <FileExplorerContent />}
      {openTab === 'source-control' && <SourceControl />}
    </div>
  )
}
