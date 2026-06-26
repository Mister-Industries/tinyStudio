import {
  Bell,
  ChevronDown,
  Cpu,
  LayoutDashboard,
  ListX,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Plug,
  PlugZap
} from 'lucide-react'
import React from 'react'
import { useArduinoContext } from '../contexts/ArduinoContext'
import { useSerial } from '../contexts/SerialContext'
import {
  clearNotifications,
  selectNotifications,
  selectPanelState,
  setPanelOpen,
  useAppDispatch,
  useAppSelector
} from '../redux'
import { Badge } from './ui/Badge'
import { StatusPill } from './ui/StatusPill'

/** Shared dismiss-on-outside-click backdrop for the status-bar popovers. */
function Backdrop({ onClose }: { onClose: () => void }): React.JSX.Element {
  return <div className="fixed inset-0 z-40" onClick={onClose} />
}

function PanelMenu(): React.JSX.Element {
  const dispatch = useAppDispatch()
  const { isFileExplorerOpen, isSerialMonitorOpen, isDocsPanelOpen } =
    useAppSelector(selectPanelState)
  const [open, setOpen] = React.useState(false)

  const toggle = (panel: 'file' | 'monitor' | 'docs', isOpen: boolean): void => {
    dispatch(setPanelOpen({ panel, isOpen: !isOpen }))
  }

  return (
    <div className="pmenu">
      {open && (
        <>
          <Backdrop onClose={() => setOpen(false)} />
          <div className="pmenu__pop z-50" role="menu" aria-label="Panels">
            <button
              className={'pmenu__btn' + (isFileExplorerOpen ? ' on' : '')}
              onClick={() => toggle('file', isFileExplorerOpen)}
              aria-pressed={isFileExplorerOpen}
              title="Files panel"
            >
              <PanelLeft size={16} />
            </button>
            <button
              className={'pmenu__btn' + (isSerialMonitorOpen ? ' on' : '')}
              onClick={() => toggle('monitor', isSerialMonitorOpen)}
              aria-pressed={isSerialMonitorOpen}
              title="Serial monitor"
            >
              <PanelBottom size={16} />
            </button>
            <button
              className={'pmenu__btn' + (isDocsPanelOpen ? ' on' : '')}
              onClick={() => toggle('docs', isDocsPanelOpen)}
              aria-pressed={isDocsPanelOpen}
              title="Docs panel"
            >
              <PanelRight size={16} />
            </button>
          </div>
        </>
      )}
      <button
        className={'st-iconbtn' + (open ? ' st-iconbtn--on' : '')}
        onClick={() => setOpen((v) => !v)}
        aria-label="Panels"
        aria-expanded={open}
      >
        <LayoutDashboard size={14} />
      </button>
    </div>
  )
}

function NotificationBell(): React.JSX.Element {
  const dispatch = useAppDispatch()
  const items = useAppSelector(selectNotifications)
  const [open, setOpen] = React.useState(false)

  return (
    <div className="notif">
      {open && (
        <>
          <Backdrop onClose={() => setOpen(false)} />
          <div className="notif__pop z-50" role="dialog" aria-label="Notifications">
            <div className="notif__head">
              <span className="ts-eyebrow">Notifications</span>
              <div className="notif__hbtns">
                <button
                  className="notif__hbtn"
                  aria-label="Clear all"
                  title="Clear all"
                  onClick={() => dispatch(clearNotifications())}
                >
                  <ListX size={15} />
                </button>
                <button
                  className="notif__hbtn"
                  aria-label="Collapse"
                  title="Collapse"
                  onClick={() => setOpen(false)}
                >
                  <ChevronDown size={15} />
                </button>
              </div>
            </div>
            <div className="notif__body">
              {items.length === 0 ? (
                <div className="notif__empty">No notifications yet.</div>
              ) : (
                items.map((n) => (
                  <div className="notif__item" key={n.id}>
                    <span className={'notif__dot notif__dot--' + n.tone} aria-hidden="true" />
                    <div className="notif__itembody">
                      <div className="notif__title">{n.title}</div>
                      {n.msg && <div className="notif__msg">{n.msg}</div>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
      <button
        className={'st-iconbtn' + (open ? ' st-iconbtn--on' : '')}
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
      >
        <Bell size={14} />
        {items.length > 0 && <span className="st-bell-badge">{items.length}</span>}
      </button>
    </div>
  )
}

export function StatusBar(): React.JSX.Element {
  const { isAgentConnected, checkAgentStatus, selectedBoard, isCompiling, isUploading } =
    useArduinoContext()
  const { connected, disconnected, port, baud, reconnect } = useSerial()

  const handleRetry = async (): Promise<void> => {
    try {
      await checkAgentStatus()
    } catch (error) {
      console.error('Failed to check Arduino service status:', error)
    }
  }

  const busy = isUploading || isCompiling
  const busyLabel = isUploading ? 'Uploading…' : isCompiling ? 'Compiling…' : 'Ready'

  // Links must read on the blue bar (light) and the grey bar (dark).
  const link =
    'underline underline-offset-2 text-white/90 hover:text-white dark:text-[var(--brand)] dark:no-underline dark:hover:underline'

  return (
    <footer className="ts-statusbar flex items-center justify-between shrink-0 h-[27px] px-3 text-[11.5px] font-sans bg-[var(--brand)] text-white/[0.88] shadow-[inset_0_1px_0_0_rgba(0,0,0,0.14)] dark:bg-[var(--bg-raised)] dark:text-[var(--text-muted)] dark:border-t dark:border-[var(--border-default)] dark:shadow-none">
      <div className="flex items-center">
        <StatusPill status={busy ? 'warn' : 'idle'} pulse={busy} bare>
          {busyLabel}
        </StatusPill>
        {selectedBoard && (
          <>
            <span className="text-white dark:text-[var(--text-faint)] mx-2">·</span>
            <span className="inline-flex items-center gap-1">
              <Cpu size={12} />
              {selectedBoard.config.name}
            </span>
          </>
        )}
        <span className="text-white dark:text-[var(--text-faint)] mx-2">·</span>
        <span
          className="inline-flex items-center gap-1"
          style={!isAgentConnected ? { color: 'var(--status-error)' } : undefined}
        >
          {isAgentConnected ? <Plug size={12} /> : <PlugZap size={12} />}
          {isAgentConnected ? 'Connected' : 'Disconnected'}
        </span>
        {isAgentConnected && port && (
          <>
            <span className="text-white dark:text-[var(--text-faint)] mx-2">·</span>
            <span className="inline-flex items-center gap-1.5">
              {disconnected
                ? 'Serial released'
                : connected
                  ? `${port} @ ${baud}`
                  : `Connecting ${port}…`}
              {disconnected && (
                <button className={link} onClick={reconnect}>
                  reconnect
                </button>
              )}
            </span>
          </>
        )}
        {!isAgentConnected && (
          <button className={`ml-2 ${link}`} onClick={handleRetry}>
            Retry
          </button>
        )}
      </div>
      <div className="flex items-center">
        <span>UTF-8</span>
        <span className="text-white dark:text-[var(--text-faint)] mx-2">·</span>
        <span>Arduino (C++)</span>
        <span className="text-white dark:text-[var(--text-faint)] mx-2">·</span>
        <span>tinyStudio 0.1.1</span>
        <span className="ml-2.5">
          <Badge tone="yellow" variant="solid">
            alpha
          </Badge>
        </span>
        <span className="w-[1.5px] h-[15px] bg-white/[0.32] dark:bg-[var(--border-default)] mx-2.5" />
        <PanelMenu />
        <NotificationBell />
      </div>
    </footer>
  )
}
