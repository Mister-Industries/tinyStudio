import { createEntityAdapter, createSelector, EntityState, PayloadAction } from '@reduxjs/toolkit'
import { createAppSlice } from './createAppSlice'

export interface EditorFile {
  id: string
  name: string
  path: string
  content: string
  modified: boolean
  createdAt: string
  updatedAt: string
}

export interface Workspace {
  id: string
  name: string
  path: string
  root: BaseFileItem[]
}

export interface BaseFileItem {
  id: string
  parentId: string
  name: string | null
  path: string
  type: 'file' | 'folder'
  children?: BaseFileItem[]
}

export type FileSliceState = {
  status: 'idle' | 'loading' | 'failed'
  openProjects: string[]
  workspace: Workspace | null
  expandedDirectoryIds: string[]
  highlightedFileId: string | null
  openFiles: EntityState<EditorFile, string>
  viewingFileId: string | null
  readmeContent?: string
}

const editorObjectAdapter = createEntityAdapter<EditorFile>()

const initialState: FileSliceState = {
  status: 'idle',
  openProjects: [],
  workspace: null,
  expandedDirectoryIds: [],
  highlightedFileId: null,
  openFiles: editorObjectAdapter.getInitialState(),
  viewingFileId: null
}

export const fileSlice = createAppSlice({
  name: 'file',
  initialState,
  reducers: (create) => ({
    openWorkspace: create.reducer((state, payload: PayloadAction<Workspace>) => {
      state.workspace = payload.payload
    }),
    startCreateItem: create.reducer((state, payload: PayloadAction<BaseFileItem>) => {
      if (!state.workspace) return

      const item = payload.payload
      state.highlightedFileId = null

      // If parentId matches workspace id, add to root
      if (item.parentId === 'root') {
        state.workspace.root.push(item)
        return
      }

      // Find parent by parentId in the tree
      const findParentById = (items: BaseFileItem[]): BaseFileItem | null => {
        for (const currentItem of items) {
          if (currentItem.id === item.parentId) {
            return currentItem
          }
          if (currentItem.children) {
            const found = findParentById(currentItem.children)
            if (found) return found
          }
        }
        return null
      }

      const parent = findParentById(state.workspace.root)
      if (parent && parent.type === 'folder') {
        if (!parent.children) {
          parent.children = []
        }
        parent.children.push(item)
      } else {
        // Fallback: if parent not found by ID, try to find by path
        const parentPath = item.path.substring(0, item.path.lastIndexOf('/'))

        const findParentByPath = (items: BaseFileItem[]): BaseFileItem | null => {
          for (const currentItem of items) {
            if (currentItem.type === 'folder' && currentItem.path === parentPath) {
              return currentItem
            }
            if (currentItem.children) {
              const found = findParentByPath(currentItem.children)
              if (found) return found
            }
          }
          return null
        }

        const parentByPath = findParentByPath(state.workspace.root)
        if (parentByPath) {
          if (!parentByPath.children) {
            parentByPath.children = []
          }
          parentByPath.children.push(item)
        } else {
          // Final fallback: add to root
          state.workspace.root.push(item)
        }
      }
    }),
    finishCreateItem: create.reducer((state, payload: PayloadAction<BaseFileItem>) => {
      if (state.workspace) {
        const findAndReplace = (items: BaseFileItem[]): boolean => {
          for (let i = 0; i < items.length; i++) {
            if (items[i].id === payload.payload.id) {
              items[i] = payload.payload
              return true
            }
            if (items[i].children && findAndReplace(items[i].children!)) {
              return true
            }
          }
          return false
        }
        findAndReplace(state.workspace.root)
      }
    }),
    cancelCreateItem: create.reducer((state, payload: PayloadAction<string>) => {
      if (state.workspace) {
        const findAndRemove = (items: BaseFileItem[]): boolean => {
          for (let i = 0; i < items.length; i++) {
            if (items[i].id === payload.payload) {
              items.splice(i, 1)
              return true
            }
            if (items[i].children && findAndRemove(items[i].children!)) {
              return true
            }
          }
          return false
        }
        findAndRemove(state.workspace.root)
      }
    }),

    createNewFile: create.reducer((state, payload: PayloadAction<string>) => {
      const newFile: EditorFile = {
        id: crypto.randomUUID(),
        name: payload.payload,
        content: '',
        path: `${state.workspace!.path}/${payload.payload}`,
        modified: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      state.openFiles = editorObjectAdapter.addOne(state.openFiles, newFile)
    }),
    openFile: create.reducer((state, payload: PayloadAction<EditorFile>) => {
      const file = payload.payload
      state.openFiles = editorObjectAdapter.upsertOne(state.openFiles, {
        ...file,
        updatedAt: new Date().toISOString()
      })
      // Automatically set this file as the viewing file
      state.viewingFileId = file.id
      state.highlightedFileId = file.id
    }),
    setFolderOpen: create.reducer(
      (state, payload: PayloadAction<{ id: string; isOpen: boolean }>) => {
        const { id, isOpen } = payload.payload
        if (isOpen && !state.expandedDirectoryIds.includes(id)) {
          state.expandedDirectoryIds.push(id)
        } else if (!isOpen) {
          state.expandedDirectoryIds = state.expandedDirectoryIds.filter(
            (folderId) => folderId !== id
          )
        }
      }
    ),
    updateFileContent: create.reducer(
      (state, payload: PayloadAction<{ id: string; content: string }>) => {
        const { id, content } = payload.payload
        const existingFile = state.openFiles.entities[id]
        if (existingFile) {
          state.openFiles = editorObjectAdapter.updateOne(state.openFiles, {
            id,
            changes: {
              content,
              modified: content !== existingFile.content,
              updatedAt: new Date().toISOString()
            }
          })
        }
      }
    ),
    updateReadmeContent: create.reducer((state, payload: PayloadAction<string>) => {
      state.readmeContent = payload.payload
    }),
    refreshFileContentFromDisk: create.reducer(
      (state, payload: PayloadAction<{ id: string; content: string }>) => {
        const { id, content } = payload.payload
        const existingFile = state.openFiles.entities[id]
        if (existingFile) {
          state.openFiles = editorObjectAdapter.updateOne(state.openFiles, {
            id,
            changes: {
              content,
              // Don't mark as modified when refreshing from disk - the disk version is the "saved" version
              modified: false,
              updatedAt: new Date().toISOString()
            }
          })
        }
      }
    ),
    saveFile: create.reducer((state, payload: PayloadAction<string>) => {
      const fileId = payload.payload
      const existingFile = state.openFiles.entities[fileId]
      if (existingFile) {
        state.openFiles = editorObjectAdapter.updateOne(state.openFiles, {
          id: fileId,
          changes: {
            modified: false,
            updatedAt: new Date().toISOString()
          }
        })
      }
    }),
    saveFileWithContent: create.reducer(
      (state, payload: PayloadAction<{ id: string; content: string }>) => {
        const { id, content } = payload.payload
        const existingFile = state.openFiles.entities[id]
        if (existingFile) {
          state.openFiles = editorObjectAdapter.updateOne(state.openFiles, {
            id,
            changes: {
              content,
              modified: false,
              updatedAt: new Date().toISOString()
            }
          })
        }
      }
    ),
    closeFile: create.reducer((state, payload: PayloadAction<string>) => {
      const fileId = payload.payload
      state.openFiles = editorObjectAdapter.removeOne(state.openFiles, fileId)

      // If the closed file was the viewing file, switch to another file or null
      if (state.viewingFileId === fileId) {
        const remainingFiles = editorObjectAdapter.getSelectors().selectAll(state.openFiles)
        state.viewingFileId = remainingFiles.length > 0 ? remainingFiles[0].id : null
      }
    }),
    setViewingFile: create.reducer((state, payload: PayloadAction<string | null>) => {
      state.viewingFileId = payload.payload
      state.highlightedFileId = payload.payload

      // If highlighting a file, expand all parent directories
      if (payload.payload && state.workspace) {
        const findFileInTree = (items: BaseFileItem[], targetId: string): BaseFileItem | null => {
          for (const item of items) {
            if (item.id === targetId) {
              return item
            }
            if (item.children) {
              const found = findFileInTree(item.children, targetId)
              if (found) return found
            }
          }
          return null
        }

        const collectParentIds = (
          items: BaseFileItem[],
          targetId: string,
          parentIds: string[] = []
        ): string[] => {
          for (const item of items) {
            if (item.id === targetId) {
              return parentIds
            }
            if (item.children) {
              const found = collectParentIds(item.children, targetId, [...parentIds, item.id])
              if (found.length > parentIds.length) {
                return found
              }
            }
          }
          return []
        }

        const highlightedFile = findFileInTree(state.workspace.root, payload.payload)
        if (highlightedFile) {
          const parentIds = collectParentIds(state.workspace.root, payload.payload)

          // Add parent directory IDs to expandedDirectoryIds if not already present
          for (const parentId of parentIds) {
            if (!state.expandedDirectoryIds.includes(parentId)) {
              state.expandedDirectoryIds.push(parentId)
            }
          }
        }
      }
    })
  }),
  selectors: {
    selectOpenFiles: createSelector([(state) => state.openFiles], (openFiles) =>
      editorObjectAdapter.getSelectors().selectAll(openFiles)
    ),
    selectViewingFileId: (state) => state.viewingFileId,
    selectIsReadmeFile: (state, id: string) => state.openFiles.entities[id]?.name === 'README.md',
    selectIsExpanded: (state, id: string) => state.expandedDirectoryIds.includes(id)
  }
})

export const {
  createNewFile,
  openFile,
  updateFileContent,
  updateReadmeContent,
  refreshFileContentFromDisk,
  saveFile,
  saveFileWithContent,
  closeFile,
  setViewingFile,
  openWorkspace,
  startCreateItem,
  finishCreateItem,
  cancelCreateItem,
  setFolderOpen
} = fileSlice.actions

export const { selectOpenFiles, selectViewingFileId, selectIsExpanded } = fileSlice.selectors
