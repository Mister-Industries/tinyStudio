import { isElectron } from '@renderer/lib/utils'
import { Maximize, Minimize, Minus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './ui/Button'
import { Separator } from './ui/Separator'
import { ThemeToggle } from './ui/ThemeToggle'

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
          <p className="text-accent">Forge</p>
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
        {/* <UserMenu /> */}
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
