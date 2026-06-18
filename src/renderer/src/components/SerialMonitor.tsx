import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import { pushSerialLine } from '@renderer/lib/serialBus'
import { useAppDispatch } from '@renderer/redux'
import { setPanelOpen } from '@renderer/redux/editorSlice'
import { FileText, Send, Terminal, Trash, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from './ui/Button'
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

  const tab = (id: 'serial' | 'output', label: string, Icon: typeof Terminal): React.JSX.Element => (
    <div
      data-active={activeTab === id}
      onClick={() => setActiveTab(id)}
      className="flex gap-2 px-4 py-2 items-center border-b-2 border-transparent text-fg-3 data-[active=true]:text-fg-1 data-[active=true]:border-cyan cursor-pointer transition-colors"
    >
      <Icon size={14} />
      {label}
    </div>
  )

  return (
    <div className="size-full flex flex-col bg-navy-900">
      <div className="w-full flex justify-between text-xs font-semibold border-b border-navy-600">
        <div className="flex">
          {tab('serial', 'Serial Monitor', Terminal)}
          {tab('output', 'Output', FileText)}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-fg-3 hover:text-fg-1 hover:bg-navy-500"
          onClick={() => dispatch(setPanelOpen({ panel: 'monitor', isOpen: false }))}
        >
          <X />
        </Button>
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
  const {
    selectedBoard,
    isAgentConnected,
    isUploading,
    openSerial,
    closeSerial,
    writeSerial,
    onSerialData,
    onSerialStatus
  } = useArduinoContext()
  const [baud, setBaud] = useState<string>('9600')
  const [lines, setLines] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const [input, setInput] = useState('')
  const [autoscroll, setAutoscroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const port = selectedBoard?.port

  // Mirror connection state into a ref so the watchdog interval sees it live.
  const connectedRef = useRef(false)
  connectedRef.current = connected

  // Subscribe to streamed serial lines + open/close status for the lifetime of the tab.
  useEffect(() => {
    const offData = onSerialData((line) => {
      setLines((prev) => [...prev.slice(-1000), line])
      pushSerialLine(line)
    })
    const offStatus = onSerialStatus((s) => {
      if (s.opened) setConnected(true)
      if (s.closed) setConnected(false)
    })
    return () => {
      offData()
      offStatus()
    }
  }, [onSerialData, onSerialStatus])

  // Auto-connect to the selected programming port (like the Arduino IDE — no
  // manual connect button). A watchdog reopens if we're not connected, which
  // self-heals after a transient "port busy".
  //
  // CRITICAL: the serial port is exclusive, so the monitor MUST be released
  // during an upload — otherwise the watchdog grabs the port back mid-flash and
  // avrdude stalls at ~90% with "Serial port busy". We close the monitor while
  // `isUploading` and only reopen (after a short settle) once it finishes.
  const baudNum = parseInt(baud, 10)
  useEffect(() => {
    if (!isAgentConnected || !port) {
      setConnected(false)
      return
    }
    if (isUploading) {
      closeSerial()
      setConnected(false)
      return
    }
    // Give the port a moment to settle after a just-finished upload/board reset.
    const openTimer = setTimeout(() => openSerial(port, baudNum), 600)
    const id = setInterval(() => {
      if (!connectedRef.current) openSerial(port, baudNum)
    }, 3000)
    return () => {
      clearTimeout(openTimer)
      clearInterval(id)
      closeSerial()
    }
  }, [isAgentConnected, port, baudNum, isUploading, openSerial, closeSerial])

  useEffect(() => {
    if (!autoscroll) return
    const el = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, autoscroll])

  const send = (): void => {
    if (!input.trim() || !connected) return
    writeSerial(input)
    setLines((prev) => [...prev.slice(-1000), `→ ${input}`])
    setInput('')
  }

  return (
    <div className="size-full flex flex-col gap-2 p-2">
      <div className="flex items-center gap-2 px-1 text-[11px] text-fg-3">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={
            connected
              ? { background: 'var(--signal-success)', boxShadow: '0 0 8px var(--signal-success)' }
              : { background: 'var(--fg-4)' }
          }
        />
        {!isAgentConnected
          ? 'Arduino service not connected'
          : !port
            ? 'Select a board/port to monitor'
            : isUploading
              ? 'Paused while flashing…'
              : connected
                ? `Connected · ${port} @ ${baud}`
                : `Connecting to ${port}…`}
      </div>
      <ScrollArea
        ref={scrollRef}
        className="flex-1 min-h-0 border border-navy-600 bg-navy-1000 text-xs font-mono leading-[1.5] p-2"
      >
        {lines.length === 0 ? (
          <div className="text-fg-4">
            {isAgentConnected
              ? port
                ? 'Listening… (no data yet)'
                : 'No port selected.'
              : 'Arduino service not connected.'}
          </div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={l.startsWith('→') ? 'text-cyan' : 'text-fg-2'}>
              {l}
            </div>
          ))
        )}
      </ScrollArea>
      <div className="flex w-full gap-2">
        <input
          className="flex-1 bg-navy-900 border border-navy-400 rounded-lg px-3 py-1.5 text-xs font-mono text-fg-1 placeholder:text-fg-4 outline-none focus:border-cyan disabled:opacity-50"
          placeholder={connected ? 'Send a line…' : 'Waiting for connection…'}
          value={input}
          disabled={!connected}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <FrequencySelect value={baud} onChange={setBaud} />
        <Button variant="ghost" size="sm" onClick={send} disabled={!connected || !input.trim()}>
          <Send size={14} />
        </Button>
        <Button variant="outline" size="icon" onClick={() => setLines([])} title="Clear">
          <Trash size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-active={autoscroll}
          className="data-[active=true]:text-cyan"
          onClick={() => setAutoscroll((a) => !a)}
          title="Autoscroll"
        >
          Auto
        </Button>
      </div>
    </div>
  )
}

export function OutputTab(): React.JSX.Element {
  const { logs, clearLogs } = useArduinoContext()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new logs are added.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  const time = (ts: number): string => new Date(ts).toLocaleTimeString()
  const lineColor = (type: string): string =>
    type === 'error'
      ? 'text-signal-error'
      : type === 'upload' || type === 'compile'
        ? 'text-signal-success'
        : 'text-fg-2'

  // Flatten each log entry into plain terminal lines: a header line, then its
  // raw detail lines (no cards, no padding, no emoji) — just a console.
  return (
    <div className="size-full relative bg-navy-1000">
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-auto p-2 text-xs font-mono leading-[1.5] whitespace-pre-wrap"
      >
        {logs.length === 0 ? (
          <span className="text-fg-4">— no output yet · Verify or Upload to compile —</span>
        ) : (
          logs.map((log) => (
            <div key={log.id} className={lineColor(log.type)}>
              <span className="text-fg-4">{time(log.timestamp)} </span>
              {log.message}
              {log.details && <div className="text-fg-3">{log.details.replace(/\n+$/, '')}</div>}
            </div>
          ))
        )}
      </div>
      {logs.length > 0 && (
        <button
          onClick={clearLogs}
          title="Clear output"
          className="absolute top-1.5 right-2.5 z-10 p-1.5 rounded-md text-fg-4 hover:text-fg-1 hover:bg-navy-600/80"
        >
          <Trash size={14} />
        </button>
      )}
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
      <SelectTrigger>
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
