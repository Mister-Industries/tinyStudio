import { createEntityAdapter, createSelector, EntityState, PayloadAction } from '@reduxjs/toolkit'
import { createAppSlice } from './createAppSlice'

export interface EditorFile {
  id: string
  name: string
  path?: string
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
      if (state.workspace) {
        state.workspace.root.push(payload.payload)
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
    }),
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
    })
  }),
  selectors: {
    selectOpenFiles: createSelector([(state) => state.openFiles], (openFiles) =>
      editorObjectAdapter.getSelectors().selectAll(openFiles)
    ),
    selectViewingFileId: (state) => state.viewingFileId,
    selectIsReadmeFile: (state, id: string) => state.openFiles.entities[id]?.name === 'README.md'
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
  cancelCreateItem
} = fileSlice.actions

export const { selectOpenFiles, selectViewingFileId } = fileSlice.selectors
