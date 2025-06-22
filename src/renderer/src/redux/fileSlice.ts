import { createEntityAdapter, EntityState, PayloadAction } from '@reduxjs/toolkit'
import { createAppSlice } from './createAppSlice'

interface File {
  id: string
  name: string
  content: string
  modified: boolean
  createdAt: string
  updatedAt: string
}

export type FileSliceState = {
  status: 'idle' | 'loading' | 'failed'
  openFiles: EntityState<File, string>
}

const editorObjectAdapter = createEntityAdapter<File>()

const initialState: FileSliceState = {
  status: 'idle',
  openFiles: editorObjectAdapter.getInitialState()
}

export const fileSlice = createAppSlice({
  name: 'file',
  initialState,
  reducers: (create) => ({
    createNewFile: create.reducer((state, payload: PayloadAction<string>) => {
      const newFile: File = {
        id: crypto.randomUUID(),
        name: payload.payload,
        content: '',
        modified: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      state.openFiles = editorObjectAdapter.addOne(state.openFiles, newFile)
    }),
    openFile: create.reducer((state, payload: PayloadAction<File>) => {
      const file = payload.payload
      state.openFiles = editorObjectAdapter.upsertOne(state.openFiles, {
        ...file,
        updatedAt: new Date().toISOString()
      })
    })
  }),
  selectors: {
    selectOpenFiles: (state) => editorObjectAdapter.getSelectors().selectAll(state.openFiles)
  }
})

export const { createNewFile, openFile } = fileSlice.actions

export const { selectOpenFiles } = fileSlice.selectors
