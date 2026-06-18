import { PayloadAction, createSelector } from '@reduxjs/toolkit'
import { createAppSlice } from './createAppSlice'

export type EditorView = 'code' | 'circuit' | 'visual'

export type EditorSliceState = {
  status: 'idle' | 'loading' | 'failed'
  isFileExplorerOpen: boolean
  isSerialMonitorOpen: boolean
  isDocsPanelOpen: boolean
  editorMode: 'code' | 'blocks'
  // How the active file renders: 'code' shows the text editor; 'circuit' renders
  // diagram.json interactively; 'visual' runs a p5 sketch (.js). The toolbar
  // segment sets this and auto-focuses the matching file.
  editorView: EditorView
}

const initialState: EditorSliceState = {
  status: 'idle',
  isFileExplorerOpen: true,
  isSerialMonitorOpen: false,
  isDocsPanelOpen: false,
  editorMode: 'code',
  editorView: 'code'
}

// If you are not using async thunks you can use the standalone `createSlice`.
export const editorSlice = createAppSlice({
  name: 'editor',
  initialState,
  reducers: (create) => ({
    // Reducer example
    setPanelOpen: create.reducer(
      (state, payload: PayloadAction<{ panel: 'file' | 'monitor' | 'docs'; isOpen: boolean }>) => {
        state.status = 'idle'
        switch (payload.payload.panel) {
          case 'file':
            state.isFileExplorerOpen = payload.payload.isOpen
            break
          case 'monitor':
            state.isSerialMonitorOpen = payload.payload.isOpen
            break
          case 'docs':
            state.isDocsPanelOpen = payload.payload.isOpen
            break
        }
      }
    ),
    setEditorMode: create.reducer((state, payload: PayloadAction<'code' | 'blocks'>) => {
      state.editorMode = payload.payload
    }),
    setEditorView: create.reducer((state, payload: PayloadAction<EditorView>) => {
      state.editorView = payload.payload
    })
  }),
  selectors: {
    selectPanelState: createSelector(
      [
        (state) => state.isFileExplorerOpen,
        (state) => state.isSerialMonitorOpen,
        (state) => state.isDocsPanelOpen
      ],
      (isFileExplorerOpen, isSerialMonitorOpen, isDocsPanelOpen) => ({
        isFileExplorerOpen,
        isSerialMonitorOpen,
        isDocsPanelOpen
      })
    ),
    selectEditorView: (state) => state.editorView
  }
})

// Action creators are generated for each case reducer function.
export const { setPanelOpen, setEditorMode, setEditorView } = editorSlice.actions

// Selectors returned by `slice.selectors` take the root state as their first argument.
export const { selectPanelState, selectEditorView } = editorSlice.selectors
