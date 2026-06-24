import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { OpenWorkspaceCommand } from './commands/fileCommands'
import { DocsPanel } from './components/DocsPanel'
import { EditorPanel } from './components/EditorPanel'
import { FileExplorer } from './components/FileExplorer'
import { Header } from './components/Header'
import { SerialMonitor } from './components/SerialMonitor'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './components/ui/Resizable'
import { ArduinoProvider } from './contexts/ArduinoContext'
import { SerialProvider } from './contexts/SerialContext'
import { fileSystem } from './lib/fileSystem'
import { selectEditorView, selectPanelState, setPanelOpen, useAppDispatch, useAppSelector } from './redux'
import { ArduinoServiceFactory, getArduinoService } from './services/arduino/ArduinoServiceFactory'

export default function App(): React.JSX.Element {
  const { isFileExplorerOpen, isSerialMonitorOpen, isDocsPanelOpen } =
    useAppSelector(selectPanelState)
  const editorView = useAppSelector(selectEditorView)
  const dispatch = useAppDispatch()
  const [editorSize, setEditorSize] = useState(50)

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

  // Surface a clear message when the tinyService backend isn't reachable, instead
  // of letting compile/upload/serial fail silently. On desktop the app starts
  // tinyService for you; in the browser the user runs it themselves — either way,
  // if nothing is listening on the service URL we say so.
  useEffect(() => {
    const service = getArduinoService()
    let warned = false

    const warnIfDown = (): void => {
      if (service.isConnected() || warned) return
      warned = true
      toast.error('Arduino backend not running', {
        description:
          'Compile, upload, and the serial monitor need tinyService. Start it and it will reconnect automatically.',
        duration: 8000
      })
    }

    // Give the initial connection a few seconds before complaining.
    const graceTimer = setTimeout(warnIfDown, 5000)

    const off = service.onConnectionChange((connected) => {
      if (connected) {
        if (warned) toast.success('Arduino backend connected')
        warned = false
      } else {
        warnIfDown()
      }
    })

    return () => {
      clearTimeout(graceTimer)
      off()
    }
  }, [])

  // Reopen the last workspace on launch (if it still exists on disk).
  // Guard against running twice — StrictMode double-invokes effects in dev,
  // and a second OpenWorkspaceCommand rebuilds the tree with new ids, which
  // previously opened a duplicate tab for the auto-opened sketch.
  const reopenedRef = useRef(false)
  useEffect(() => {
    if (reopenedRef.current) return
    reopenedRef.current = true
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

  return (
    <ArduinoProvider>
      <SerialProvider>
      <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
        <Header />
        <Toolbar />
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {isFileExplorerOpen && (
            <>
              <ResizablePanel defaultSize={25} minSize={12} maxSize={40} className="bg-muted">
                <FileExplorer />
              </ResizablePanel>
              <ResizableHandle />
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
                <DocsPanel />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
        <StatusBar />
      </div>
      </SerialProvider>
    </ArduinoProvider>
  )
}
