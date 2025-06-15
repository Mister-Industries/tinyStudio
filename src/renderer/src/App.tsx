import {
  BookOpen,
  FolderOpen,
  GraduationCap,
  Maximize,
  Minimize,
  Minus,
  Settings,
  X
} from 'lucide-react'
import { Button } from './components/ui/Button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './components/ui/Resizable'
import { ThemeToggle } from './components/ui/ThemeToggle'
import { isElectron } from './lib/utils'
import { Separator } from './components/ui/Separator'

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

import React, { useEffect, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from './components/ui/Avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './components/ui/DropdownMenu'

export function Header(): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (!isElectron()) return

    const handleMaximized = (): void => setIsMaximized(true)
    const handleUnmaximized = (): void => setIsMaximized(false)

    window.electron.ipcRenderer.on('window:maximized', handleMaximized)
    window.electron.ipcRenderer.on('window:unmaximized', handleUnmaximized)

    // Optionally, request current state on mount
    window.electron.ipcRenderer.invoke?.('window:getIsMaximized')?.then(setIsMaximized)

    return () => {
      window.electron.ipcRenderer.removeListener('window:maximized', handleMaximized)
      window.electron.ipcRenderer.removeListener('window:unmaximized', handleUnmaximized)
    }
  }, [])

  const handleMinimize = (): void => window.electron.ipcRenderer.send('window:minimize')
  const handleMaximize = (): void => window.electron.ipcRenderer.send('window:maximize')
  const handleClose = (): void => window.electron.ipcRenderer.send('window:close')

  return (
    <div
      className="h-fit w-full bg-background flex text-xs justify-between"
      style={isElectron() ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : {}}
    >
      <div className="flex items-center gap-8 pl-4">
        <h1 className="flex font-semibold text-lg">
          <p>tiny</p>
          <p className="text-accent">Studio</p>
        </h1>
        <p>by MR.INDUSTRIES</p>
      </div>
      <div
        className="flex items-center gap-4"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* //TODO: link to documentation */}
        <Button variant="link" className="p-0">
          Help
        </Button>
        <ThemeToggle />
        <UserMenu />
        {isElectron() && (
          <div className="h-full flex">
            <Separator orientation="vertical" className="h-6 w-px bg-border" />
            <div>
              <Button
                variant="ghost"
                className="p-0 rounded-none"
                title="Minimize"
                onClick={handleMinimize}
              >
                <Minus size={12} />
              </Button>
              <Button
                variant="ghost"
                className="p-0 rounded-none"
                onClick={handleMaximize}
                title={isMaximized ? 'Restore' : 'Maximize'}
              >
                {/* Show Square if maximized, Maximize if not */}
                {isMaximized ? <Minimize size={12} /> : <Maximize size={12} />}
              </Button>
              <Button
                variant="destructiveGhost"
                className="p-0 rounded-none"
                title="Close"
                onClick={handleClose}
              >
                <X size={12} />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function Toolbar(): React.JSX.Element {
  return <div className="px-4 py-3 flex items-center space-x-2 shadow-sm bg-primary">Toolbar</div>
}

export function UserMenu(): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Avatar>
          <AvatarImage src="https://github.com/shadcn.png" />
          <AvatarFallback>EE</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem className="group">
          <FolderOpen
            size={14}
            className="mr-2 transition-none text-muted-foreground group-focus:text-accent-foreground transition-colors"
          />
          My Projects
        </DropdownMenuItem>
        <DropdownMenuItem className="group">
          <BookOpen
            size={14}
            className="mr-2 transition-none text-muted-foreground group-focus:text-accent-foreground transition-colors"
          />
          My Tutorials
        </DropdownMenuItem>
        <DropdownMenuItem className="group">
          <GraduationCap
            size={14}
            className="mr-2 transition-none text-muted-foreground group-focus:text-accent-foreground transition-colors"
          />
          My Courses
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="group">
          <Settings
            size={14}
            className="mr-2 transition-none text-muted-foreground group-focus:text-accent-foreground transition-colors"
          />
          Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
