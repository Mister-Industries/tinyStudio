import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { reportError } from './lib/notify'
import { BackendPrompt } from './components/BackendPrompt'
import { loadGitHubProject, openRecentFolder, openFolder } from './commands/fileCommands'
import { listRecentProjects } from './lib/projectStore'
import { STORAGE_KEYS } from './lib/storageKeys'
import { parseProjectRoute } from './lib/projectRouting'
import { serveStudioRequests } from './lib/studioBridge'
import { DocsPanel } from './components/DocsPanel'
import { EditorPanel } from './components/EditorPanel'
import { ErrorBoundary } from './components/ErrorBoundary'
import { FileExplorer } from './components/FileExplorer'
import { Header } from './components/Header'
import { ProjectDialogs } from './components/ProjectDialogs'
import { SerialMonitor } from './components/SerialMonitor'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './components/ui/Resizable'
import { getPanelGroupElement, type ImperativePanelHandle } from 'react-resizable-panels'
import { ArduinoProvider } from './contexts/ArduinoProvider'
import { SerialProvider } from './contexts/SerialProvider'
import { fileSystem } from './lib/fileSystem'
import {
  selectEditorView,
  selectPanelState,
  setPanelOpen,
  useAppDispatch,
  useAppSelector
} from './redux'
import { ArduinoServiceFactory } from './services/arduino/ArduinoServiceFactory'

export default function App(): React.JSX.Element {
  const { isFileExplorerOpen, isSerialMonitorOpen, isDocsPanelOpen } =
    useAppSelector(selectPanelState)
  const editorView = useAppSelector(selectEditorView)
  // A boolean, not the workspace itself: a file-tree refresh swaps the object,
  // and that mustn't re-open a monitor the user closed.
  const hasWorkspace = useAppSelector((state) => state.file.workspace !== null)
  const dispatch = useAppDispatch()
  const [editorSize, setEditorSize] = useState(50)

  // The Files panel starts at the width of the toolbar divider (the rule
  // between the Upload/Save group and the board/port group). That position is
  // content-driven, so we measure it at runtime and size the panel to match.
  const filePanelRef = useRef<ImperativePanelHandle>(null)
  // once the user drags the divider we honor their width; until then we align to
  // the toolbar divider. Either way the width is re-asserted after panel toggles
  // (react-resizable-panels would otherwise redistribute it).
  const manualFilePct = useRef<number | null>(null)
  const applyFilePanelWidth = useCallback((): void => {
    const panel = filePanelRef.current
    if (!panel) return
    if (manualFilePct.current != null) {
      panel.resize(manualFilePct.current)
      return
    }
    const divider = document.querySelector('[data-toolbar-divider]')
    const group = getPanelGroupElement('workspace-cols')
    if (!divider || !group) return
    const groupRect = group.getBoundingClientRect()
    if (groupRect.width === 0) return
    const target = divider.getBoundingClientRect().left - groupRect.left
    const pct = (target / groupRect.width) * 100
    panel.resize(Math.max(8, Math.min(40, pct)))
  }, [])

  useLayoutEffect(() => {
    if (!isFileExplorerOpen) return
    applyFilePanelWidth()
    // re-measure once web fonts settle (button widths shift the divider)
    document.fonts?.ready?.then(applyFilePanelWidth).catch(() => {})
    window.addEventListener('resize', applyFilePanelWidth)
    return () => window.removeEventListener('resize', applyFilePanelWidth)
  }, [isFileExplorerOpen, applyFilePanelWidth])

  // Re-assert the left panel width whenever the right (docs) or bottom (serial)
  // panel toggles, so those don't shove the Files panel around.
  useLayoutEffect(() => {
    if (!isFileExplorerOpen) return
    const id = requestAnimationFrame(applyFilePanelWidth)
    return () => cancelAnimationFrame(id)
  }, [isDocsPanelOpen, isSerialMonitorOpen, isFileExplorerOpen, applyFilePanelWidth])

  // The serial monitor / output dock only makes sense while coding a project —
  // close it for the full-window Circuit or Visual views and when nothing is
  // open (the start screen gets the whole column), reopen on Code once a
  // project is.
  useEffect(() => {
    dispatch(setPanelOpen({ panel: 'monitor', isOpen: editorView === 'code' && hasWorkspace }))
  }, [editorView, hasWorkspace, dispatch])

  // Desktop: Studio AI runs in the main process, but the parts registry and the
  // serial buffer its tools read live here (lib/studioBridge).
  useEffect(() => serveStudioRequests(), [])

  // Cleanup Arduino service on unmount
  useEffect(() => {
    return () => {
      ArduinoServiceFactory.cleanup()
    }
  }, [])

  // The "backend not reachable" messaging now lives in <BackendPrompt/> (a
  // persistent, actionable banner with the start command) rather than a transient
  // toast, so compile/upload/serial don't appear to fail silently.

  // On launch, a `/<owner>/<repo>/<path>` deep link opens that GitHub project and
  // takes precedence over reopening the last local workspace. Otherwise, reopen
  // the last workspace (if it still exists on disk).
  //
  // Guard against running twice — StrictMode double-invokes effects in dev, and a
  // second open rebuilds the tree with new ids, which previously opened a
  // duplicate tab for the auto-opened sketch.
  const reopenedRef = useRef(false)
  useEffect(() => {
    if (reopenedRef.current) return
    reopenedRef.current = true

    const route = parseProjectRoute()
    if (route) {
      loadGitHubProject(route.owner, route.repo, route.path).catch((e) =>
        reportError('Could not open that project', e)
      )
      return
    }

    const last = localStorage.getItem(STORAGE_KEYS.lastWorkspace)
    if (!last) return
    if (!fileSystem.isElectron()) {
      // Browser: a folder only comes back through its stored handle, and only
      // while access is still granted. Asking again needs a click, so otherwise
      // it waits under Recent on the start screen.
      const entry = listRecentProjects().find((r) => r.kind === 'folder' && r.location === last)
      if (entry) {
        openRecentFolder(entry, { prompt: false }).catch((e) =>
          console.warn('Could not reopen the last folder at launch:', e)
        )
      }
      return
    }
    Promise.all([fileSystem.pathExists(last), window.api.fs.hasAccess(last)])
      .then(([exists, allowed]) => {
        if (!exists) localStorage.removeItem(STORAGE_KEYS.lastWorkspace)
        // A folder from before access was tracked waits under Recent until it's chosen again.
        else if (allowed) void openFolder(last)
      })
      .catch((e) => console.warn('Could not reopen the last workspace at launch:', e))
  }, [])

  // Honor browser back/forward between projects.
  useEffect(() => {
    const onPop = (): void => {
      const route = parseProjectRoute()
      if (route) {
        loadGitHubProject(route.owner, route.repo, route.path).catch((e) =>
          reportError('Could not open that project', e)
        )
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  return (
    <ArduinoProvider>
      <SerialProvider>
        <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
          <Header />
          <Toolbar />
          <ResizablePanelGroup id="workspace-cols" direction="horizontal" className="flex-1">
            {isFileExplorerOpen && (
              <>
                <ResizablePanel
                  ref={filePanelRef}
                  defaultSize={16}
                  minSize={8}
                  maxSize={40}
                  className="bg-muted"
                >
                  <FileExplorer />
                </ResizablePanel>
                <ResizableHandle
                  onDragging={(dragging) => {
                    if (!dragging)
                      manualFilePct.current =
                        filePanelRef.current?.getSize() ?? manualFilePct.current
                  }}
                />
              </>
            )}
            <ResizablePanel defaultSize={50} className="flex flex-col">
              <ResizablePanelGroup direction="vertical">
                <ResizablePanel
                  defaultSize={70}
                  className="flex flex-col"
                  onResize={(size) => setEditorSize(size)}
                >
                  <EditorPanel size={editorSize} />
                </ResizablePanel>
                {isSerialMonitorOpen && (
                  <>
                    <ResizableHandle />
                    <ResizablePanel defaultSize={30} minSize={15} className="bg-muted">
                      <SerialMonitor />
                    </ResizablePanel>
                  </>
                )}
              </ResizablePanelGroup>
            </ResizablePanel>
            {isDocsPanelOpen && (
              <>
                <ResizableHandle />
                <ResizablePanel defaultSize={25} minSize={25} maxSize={40}>
                  <ErrorBoundary label="Documentation panel">
                    <DocsPanel />
                  </ErrorBoundary>
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
          <StatusBar />
          <BackendPrompt />
          <ProjectDialogs />
        </div>
      </SerialProvider>
    </ArduinoProvider>
  )
}
