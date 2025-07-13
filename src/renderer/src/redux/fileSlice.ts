import { createEntityAdapter, EntityState, PayloadAction, createSelector } from '@reduxjs/toolkit'
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

export type FileSliceState = {
  status: 'idle' | 'loading' | 'failed'
  openProjects: string[]
  openFiles: EntityState<EditorFile, string>
  viewingFileId: string | null
}

const editorObjectAdapter = createEntityAdapter<EditorFile>()

const initialState: FileSliceState = {
  status: 'idle',
  openProjects: [],
  openFiles: editorObjectAdapter.getInitialState(),
  viewingFileId: null
}

export const fileSlice = createAppSlice({
  name: 'file',
  initialState,
  reducers: (create) => ({
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
    selectViewingFile: createSelector(
      [(state) => state.openFiles, (state) => state.viewingFileId],
      (openFiles, viewingFileId) => {
        if (!viewingFileId) return null
        return editorObjectAdapter.getSelectors().selectById(openFiles, viewingFileId) || null
      }
    ),
    selectViewingFileId: (state) => state.viewingFileId
  }
})

export const { createNewFile, openFile, updateFileContent, saveFile, closeFile, setViewingFile } =
  fileSlice.actions

export const { selectOpenFiles, selectViewingFile, selectViewingFileId } = fileSlice.selectors
