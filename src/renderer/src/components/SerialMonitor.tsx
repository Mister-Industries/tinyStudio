import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import { useSerial } from '@renderer/contexts/SerialContext'
import { useAppDispatch } from '@renderer/redux'
import { setPanelOpen } from '@renderer/redux/editorSlice'
import { FileText, ListX, Send, Terminal, X } from 'lucide-react'
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
  const { clearLogs, isCompiling, isUploading } = useArduinoContext()

  // Verify/Upload jump to the Output log so the build is visible, then snap
  // back to the Serial Monitor once it finishes. The short delay rides over the
  // brief gap between the compile and upload phases of an Upload so we don't
  // flash back to Serial mid-operation.
  const busy = isCompiling || isUploading
  useEffect(() => {
    if (busy) {
      setActiveTab('output')
      return
    }
    const t = setTimeout(() => setActiveTab('serial'), 400)
    return () => clearTimeout(t)
  }, [busy])

  // Clear whichever pane is in front — the serial stream or the output log.
  const handleClear = (): void => {
    if (activeTab === 'serial') clear()
    else clearLogs()
  }

  const tab = (id: 'serial' | 'output', label: string, Icon: typeof Terminal): React.JSX.Element => (
    <button
      data-active={activeTab === id}
      onClick={() => setActiveTab(id)}
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
        <SerialMonitorTab />
      </div>
      <div className={activeTab === 'output' ? 'flex-1 min-h-0' : 'hidden'}>
        <OutputTab />
      </div>
    </div>
  )
}

export function SerialMonitorTab(): React.JSX.Element {
  const { isAgentConnected } = useArduinoContext()
  // The connection itself is owned by SerialProvider (app-level) so it persists
  // across view switches; this tab just displays it and sends lines. The live
  // connection status (COM @ baud) now lives in the bottom StatusBar.
  const { lines, connected, port, baud, setBaud, send: sendLine } = useSerial()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  // Stick to the bottom as new lines arrive — but pause the moment the user
  // scrolls up to read back, and resume once they return to the bottom.
  const stickRef = useRef(true)

  useEffect(() => {
    const el = scrollRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]'
    ) as HTMLElement | null
    if (!el) return
    const onScroll = (): void => {
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!stickRef.current) return
    const el = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

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
                ? 'Listening… (no data yet)'
                : 'No port selected.'
              : 'Arduino service not connected.'}
          </div>
        ) : (
          lines.map((l, i) => (
            <div
              key={i}
              className={l.startsWith('→') ? 'text-[var(--blue)]' : 'text-[var(--text-body)]'}
            >
              {l}
            </div>
          ))
        )}
      </ScrollArea>
      <div className="flex w-full items-center gap-2 px-3 py-2 border-t-[1.5px] border-[var(--border-default)]">
        <input
          className="flex-1 h-[30px] bg-[var(--surface-card)] border-[1.5px] border-[var(--border-default)] rounded-[var(--radius-sm)] px-3 font-mono text-xs text-[var(--text-strong)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--brand)] disabled:opacity-50"
          placeholder={connected ? 'Send a line…' : 'Waiting for connection…'}
          value={input}
          disabled={!connected}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
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

export function OutputTab(): React.JSX.Element {
  const { logs } = useArduinoContext()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new logs are added.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

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

export function FrequencySelect({ value, onChange }: FrequencySelectProps): React.JSX.Element {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Baud Rate</SelectLabel>
          <SelectItem value="9600">9600 baud</SelectItem>
          <SelectItem value="14400">14400 baud</SelectItem>
          <SelectItem value="38400">38400 baud</SelectItem>
          <SelectItem value="57600">57600 baud</SelectItem>
          <SelectItem value="115200">115200 baud</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
