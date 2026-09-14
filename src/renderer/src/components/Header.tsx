import { isElectron } from '@renderer/lib/utils'
import { openProjectDialog, selectOpenFiles, useAppDispatch, useAppSelector } from '@renderer/redux'
import { useTheme } from '@renderer/lib/ThemeProvider'
import { ChevronRight, Maximize, Minimize, Minus, Moon, Sun, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useWorkspaceActions } from '@renderer/hooks/useWorkspaceActions'
import { Button } from './ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/DropdownMenu'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/Tooltip'
import { GitHubAccountButton } from './GitHubAccountButton'

/**
 * Top bar (38px). Brand wordmark + breadcrumb on the left; theme toggle, GitHub
 * account, and (on Electron) window controls on the right.
 *
 * Theme-aware per the design system: in LIGHT mode the bar is the green bar
 * accent color; in DARK mode it's the raised grey surface. The wordmark is
 * white in both. Inset controls flip with the bar. Uses --bar-accent (not --brand), so buttons and
 * selection elsewhere stay on the blue brand color.
 */
export function Header(): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)
  const workspace = useAppSelector((state) => state.file.workspace)
  const openFiles = useAppSelector(selectOpenFiles)
  const viewingFileId = useAppSelector((state) => state.file.viewingFileId)
  const viewingFile = openFiles.find((f) => f.id === viewingFileId)
  const { theme, setTheme } = useTheme()
  const isDark = theme === 'dark'
  const dispatch = useAppDispatch()
  const { openWorkspace, refreshWorkspace, closeWorkspace, newFile, newFolder } =
    useWorkspaceActions()

  // Radix traps focus while the menu is open, which would swallow the file
  // tree's inline name-field autoFocus (New File/Folder). So run the action a
  // tick after select — once the menu has closed and released the trap — and
  // skip the menu's usual return-focus-to-trigger, which would blur that field.
  const menuActionRan = useRef(false)
  const afterMenuClose = (action: () => void) => (): void => {
    menuActionRan.current = true
    setTimeout(action, 0)
  }

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
      className="h-[38px] w-full shrink-0 flex items-center justify-between bg-[var(--bar-accent)] shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.18)] dark:bg-[var(--bg-raised)] dark:border-b dark:border-[var(--border-default)] dark:shadow-none"
      style={isElectron() ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : {}}
    >
      <div className="flex items-center gap-2 pl-3 min-w-0">
        {/* Wordmark doubles as a "File"-style menu for workspace actions. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="-ml-1.5 cursor-pointer rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[15px] font-extrabold tracking-[-0.02em] select-none text-white outline-none transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/60 data-[state=open]:bg-white/15 dark:hover:bg-[var(--bg-sunken)] dark:data-[state=open]:bg-[var(--bg-sunken)]"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <span className="font-medium text-white/70">tiny</span>Studio
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-[11rem]"
            onCloseAutoFocus={(e) => {
              // Dismissed without choosing an item → let focus return to the trigger.
              if (!menuActionRan.current) return
              menuActionRan.current = false
              e.preventDefault()
            }}
          >
            <DropdownMenuItem
              onSelect={afterMenuClose(() => dispatch(openProjectDialog('create')))}
            >
              New Project…
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!workspace} onSelect={afterMenuClose(newFile)}>
              New File
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!workspace} onSelect={afterMenuClose(newFolder)}>
              New Folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={afterMenuClose(openWorkspace)}>
              Open Folder…
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!workspace} onSelect={afterMenuClose(refreshWorkspace)}>
              Refresh Files
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!workspace} onSelect={afterMenuClose(closeWorkspace)}>
              Close Workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
          // target=_blank: a new tab on web; on desktop the main process's
          // setWindowOpenHandler hands it to the system browser.
          <a
            href="https://www.mr.industries"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-white/70 hover:text-white hover:underline underline-offset-2 dark:text-[var(--text-muted)] dark:hover:text-[var(--text-strong)] pl-1"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            by MR.INDUSTRIES
          </a>
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
