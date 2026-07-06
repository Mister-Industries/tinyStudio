import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { notify as toast } from './lib/notify'
import { BackendPrompt } from './components/BackendPrompt'
import { LoadGitHubProjectCommand, OpenWorkspaceCommand } from './commands/fileCommands'
import { parseProjectRoute } from './lib/projectRouting'
import { DocsPanel } from './components/DocsPanel'
import { EditorPanel } from './components/EditorPanel'
import { ErrorBoundary } from './components/ErrorBoundary'
import { FileExplorer } from './components/FileExplorer'
import { Header } from './components/Header'
import { SerialMonitor } from './components/SerialMonitor'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './components/ui/Resizable'
import { getPanelGroupElement, type ImperativePanelHandle } from 'react-resizable-panels'
import { ArduinoProvider } from './contexts/ArduinoContext'
import { SerialProvider } from './contexts/SerialContext'
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

  // The serial monitor / output dock only makes sense while coding — close it
  // when switching to the full-window Circuit or Visual views, reopen on Code.
  useEffect(() => {
    dispatch(setPanelOpen({ panel: 'monitor', isOpen: editorView === 'code' }))
  }, [editorView, dispatch])

  // Cleanup Arduino service on unmount
  useEffect(() => {
    return () => {
      console.log('Cleaning up Arduino service on app unmount')
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
      new LoadGitHubProjectCommand(route.owner, route.repo, route.path).execute().catch((e) => {
        console.error('Failed to load project from URL:', e)
        toast.error('Could not open that project', {
          description: e instanceof Error ? e.message : String(e)
        })
      })
      return
    }

    const last = localStorage.getItem('tinystudio.lastWorkspace')
    if (!last) return
    fileSystem
      .pathExists(last)
      .then((exists) => {
        if (exists) {
          void new OpenWorkspaceCommand(last).execute()
        } else {
          localStorage.removeItem('tinystudio.lastWorkspace')
        }
      })
      .catch((e) => console.error('Failed to reopen last workspace:', e))
  }, [])

  // Honor browser back/forward between projects.
  useEffect(() => {
    const onPop = (): void => {
      const route = parseProjectRoute()
      if (route) {
        new LoadGitHubProjectCommand(route.owner, route.repo, route.path)
          .execute()
          .catch((e) => console.error('Failed to load project on navigation:', e))
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
        </div>
      </SerialProvider>
    </ArduinoProvider>
  )
}
