/**
 * ViewSegment — the Code / Circuit / Visual switch in the toolbar.
 *
 * These are full-window views (like the desktop app), not per-tab modes:
 *   Code    → the normal tabbed editor IDE
 *   Circuit → full-window interactive diagram.json
 *   Visual  → full-window running visual.js (with an Edit-code button)
 * Each view loads the file it needs on its own; this just flips editorView and,
 * for Code, makes sure a sketch is open to land on.
 */

import { OpenFileCommand } from '@renderer/commands/fileCommands'
import {
  BaseFileItem,
  selectEditorView,
  selectOpenFiles,
  setEditorView,
  setViewingFile,
  useAppDispatch,
  useAppSelector,
  type EditorView
} from '@renderer/redux'
import { CircuitBoard, Code2, Play } from 'lucide-react'
import React from 'react'

function findInTree(items: BaseFileItem[], match: (i: BaseFileItem) => boolean): BaseFileItem | null {
  for (const item of items) {
    if (item.type === 'file' && item.name && match(item)) return item
    if (item.children) {
      const found = findInTree(item.children, match)
      if (found) return found
    }
  }
  return null
}

export function ViewSegment(): React.JSX.Element {
  const dispatch = useAppDispatch()
  const editorView = useAppSelector(selectEditorView)
  const openFiles = useAppSelector(selectOpenFiles)
  const workspace = useAppSelector((state) => state.file.workspace)

  const go = (view: EditorView): void => {
    if (view === 'code') {
      // Land on a code file: focus the .ino (open it if needed), else any open file.
      const openIno = openFiles.find((f) => /\.ino$/i.test(f.name))
      if (openIno) {
        dispatch(setViewingFile(openIno.id))
      } else if (workspace) {
        const item =
          findInTree(workspace.root, (i) => /\.ino$/i.test(i.name!)) ||
          findInTree(workspace.root, (i) => /\.(cpp|c|h|hpp)$/i.test(i.name!))
        if (item) new OpenFileCommand(item).execute()
      }
    }
    dispatch(setEditorView(view))
  }

  const btn = (view: EditorView, label: string, Icon: typeof Code2): React.JSX.Element => (
    <button
      onClick={() => go(view)}
      data-active={editorView === view}
      className="h-7 px-3 flex items-center gap-1.5 rounded-[var(--radius-sm)] text-[13px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-body)] transition-colors data-[active=true]:bg-[var(--surface-card)] data-[active=true]:text-[var(--text-strong)] data-[active=true]:shadow-[var(--shadow-soft-sm)]"
    >
      <Icon size={15} />
      {label}
    </button>
  )

  return (
    <div className="flex items-center gap-0.5 p-[3px] rounded-[var(--radius-md)] bg-[var(--bg-sunken)] border-[1.5px] border-[var(--border-soft)]">
      {btn('code', 'Code', Code2)}
      {btn('circuit', 'Circuit', CircuitBoard)}
      {btn('visual', 'Visual', Play)}
    </div>
  )
}
