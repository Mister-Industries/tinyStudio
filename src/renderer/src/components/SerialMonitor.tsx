import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import { useSerial } from '@renderer/contexts/SerialContext'
import { useAppDispatch } from '@renderer/redux'
import { setPanelOpen } from '@renderer/redux/editorSlice'
import { FileText, ListX, Send, Terminal, X } from 'lucide-react'
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
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="text-fg-3 hover:text-fg-1 hover:bg-navy-500"
            onClick={handleClear}
            title={activeTab === 'serial' ? 'Clear serial monitor' : 'Clear output'}
          >
            <ListX />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-fg-3 hover:text-fg-1 hover:bg-navy-500"
            onClick={() => dispatch(setPanelOpen({ panel: 'monitor', isOpen: false }))}
            title="Close"
          >
            <X />
          </Button>
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
    <div className="size-full flex flex-col gap-2 p-2">
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
