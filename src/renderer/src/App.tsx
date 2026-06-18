import { useEffect, useState } from 'react'
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
import { fileSystem } from './lib/fileSystem'
import { selectPanelState, useAppSelector } from './redux'
import { ArduinoServiceFactory } from './services/arduino/ArduinoServiceFactory'

export default function App(): React.JSX.Element {
  const { isFileExplorerOpen, isSerialMonitorOpen, isDocsPanelOpen } =
    useAppSelector(selectPanelState)
  const [editorSize, setEditorSize] = useState(50)

  // Cleanup Arduino service on unmount
  useEffect(() => {
    return () => {
      console.log('Cleaning up Arduino service on app unmount')
      ArduinoServiceFactory.cleanup()
    }
  }, [])

  // Reopen the last workspace on launch (if it still exists on disk).
  useEffect(() => {
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
    </ArduinoProvider>
  )
}
