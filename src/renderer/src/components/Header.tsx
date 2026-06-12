import { isElectron } from '@renderer/lib/utils'
import { selectOpenFiles, useAppSelector } from '@renderer/redux'
import { ChevronRight, Maximize, Minimize, Minus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './ui/Button'

export function Header(): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)
  const workspace = useAppSelector((state) => state.file.workspace)
  const openFiles = useAppSelector(selectOpenFiles)
  const viewingFileId = useAppSelector((state) => state.file.viewingFileId)
  const viewingFile = openFiles.find((f) => f.id === viewingFileId)

  useEffect(() => {
    if (!isElectron()) return

    const handleMaximized = (): void => setIsMaximized(true)
    const handleUnmaximized = (): void => setIsMaximized(false)

    window.electron.ipcRenderer.on('window:maximized', handleMaximized)
    window.electron.ipcRenderer.on('window:unmaximized', handleUnmaximized)

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
      className="h-10 w-full shrink-0 bg-navy-900 border-b border-navy-600 flex items-center justify-between"
      style={isElectron() ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : {}}
    >
      <div className="flex items-center gap-2 pl-4 min-w-0">
        <h1 className="flex text-[15px] font-bold tracking-tight select-none">
          <span className="text-fg-1">tiny</span>
          <span className="tf-gradient-text">Studio</span>
        </h1>
        {workspace && (
          <div className="flex items-center gap-1 min-w-0 text-xs">
            <ChevronRight size={14} className="text-fg-4 shrink-0" />
            <span className="font-semibold text-fg-2 truncate">{workspace.name}</span>
            {viewingFile && <span className="text-fg-3 truncate">/ {viewingFile.name}</span>}
          </div>
        )}
        {!workspace && <span className="text-xs text-fg-3 pl-1">by MR.INDUSTRIES</span>}
      </div>
      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {isElectron() && (
          <div className="h-full flex items-center">
            <Button
              variant="ghost"
              className="p-0 rounded-none h-full w-10 text-fg-3 hover:text-fg-1 hover:bg-navy-500"
              title="Minimize"
              onClick={handleMinimize}
            >
              <Minus size={12} />
            </Button>
            <Button
              variant="ghost"
              className="p-0 rounded-none h-full w-10 text-fg-3 hover:text-fg-1 hover:bg-navy-500"
              onClick={handleMaximize}
              title={isMaximized ? 'Restore' : 'Maximize'}
            >
              {isMaximized ? <Minimize size={12} /> : <Maximize size={12} />}
            </Button>
            <Button
              variant="destructiveGhost"
              className="p-0 rounded-none h-full w-10 text-fg-3 hover:text-fg-1"
              title="Close"
              onClick={handleClose}
            >
              <X size={12} />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
