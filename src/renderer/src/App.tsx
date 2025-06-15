import { Button } from './components/ui/Button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './components/ui/Resizable'
import { ThemeToggle } from './components/ui/ThemeToggle'

function App(): React.JSX.Element {
  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <Header />
      <Toolbar />
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel defaultSize={15} minSize={10} maxSize={25} className="bg-muted">
          {/* <FileExplorer /> */}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={65} className="flex flex-col">
          <ResizablePanelGroup direction="vertical">
            <ResizablePanel defaultSize={70} className="flex flex-col">
              {/* <EditorPanel /> */}
            </ResizablePanel>

            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={30} minSize={15} className="bg-muted">
                {/* <SerialMonitor /> */}
              </ResizablePanel>
            </>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
          {/* <AIAssistant /> */}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
export default App

export function Header(): React.JSX.Element {
  return (
    <div className="h-fit w-full bg-background flex text-xs justify-between py-1 px-4">
      <div className="flex items-center gap-8">
        <h1 className="flex font-semibold text-lg">
          <p>tiny</p>
          <p className="text-accent">Studio</p>
        </h1>
        <p>by MR.INDUSTRIES</p>
      </div>
      <div className="flex items-center gap-4">
        {/* //TODO: link to documentation */}
        <Button variant="link" className="p-0">
          Help
        </Button>
        <ThemeToggle />
        {/* <UserMenu /> */}
      </div>
    </div>
  )
}

export function Toolbar(): React.JSX.Element {
  return <div className="px-4 py-3 flex items-center space-x-2 shadow-sm bg-primary">Toolbar</div>
}
