/**
 * ViewSegment — the Code / Circuit / Visual switch in the toolbar.
 *
 * Files stay normal, rearrangeable tabs; this segment is a shortcut that opens
 * and focuses the matching file and sets how it renders:
 *   Code    → the project's main .ino (or current code file), shown as text
 *   Circuit → diagram.json, shown as the interactive circuit editor
 *   Visual  → visual.js, shown as a running p5 sketch
 * The active button is derived from whatever file is currently in view.
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
import { Code2, CircuitBoard, Play } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'

function findInTree(items: BaseFileItem[], match: (i: BaseFileItem) => boolean): BaseFileItem | null {
  for (const item of items) {
    if (item.type === 'file' && match(item)) return item
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
  const viewingFileId = useAppSelector((state) => state.file.viewingFileId)
  const viewingFile = openFiles.find((f) => f.id === viewingFileId)

  // Derive the active button from the file in view + the render mode.
  const activeView: EditorView = viewingFile
    ? viewingFile.name === 'diagram.json'
      ? 'circuit'
      : /\.js$/i.test(viewingFile.name) && editorView === 'visual'
        ? 'visual'
        : 'code'
    : editorView

  // Open a workspace file by predicate: focus it if already open, else load it.
  const focusFile = (match: (name: string) => boolean): boolean => {
    const open = openFiles.find((f) => match(f.name))
    if (open) {
      dispatch(setViewingFile(open.id))
      return true
    }
    if (workspace) {
      const item = findInTree(workspace.root, (i) => !!i.name && match(i.name))
      if (item) {
        new OpenFileCommand(item).execute()
        return true
      }
    }
    return false
  }

  const go = (view: EditorView): void => {
    dispatch(setEditorView(view))
    if (view === 'code') {
      // Prefer the main sketch; fall back to any code file already open.
      if (!focusFile((n) => /\.ino$/i.test(n)))
        focusFile((n) => /\.(cpp|c|h|hpp)$/i.test(n))
    } else if (view === 'circuit') {
      if (!focusFile((n) => n === 'diagram.json'))
        toast.info('No diagram.json in this project yet')
    } else if (view === 'visual') {
      if (!focusFile((n) => /\.js$/i.test(n)))
        toast.info('No visual.js sketch in this project yet')
    }
  }

  const btn = (view: EditorView, label: string, Icon: typeof Code2): React.JSX.Element => (
    <button
      onClick={() => go(view)}
      data-active={activeView === view}
      className="h-7 px-3 flex items-center gap-1.5 rounded-full text-xs font-medium text-fg-3 hover:text-fg-1 transition-colors data-[active=true]:bg-cyan data-[active=true]:text-[var(--fg-on-cyan)]"
    >
      <Icon size={14} />
      {label}
    </button>
  )

  return (
    <div className="flex items-center gap-1 p-1 rounded-full bg-navy-900 border border-navy-600">
      {btn('code', 'Code', Code2)}
      {btn('circuit', 'Circuit', CircuitBoard)}
      {btn('visual', 'Visual', Play)}
    </div>
  )
}
