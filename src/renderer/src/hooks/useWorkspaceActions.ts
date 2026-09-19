/**
 * Workspace-level file actions: open/refresh/close the workspace and start a
 * new file or folder at its root. Shared by the Files panel header and the
 * project menu on the header bar.
 */

import { closeProject, openFolder, refreshWorkspace } from '@renderer/commands/fileCommands'
import { notify as toast } from '@renderer/lib/notify'
import {
  BaseFileItem,
  setPanelOpen,
  startCreateItem,
  useAppDispatch,
  useAppSelector
} from '@renderer/redux'

export interface WorkspaceActions {
  openWorkspace: () => void
  refreshWorkspace: () => void
  closeWorkspace: () => void
  newFile: () => void
  newFolder: () => void
}

export function useWorkspaceActions(): WorkspaceActions {
  const workspace = useAppSelector((state) => state.file.workspace)
  const dispatch = useAppDispatch()

  const openWorkspace = (): void => {
    openFolder().catch((e) => {
      toast.error('Could not open folder', {
        description: e instanceof Error ? e.message : String(e)
      })
    })
  }

  // The new item's name is typed inline in the file tree, so make sure the
  // Files panel is showing when creation starts from elsewhere (the header).
  const newFolder = (): void => {
    if (!workspace) return
    dispatch(setPanelOpen({ panel: 'file', isOpen: true }))
    dispatch(
      startCreateItem({
        id: crypto.randomUUID(),
        parentId: 'root',
        name: null,
        path: workspace.path,
        type: 'folder',
        children: []
      } as BaseFileItem)
    )
  }

  const newFile = (): void => {
    if (!workspace) return
    dispatch(setPanelOpen({ panel: 'file', isOpen: true }))
    dispatch(
      startCreateItem({
        id: crypto.randomUUID(),
        name: null,
        path: workspace.path,
        type: 'file'
      } as BaseFileItem)
    )
  }

  return {
    openWorkspace,
    refreshWorkspace: () => {
      if (workspace) void refreshWorkspace(workspace)
    },
    closeWorkspace: closeProject,
    newFile,
    newFolder
  }
}
