import { OpenFileCommand, RefreshWorkspaceCommand } from '@renderer/commands/fileCommands'
import { fileSystem } from '@renderer/lib/fileSystem'
import { selectOpenFiles, useAppSelector } from '@renderer/redux'
import type { BaseFileItem, EditorFile } from '@renderer/redux/fileSlice'
import { useEffect, useRef } from 'react'

export function findInTree(
  items: BaseFileItem[],
  match: (i: BaseFileItem) => boolean
): BaseFileItem | null {
  for (const item of items) {
    if (item.type === 'file' && item.name && match(item)) return item
    if (item.children) {
      const found = findInTree(item.children, match)
      if (found) return found
    }
  }
  return null
}

/** Collect every file in the tree matching `match`, skipping noise folders. */
export function collectFiles(
  items: BaseFileItem[],
  match: (i: BaseFileItem) => boolean,
  out: BaseFileItem[] = []
): BaseFileItem[] {
  for (const item of items) {
    if (item.type === 'file' && item.name && match(item)) out.push(item)
    if (item.children && !['node_modules', '.git', 'dist'].includes(item.name ?? '')) {
      collectFiles(item.children, match, out)
    }
  }
  return out
}

/**
 * Ensure a project file (e.g. diagram.json / visual.js) is open as an editor
 * buffer, creating it from a default if it doesn't exist yet. Returns the open
 * file once ready. Used by the full-window Circuit/Visual views so their edits
 * live in the same buffer model as code (saved on Ctrl+S / build).
 */
export function useProjectFile(name: string, makeDefault?: () => string): EditorFile | undefined {
  const workspace = useAppSelector((s) => s.file.workspace)
  const openFiles = useAppSelector(selectOpenFiles)
  const file = openFiles.find((f) => f.name === name)
  const busy = useRef(false)

  useEffect(() => {
    if (file || !workspace || busy.current) return
    busy.current = true
    ;(async () => {
      try {
        let item = findInTree(workspace.root, (i) => i.name === name)
        if (!item && makeDefault) {
          const path = `${workspace.path}/${name}`
          await fileSystem.writeFile(path, makeDefault())
          await new RefreshWorkspaceCommand(workspace).execute()
          item = { id: crypto.randomUUID(), parentId: 'root', name, path, type: 'file' }
        }
        // Load as a hidden background buffer: the full-window view edits/saves
        // it, but it stays out of the Code tab bar until the user clicks the
        // in-view code button (which reveals it).
        if (item) await new OpenFileCommand(item, { hidden: true }).execute()
      } finally {
        busy.current = false
      }
    })()
  }, [file, workspace, name, makeDefault])

  return file
}
