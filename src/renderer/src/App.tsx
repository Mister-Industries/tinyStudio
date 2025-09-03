import { useState } from 'react'
import { DocsPanel } from './components/DocsPanel'
import { EditorPanel } from './components/EditorPanel'
import { FileExplorer } from './components/FileExplorer'
import { Header } from './components/Header'
import { SerialMonitor } from './components/SerialMonitor'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './components/ui/Resizable'
import { selectPanelState, useAppSelector } from './redux'

export default function App(): React.JSX.Element {
  const { isFileExplorerOpen, isSerialMonitorOpen, isDocsPanelOpen } =
    useAppSelector(selectPanelState)
  const [editorSize, setEditorSize] = useState(50)

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <Header />
      <Toolbar />
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {isFileExplorerOpen && (
          <>
            <ResizablePanel defaultSize={20} minSize={5} maxSize={40} className="bg-muted">
              <FileExplorer />
            </ResizablePanel>
            <ResizableHandle />
          </>
        )}
        <ResizablePanel defaultSize={55} className="flex flex-col">
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
  )
}
