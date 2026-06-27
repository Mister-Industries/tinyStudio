import { isElectron } from '@renderer/lib/utils'
import { selectOpenFiles, useAppSelector } from '@renderer/redux'
import { useTheme } from '@renderer/lib/ThemeProvider'
import { ChevronRight, Maximize, Minimize, Minus, Moon, Sun, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './ui/Button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/Tooltip'
import { GitHubAccountButton } from './GitHubAccountButton'

/**
 * Top bar (38px). Brand wordmark + breadcrumb on the left; theme toggle, GitHub
 * account, and (on Electron) window controls on the right.
 *
 * Theme-aware per the design system: in LIGHT mode the bar is the blue brand
 * color with a white wordmark; in DARK mode it's the raised grey surface with
 * the wordmark's "Studio" in brand blue. Inset controls flip with it.
 */
export function Header(): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)
  const workspace = useAppSelector((state) => state.file.workspace)
  const openFiles = useAppSelector(selectOpenFiles)
  const viewingFileId = useAppSelector((state) => state.file.viewingFileId)
  const viewingFile = openFiles.find((f) => f.id === viewingFileId)
  const { theme, setTheme } = useTheme()
  const isDark = theme === 'dark'

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

  // Inset controls: white-on-blue in light, muted-on-grey in dark.
  const insetBtn =
    'text-white/80 hover:text-white hover:bg-white/15 dark:text-[var(--text-muted)] dark:hover:text-[var(--text-strong)] dark:hover:bg-[var(--bg-sunken)]'

  return (
    <div
      className="h-[38px] w-full shrink-0 flex items-center justify-between bg-[var(--brand)] shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.18)] dark:bg-[var(--bg-raised)] dark:border-b dark:border-[var(--border-default)] dark:shadow-none"
      style={isElectron() ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : {}}
    >
      <div className="flex items-center gap-2 pl-3 min-w-0">
        <h1 className="text-[15px] font-extrabold tracking-[-0.02em] select-none text-white dark:text-[var(--brand)]">
          <span className="font-medium text-white/70 dark:text-[var(--text-muted)]">tiny</span>Studio
        </h1>
        {workspace && (
          <div className="flex items-center gap-2 min-w-0">
            <ChevronRight size={13} className="text-white/55 dark:text-[var(--text-faint)] shrink-0" />
            <span className="text-[13px] text-white/[0.78] dark:text-[var(--text-muted)] truncate">
              {workspace.name}
            </span>
            {viewingFile && (
              <>
                <span className="text-[13px] text-white/45 dark:text-[var(--text-faint)]">/</span>
                <span className="text-[13px] font-semibold text-white dark:text-[var(--text-body)] truncate">
                  {viewingFile.name}
                </span>
              </>
            )}
          </div>
        )}
        {!workspace && (
          <span className="text-[13px] text-white/70 dark:text-[var(--text-muted)] pl-1">
            by MR.INDUSTRIES
          </span>
        )}
      </div>
      <div
        className="flex items-center gap-1.5 h-full pr-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`size-7 ${insetBtn}`}
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
            >
              {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{isDark ? 'Light mode' : 'Dark mode'}</TooltipContent>
        </Tooltip>
        <GitHubAccountButton />
        {isElectron() && (
          <div className="h-full flex items-center">
            <Button
              variant="ghost"
              className={`p-0 rounded-none h-full w-10 ${insetBtn}`}
              title="Minimize"
              onClick={handleMinimize}
            >
              <Minus size={12} />
            </Button>
            <Button
              variant="ghost"
              className={`p-0 rounded-none h-full w-10 ${insetBtn}`}
              onClick={handleMaximize}
              title={isMaximized ? 'Restore' : 'Maximize'}
            >
              {isMaximized ? <Minimize size={12} /> : <Maximize size={12} />}
            </Button>
            <Button
              variant="ghost"
              className="p-0 rounded-none h-full w-10 text-white/80 hover:text-white hover:bg-[var(--red)] dark:text-[var(--text-muted)]"
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
