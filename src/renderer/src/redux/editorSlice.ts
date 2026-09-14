import { PayloadAction, createSelector } from '@reduxjs/toolkit'
import { createAppSlice } from './createAppSlice'

export type EditorView = 'code' | 'circuit' | 'visual'

// Which tab is active in the docs/examples/AI side panel.
export type DocsTab = 'readme' | 'examples' | 'ai'

// Project-level dialogs, which can be opened from anywhere (start screen, Files
// panel). Mounted once, in ProjectDialogs.
export type ProjectDialog = 'create' | 'open'

export type EditorSliceState = {
  status: 'idle' | 'loading' | 'failed'
  isFileExplorerOpen: boolean
  isSerialMonitorOpen: boolean
  isDocsPanelOpen: boolean
  // How the active file renders: 'code' shows the text editor; 'circuit' renders
  // diagram.json interactively; 'visual' runs a p5 sketch (.js). The toolbar
  // segment sets this and auto-focuses the matching file.
  editorView: EditorView
  // Starts on 'examples' when nothing is open yet; activateWorkspace() flips
  // this to 'readme' whenever a folder or example is opened.
  docsTab: DocsTab
  projectDialog: ProjectDialog | null
  // Bumped whenever something sends the user to the Examples tab, so the panel
  // flashes to show where they went. A counter, not a flag, so every click
  // flashes — including a second one while the tab is already showing.
  examplesFlash: number
  // Workspace path whose save-to-computer folder picker was cancelled. Save
  // stops opening it for that project; the banner still offers it.
  savePromptSnoozedFor: string | null
  // A browser-only project is being written out to a folder right now.
  savingToComputer: boolean
}

const initialState: EditorSliceState = {
  status: 'idle',
  isFileExplorerOpen: true,
  isSerialMonitorOpen: true,
  isDocsPanelOpen: true,
  editorView: 'code',
  docsTab: 'examples',
  projectDialog: null,
  examplesFlash: 0,
  savePromptSnoozedFor: null,
  savingToComputer: false
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
    setEditorView: create.reducer((state, payload: PayloadAction<EditorView>) => {
      state.editorView = payload.payload
    }),
    setDocsTab: create.reducer((state, payload: PayloadAction<DocsTab>) => {
      state.docsTab = payload.payload
    }),
    openProjectDialog: create.reducer((state, payload: PayloadAction<ProjectDialog>) => {
      state.projectDialog = payload.payload
    }),
    closeProjectDialog: create.reducer((state) => {
      state.projectDialog = null
    }),
    // Open the side panel on Examples and flash it.
    showExamples: create.reducer((state) => {
      state.isDocsPanelOpen = true
      state.docsTab = 'examples'
      state.examplesFlash += 1
    }),
    snoozeSavePrompt: create.reducer((state, payload: PayloadAction<string | null>) => {
      state.savePromptSnoozedFor = payload.payload
    }),
    setSavingToComputer: create.reducer((state, payload: PayloadAction<boolean>) => {
      state.savingToComputer = payload.payload
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
    selectEditorView: (state) => state.editorView,
    selectDocsTab: (state) => state.docsTab,
    selectProjectDialog: (state) => state.projectDialog,
    selectExamplesFlash: (state) => state.examplesFlash
  }
})

// Action creators are generated for each case reducer function.
export const {
  setPanelOpen,
  setEditorView,
  setDocsTab,
  openProjectDialog,
  closeProjectDialog,
  showExamples,
  snoozeSavePrompt,
  setSavingToComputer
} = editorSlice.actions

// Selectors returned by `slice.selectors` take the root state as their first argument.
export const {
  selectPanelState,
  selectEditorView,
  selectDocsTab,
  selectProjectDialog,
  selectExamplesFlash
} = editorSlice.selectors
