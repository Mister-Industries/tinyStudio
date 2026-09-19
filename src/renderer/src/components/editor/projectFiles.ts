import { openFileItem, refreshWorkspace } from '@renderer/commands/fileCommands'
import { fileSystem } from '@renderer/lib/fileSystem'
import { selectOpenFiles, useAppSelector } from '@renderer/redux'
import type { BaseFileItem, EditorFile, Workspace } from '@renderer/redux/fileSlice'
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
 * Write a new file into the project root and refresh the tree so it shows up.
 * The Circuit and Visual views call this from their "Create" buttons; nothing
 * writes into a project without the user asking for it.
 */
export async function createProjectFile(
  workspace: Workspace,
  name: string,
  content: string
): Promise<void> {
  await fileSystem.writeFile(`${workspace.path}/${name}`, content)
  await refreshWorkspace(workspace)
}

/**
 * Keep a project file (circuit.json / visual.js) open as an editor buffer and
 * return it once loaded. Used by the full-window Circuit/Visual views so their
 * edits live in the same buffer model as code (saved on Ctrl+S / build).
 * Returns undefined while loading and when the file doesn't exist; the views
 * check for existence themselves and offer to create it.
 */
export function useProjectFile(name: string): EditorFile | undefined {
  const workspace = useAppSelector((s) => s.file.workspace)
  const openFiles = useAppSelector(selectOpenFiles)
  const file = openFiles.find((f) => f.name === name)
  const busy = useRef(false)

  useEffect(() => {
    if (file || !workspace || busy.current) return
    const item = findInTree(workspace.root, (i) => i.name === name)
    if (!item) return
    busy.current = true
    // Load as a hidden background buffer: the full-window view edits/saves
    // it, but it stays out of the Code tab bar until the user clicks the
    // in-view code button (which reveals it).
    openFileItem(item, { hidden: true }).finally(() => {
      busy.current = false
    })
  }, [file, workspace, name])

  return file
}
