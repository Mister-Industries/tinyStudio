import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import { useSerial, type SerialEol } from '@renderer/contexts/SerialContext'
import { useAppDispatch } from '@renderer/redux'
import { setPanelOpen } from '@renderer/redux/editorSlice'
import { ArrowDownToLine, Clock, FileText, ListX, Send, Terminal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { ScrollArea } from './ui/ScrollArea'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from './ui/Select'

export function SerialMonitor(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'serial' | 'output'>('serial')
  const dispatch = useAppDispatch()
  const { clear } = useSerial()
  const { clearLogs, isCompiling, isUploading, lastCompileResult, lastUploadResult } =
    useArduinoContext()

  // Auto-scroll (stick to bottom) per pane — toggled by the button in the header.
  const [serialAuto, setSerialAuto] = useState(true)
  const [outputAuto, setOutputAuto] = useState(true)
  const auto = activeTab === 'serial' ? serialAuto : outputAuto
  const toggleAuto = (): void =>
    activeTab === 'serial' ? setSerialAuto((v) => !v) : setOutputAuto((v) => !v)

  // Verify/Upload jump to the Output log so the build is visible. When the
  // operation finishes we snap back to the Serial Monitor ONLY if it
  // succeeded — a failed build keeps the Output pane (and its compiler
  // errors) in front instead of yanking it away after 400 ms. If the user
  // picked a tab themselves during the run, we respect that and don't
  // auto-switch at all.
  const busy = isCompiling || isUploading
  const userPinnedTab = useRef(false)
  useEffect(() => {
    if (busy) {
      userPinnedTab.current = false
      setActiveTab('output')
      return
    }
    if (userPinnedTab.current) return
    const failed =
      lastCompileResult?.success === false || lastUploadResult?.success === false
    if (failed) return // leave the errors visible
    // Short delay rides over the brief gap between the compile and upload
    // phases of an Upload so we don't flash back to Serial mid-operation.
    const t = setTimeout(() => setActiveTab('serial'), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy])

  const selectTab = (id: 'serial' | 'output'): void => {
    if (busy) userPinnedTab.current = true
    setActiveTab(id)
  }

  // Clear whichever pane is in front — the serial stream or the output log.
  const handleClear = (): void => {
    if (activeTab === 'serial') clear()
    else clearLogs()
  }

  const tab = (id: 'serial' | 'output', label: string, Icon: typeof Terminal): React.JSX.Element => (
    <button
      data-active={activeTab === id}
      onClick={() => selectTab(id)}
      className="relative flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text-body)] data-[active=true]:text-[var(--text-strong)] after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-[1.5px] after:h-[2.5px] after:origin-bottom after:scale-x-0 after:rounded-t-[2px] after:bg-[var(--brand)] after:transition-transform after:content-[''] data-[active=true]:after:scale-x-100"
    >
      <Icon size={14} />
      {label}
    </button>
  )

  return (
    <div className="size-full flex flex-col bg-[var(--bg-raised)]">
      <div className="w-full flex items-center justify-between h-[36px] border-b-[1.5px] border-[var(--border-default)] pr-1">
        <div className="flex">
          {tab('serial', 'Serial Monitor', Terminal)}
          {tab('output', 'Output', FileText)}
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton
            label={auto ? 'Auto-scroll on' : 'Auto-scroll off'}
            variant="ghost"
            size="sm"
            onClick={toggleAuto}
            className={auto ? 'text-[var(--brand)]' : 'text-[var(--text-muted)]'}
          >
            <ArrowDownToLine size={15} />
          </IconButton>
          <IconButton
            label={activeTab === 'serial' ? 'Clear serial monitor' : 'Clear output'}
            variant="ghost"
            size="sm"
            onClick={handleClear}
          >
            <ListX size={15} />
          </IconButton>
          <IconButton
            label="Close"
            variant="ghost"
            size="sm"
            onClick={() => dispatch(setPanelOpen({ panel: 'monitor', isOpen: false }))}
          >
            <X size={15} />
          </IconButton>
        </div>
      </div>
      {/* Both tabs stay mounted so the serial stream isn't dropped when you peek at Output. */}
      <div className={activeTab === 'serial' ? 'flex-1 min-h-0' : 'hidden'}>
        <SerialMonitorTab autoScroll={serialAuto} />
      </div>
      <div className={activeTab === 'output' ? 'flex-1 min-h-0' : 'hidden'}>
        <OutputTab autoScroll={outputAuto} />
      </div>
    </div>
  )
}

/** Render a receive/send time like the Arduino IDE's timestamp option. */
function formatTs(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

export function SerialMonitorTab({ autoScroll = true }: { autoScroll?: boolean }): React.JSX.Element {
  const { isAgentConnected } = useArduinoContext()
  // The connection itself is owned by SerialProvider (app-level) so it persists
  // across view switches; this tab just displays it and sends lines. The live
  // connection status (COM @ baud) now lives in the bottom StatusBar.
  const { lines, connected, lastError, port, baud, setBaud, eol, setEol, send: sendLine } =
    useSerial()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Timestamps toggle (persisted app-wide, like autoscroll in the Arduino IDE).
  const [showTs, setShowTs] = useState<boolean>(() => {
    try {
      return localStorage.getItem('tinystudio.monitor.timestamps') === '1'
    } catch {
      return false
    }
  })
  const toggleTs = (): void => {
    setShowTs((v) => {
      try {
        localStorage.setItem('tinystudio.monitor.timestamps', v ? '0' : '1')
      } catch {
        /* storage unavailable */
      }
      return !v
    })
  }

  // Stick to the bottom as new lines arrive while auto-scroll is on. Toggling it
  // on also jumps to the bottom immediately.
  useEffect(() => {
    if (!autoScroll) return
    const el = scrollRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]'
    ) as HTMLElement | null
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, autoScroll])

  const send = (): void => {
    if (!input.trim() || !connected) return
    sendLine(input)
    setInput('')
  }

  return (
    <div className="size-full flex flex-col">
      {/* Body fills edge-to-edge like the Output pane (sunken code well). */}
      <ScrollArea
        ref={scrollRef}
        className="flex-1 min-h-0 bg-[var(--bg-sunken)] px-3.5 py-2.5 font-mono text-xs leading-[1.6]"
      >
        {lines.length === 0 ? (
          <div className="text-[var(--text-faint)]">
            {isAgentConnected
              ? port
                ? lastError
                  ? `Could not open ${port}: ${lastError}`
                  : 'Listening… (no data yet)'
                : 'No port selected.'
              : 'Arduino service not connected.'}
          </div>
        ) : (
          lines.map((l, i) => (
            <div
              key={i}
              className={
                l.tx
                  ? 'text-[var(--blue)]'
                  : l.text.startsWith('⚠')
                    ? 'text-[var(--status-error)]'
                    : 'text-[var(--text-body)]'
              }
            >
              {showTs && <span className="text-[var(--text-faint)]">{formatTs(l.ts)} </span>}
              {l.text}
            </div>
          ))
        )}
      </ScrollArea>
      <div className="flex w-full items-center gap-2 px-3 py-2 border-t-[1.5px] border-[var(--border-default)]">
        <IconButton
          label={showTs ? 'Hide timestamps' : 'Show timestamps'}
          variant="ghost"
          size="sm"
          onClick={toggleTs}
          className={showTs ? 'text-[var(--brand)]' : 'text-[var(--text-muted)]'}
        >
          <Clock size={15} />
        </IconButton>
        <input
          className="flex-1 h-[30px] bg-[var(--surface-card)] border-[1.5px] border-[var(--border-default)] rounded-[var(--radius-sm)] px-3 font-mono text-xs text-[var(--text-strong)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--brand)] disabled:opacity-50"
          placeholder={connected ? 'Send a line…' : 'Waiting for connection…'}
          value={input}
          disabled={!connected}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <LineEndingSelect value={eol} onChange={setEol} />
        <FrequencySelect value={baud} onChange={setBaud} />
        <Button
          variant="default"
          size="icon"
          className="size-[30px]"
          onClick={send}
          disabled={!connected || !input.trim()}
          title="Send"
        >
          <Send size={14} />
        </Button>
      </div>
    </div>
  )
}

export function OutputTab({ autoScroll = true }: { autoScroll?: boolean }): React.JSX.Element {
  const { logs } = useArduinoContext()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new logs are added (while enabled).
  useEffect(() => {
    if (!autoScroll) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs, autoScroll])

  const time = (ts: number): string => new Date(ts).toLocaleTimeString()
  const lineColor = (type: string): string =>
    type === 'error'
      ? 'text-[var(--status-error)]'
      : type === 'upload' || type === 'compile'
        ? 'text-[var(--status-ok)]'
        : 'text-[var(--text-body)]'

  // Flatten each log entry into plain terminal lines: a header line, then its
  // raw detail lines (no cards, no padding, no emoji) — just a console.
  return (
    <div className="size-full relative bg-[var(--bg-sunken)]">
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-auto px-3.5 py-2.5 font-mono text-xs leading-[1.6] whitespace-pre-wrap"
      >
        {logs.length === 0 ? (
          <span className="text-[var(--text-faint)]">
            — no output yet · Verify or Upload to compile —
          </span>
        ) : (
          logs.map((log) => (
            <div key={log.id} className={lineColor(log.type)}>
              <span className="text-[var(--text-faint)]">{time(log.timestamp)} </span>
              {log.message}
              {log.details && (
                <div className="text-[var(--text-muted)]">{log.details.replace(/\n+$/, '')}</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

interface FrequencySelectProps {
  value: string
  onChange: (value: string) => void
}

// Match the Arduino IDE's full baud list (plus 74880, which ESP chips use for
// boot messages). The old 5-entry list couldn't even show ESP32 boot output.
const BAUD_RATES = [
  '300',
  '1200',
  '2400',
  '4800',
  '9600',
  '19200',
  '31250',
  '38400',
  '57600',
  '74880',
  '115200',
  '230400',
  '250000',
  '460800',
  '500000',
  '921600',
  '1000000',
  '2000000'
]

export function FrequencySelect({ value, onChange }: FrequencySelectProps): React.JSX.Element {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Baud Rate</SelectLabel>
          {BAUD_RATES.map((b) => (
            <SelectItem key={b} value={b}>
              {b} baud
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

interface LineEndingSelectProps {
  value: SerialEol
  onChange: (value: SerialEol) => void
}

/** Arduino IDE parity: line ending appended to sent data. */
export function LineEndingSelect({ value, onChange }: LineEndingSelectProps): React.JSX.Element {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SerialEol)}>
      <SelectTrigger size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Line Ending</SelectLabel>
          <SelectItem value="none">No line ending</SelectItem>
          <SelectItem value="nl">New line</SelectItem>
          <SelectItem value="cr">Carriage return</SelectItem>
          <SelectItem value="crlf">Both NL & CR</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
