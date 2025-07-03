import { PayloadAction, createSelector } from '@reduxjs/toolkit'
import { createAppSlice } from './createAppSlice'

export type EditorSliceState = {
  status: 'idle' | 'loading' | 'failed'
  isFileExplorerOpen: boolean
  isSerialMonitorOpen: boolean
  isDocsPanelOpen: boolean
}

const initialState: EditorSliceState = {
  status: 'idle',
  isFileExplorerOpen: true,
  isSerialMonitorOpen: true,
  isDocsPanelOpen: true
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
    )
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
    )
  }
})

// Action creators are generated for each case reducer function.
export const { setPanelOpen } = editorSlice.actions

// Selectors returned by `slice.selectors` take the root state as their first argument.
export const { selectPanelState } = editorSlice.selectors
