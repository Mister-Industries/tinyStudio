import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import { useAppDispatch } from '@renderer/redux'
import { setPanelOpen } from '@renderer/redux/editorSlice'
import { FileText, Plug, PlugZap, Send, Terminal, Trash, X } from 'lucide-react'
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

// Mirror each serial line into window.__tinySerial + a 'tinyserial' event so the
// Visual (p5) tab can react via serialEvent()/serialValue().
function pushToVisual(line: string): void {
  const m = line.match(/-?\d+(?:\.\d+)?/)
  const value = m ? parseFloat(m[0]) : /(HIGH|\bON\b|true)/i.test(line) ? 1 : 0
  const w = window as unknown as {
    __tinySerial?: { lines: string[]; values: number[]; last: string; value: number }
  }
  const buf = w.__tinySerial || { lines: [], values: [], last: '', value: 0 }
  buf.lines = [...buf.lines.slice(-300), line]
  buf.values = [...buf.values.slice(-300), value]
  buf.last = line
  buf.value = value
  w.__tinySerial = buf
  try {
    window.dispatchEvent(new CustomEvent('tinyserial', { detail: { line, value } }))
  } catch {
    /* ignore */
  }
}

export function SerialMonitorTab(): React.JSX.Element {
  const { selectedBoard, isAgentConnected, openSerial, closeSerial, writeSerial, onSerialData, onSerialStatus } =
    useArduinoContext()
  const [baud, setBaud] = useState<string>('9600')
  const [lines, setLines] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const [input, setInput] = useState('')
  const [autoscroll, setAutoscroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const port = selectedBoard?.port

  // Remember intent + latest port/baud so we can resume after an upload (which
  // closes the monitor server-side to free the port for flashing).
  const wantConnected = useRef(false)
  const settings = useRef({ port, baud })
  settings.current = { port, baud }

  // Subscribe to streamed serial lines + open/close status for the lifetime of the tab.
  useEffect(() => {
    const offData = onSerialData((line) => {
      setLines((prev) => [...prev.slice(-1000), line])
      pushToVisual(line)
    })
    const offStatus = onSerialStatus((s) => {
      if (s.opened) setConnected(true)
      if (s.closed) {
        setConnected(false)
        // Resume after an upload-triggered close once the port is released.
        if (wantConnected.current && settings.current.port) {
          setTimeout(() => {
            if (wantConnected.current && settings.current.port) {
              openSerial(settings.current.port, parseInt(settings.current.baud, 10))
            }
          }, 2500)
        }
      }
    })
    return () => {
      offData()
      offStatus()
    }
  }, [onSerialData, onSerialStatus, openSerial])

  useEffect(() => {
    if (!autoscroll) return
    const el = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, autoscroll])

  const connect = (): void => {
    if (!port) return
    wantConnected.current = true
    openSerial(port, parseInt(baud, 10))
  }
  const disconnect = (): void => {
    wantConnected.current = false
    closeSerial()
  }

  const send = (): void => {
    if (!input.trim() || !connected) return
    writeSerial(input)
    setLines((prev) => [...prev.slice(-1000), `→ ${input}`])
    setInput('')
  }

  return (
    <div className="size-full flex flex-col gap-2 p-2">
      <ScrollArea
        ref={scrollRef}
        className="flex-1 min-h-0 border border-navy-600 rounded-xl bg-navy-1000 text-xs font-mono p-2"
      >
        {lines.length === 0 ? (
          <div className="text-fg-4 p-2">
            {isAgentConnected
              ? connected
                ? 'Listening… (no data yet)'
                : `Press Connect to open ${port || 'a port'} at ${baud} baud.`
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
          placeholder={connected ? 'Send a line…' : 'Connect to send'}
          value={input}
          disabled={!connected}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <FrequencySelect value={baud} onChange={setBaud} />
        {connected ? (
          <Button variant="outline" size="sm" onClick={disconnect}>
            <PlugZap size={14} /> Disconnect
          </Button>
        ) : (
          <Button size="sm" onClick={connect} disabled={!isAgentConnected || !port}>
            <Plug size={14} /> Connect
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={send} disabled={!connected || !input.trim()}>
          <Send size={14} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setLines([])}
          title="Clear"
        >
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

export function ProblemsTab(): React.JSX.Element {
  const { lastCompileResult } = useArduinoContext()

  return (
    <div className="size-full gap-2 bg-navy-900 p-2 flex flex-col">
      <ScrollArea className="size-full border border-navy-600 rounded-xl bg-navy-1000 p-2 text-xs">
        {lastCompileResult?.errors && lastCompileResult.errors.length > 0 ? (
          <div className="space-y-2">
            {lastCompileResult.errors.map((error, index) => (
              <div
                key={index}
                className="p-2 bg-destructive/10 border-l-4 border-destructive rounded"
              >
                <div className="font-semibold text-destructive">{error.severity.toUpperCase()}</div>
                <div className="text-sm">{error.message}</div>
                {error.file && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {error.file}
                    {error.line && `:${error.line}`}
                    {error.column && `:${error.column}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground">No compilation problems</div>
        )}
      </ScrollArea>
    </div>
  )
}

export function OutputTab(): React.JSX.Element {
  const { logs, clearLogs, lastCompileResult, lastUploadResult } = useArduinoContext()
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new logs are added
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight
      }
    }
  }, [logs])

  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString()
  }

  const getLogIcon = (type: string): string => {
    switch (type) {
      case 'compile':
        return '🔨'
      case 'upload':
        return '📤'
      case 'error':
        return '❌'
      case 'info':
      default:
        return 'ℹ️'
    }
  }

  const getLogColor = (type: string): string => {
    switch (type) {
      case 'error':
        return 'text-destructive'
      case 'compile':
        return 'text-blue-600'
      case 'upload':
        return 'text-green-600'
      case 'info':
      default:
        return 'text-muted-foreground'
    }
  }

  const formatCompileOutput = (output: string): string => {
    // Format and clean up Arduino CLI compilation output for better readability
    return output
      .split('\n')
      .filter((line) => line.trim() !== '') // Remove empty lines
      .map((line) => {
        const trimmed = line.trim()
        // Highlight important compiler messages
        if (trimmed.includes('Sketch uses') || trimmed.includes('Global variables use')) {
          return `📊 ${trimmed}`
        }
        if (trimmed.includes('warning:')) {
          return `⚠️  ${trimmed}`
        }
        if (trimmed.includes('error:')) {
          return `❌ ${trimmed}`
        }
        if (trimmed.includes('Compiling') || trimmed.includes('Linking')) {
          return `🔨 ${trimmed}`
        }
        return trimmed
      })
      .join('\n')
  }

  const formatMemoryUsage = (result: any): string | null => {
    if (!result?.metrics?.memoryUsage) return null
    const { flash, ram } = result.metrics.memoryUsage
    const flashPercent = Math.round((flash.used / flash.total) * 100)
    const ramPercent = Math.round((ram.used / ram.total) * 100)

    // Add memory usage indicators
    const flashIcon = flashPercent > 90 ? '🔴' : flashPercent > 75 ? '🟡' : '🟢'
    const ramIcon = ramPercent > 90 ? '🔴' : ramPercent > 75 ? '🟡' : '🟢'

    return `${flashIcon} Flash: ${flash.used.toLocaleString()}/${flash.total.toLocaleString()} bytes (${flashPercent}%) | ${ramIcon} RAM: ${ram.used.toLocaleString()}/${ram.total.toLocaleString()} bytes (${ramPercent}%)`
  }

  return (
    <div className="size-full gap-2 bg-navy-900 flex p-2 pb-22 flex-col">
      <ScrollArea
        ref={scrollAreaRef}
        className="size-full border border-navy-600 rounded-xl bg-navy-1000 text-xs font-mono"
      >
        {logs.length > 0 ? (
          <div className="space-y-1 p-2">
            {logs.map((log) => (
              <div key={log.id} className="flex gap-2 items-start">
                <span className="text-xs text-muted-foreground min-w-[60px]">
                  {formatTimestamp(log.timestamp)}
                </span>
                <span className="text-sm">{getLogIcon(log.type)}</span>
                <div className="flex-1 min-w-0">
                  <div className={`${getLogColor(log.type)} font-medium`}>{log.message}</div>
                  {log.details && (
                    <div className="mt-1">
                      {log.type === 'compile' && log.message.includes('successful') ? (
                        <div className="space-y-1">
                          {/* Show formatted compilation output */}
                          <div className="text-xs text-muted-foreground whitespace-pre-wrap font-mono bg-background/50 p-2 rounded border">
                            {formatCompileOutput(log.details)}
                          </div>
                          {/* Show memory usage if available from lastCompileResult */}
                          {lastCompileResult?.success && formatMemoryUsage(lastCompileResult) && (
                            <div className="text-xs text-green-600 font-mono">
                              Memory usage: {formatMemoryUsage(lastCompileResult)}
                            </div>
                          )}
                        </div>
                      ) : log.type === 'upload' && log.message.includes('successful') ? (
                        <div className="space-y-1">
                          {/* Show formatted upload output */}
                          <div className="text-xs text-muted-foreground whitespace-pre-wrap font-mono bg-background/50 p-2 rounded border">
                            {formatCompileOutput(log.details)}
                          </div>
                          {/* Show upload details if available */}
                          {lastUploadResult?.output && (
                            <div className="text-xs text-green-600 font-mono">
                              {lastUploadResult.output}
                            </div>
                          )}
                        </div>
                      ) : log.type === 'error' ? (
                        <div className="text-xs text-destructive whitespace-pre-wrap font-mono bg-destructive/5 p-2 rounded border border-destructive/20">
                          {log.details}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground whitespace-pre-wrap">
                          {log.details}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Show additional compile result details if there are no recent compile logs but we have results */}
            {lastCompileResult &&
              !logs.some((log) => log.type === 'compile' && Date.now() - log.timestamp < 10000) && (
                <div className="mt-4 p-3 border rounded-lg bg-background/30">
                  <div className="text-xs font-semibold text-muted-foreground mb-2">
                    Latest Result:
                  </div>
                  <div className="space-y-2">
                    <div
                      className={`text-xs ${lastCompileResult.success ? 'text-green-600' : 'text-destructive'}`}
                    >
                      Status: {lastCompileResult.success ? 'Success' : 'Failed'}
                    </div>
                    {lastCompileResult.output && (
                      <div className="text-xs font-mono bg-background/50 p-2 rounded border whitespace-pre-wrap">
                        {formatCompileOutput(lastCompileResult.output)}
                      </div>
                    )}
                    {lastCompileResult.success && formatMemoryUsage(lastCompileResult) && (
                      <div className="text-xs text-green-600 font-mono">
                        Memory usage: {formatMemoryUsage(lastCompileResult)}
                      </div>
                    )}
                    {lastCompileResult.errors && lastCompileResult.errors.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-destructive">
                          Compilation Errors:
                        </div>
                        {lastCompileResult.errors.map((error, index) => (
                          <div
                            key={index}
                            className="text-xs text-destructive font-mono bg-destructive/5 p-2 rounded border border-destructive/20"
                          >
                            {error.message}
                            {error.file && (
                              <div className="text-xs text-muted-foreground mt-1">
                                at {error.file}
                                {error.line ? `:${error.line}` : ''}
                                {error.column ? `:${error.column}` : ''}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
          </div>
        ) : (
          <div className="p-4 text-muted-foreground text-center">
            <div className="text-sm">No build output yet</div>
            <div className="text-xs mt-1">
              Compile or upload Arduino sketches to see build logs and output here
            </div>
          </div>
        )}
      </ScrollArea>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={clearLogs} disabled={logs.length === 0}>
          <Trash size={14} />
          Clear Output
        </Button>
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
