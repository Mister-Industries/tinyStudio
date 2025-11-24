import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import { useAppDispatch } from '@renderer/redux'
import { setPanelOpen } from '@renderer/redux/editorSlice'
import { FileText, Trash, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
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
  const [activeTab, setActiveTab] = useState<'serial' | 'problems' | 'output'>('output')
  const dispatch = useAppDispatch()

  return (
    <div className="size-full flex flex-col">
      <div className="w-full flex justify-between text-xs font-semibold border-b border-border">
        <div className="flex">
          {/* <div
            data-active={activeTab === 'serial'}
            onClick={() => setActiveTab('serial')}
            className="flex gap-2 px-4 py-2 bg-muted items-center border-b-3 border-transparent data-[active=true]:bg-background data-[active=true]:border-secondary cursor-pointer"
          >
            <Monitor size={14} />
            Serial Monitor
          </div>
          <div
            data-active={activeTab === 'problems'}
            onClick={() => setActiveTab('problems')}
            className="flex gap-2 px-4 py-2 bg-muted items-center border-b-3 border-transparent data-[active=true]:bg-background data-[active=true]:border-secondary cursor-pointer"
          >
            <TriangleAlert size={14} />
            Problems
          </div> */}
          <div
            data-active={activeTab === 'output'}
            onClick={() => setActiveTab('output')}
            className="flex gap-2 px-4 py-2 bg-muted items-center border-b-3 border-transparent data-[active=true]:bg-background data-[active=true]:border-secondary cursor-pointer"
          >
            <FileText size={14} />
            Output
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => dispatch(setPanelOpen({ panel: 'monitor', isOpen: false }))}
        >
          <X />
        </Button>
      </div>
      {activeTab === 'serial' && <SerialMonitorTab />}
      {activeTab === 'problems' && <ProblemsTab />}
      {activeTab === 'output' && <OutputTab />}
    </div>
  )
}

export function SerialMonitorTab(): React.JSX.Element {
  const [frequency, setFrequency] = useState<string>('9600')

  // TODO: Implement the logic for the serial monitor
  // TODO: Implement the logic for sending commands
  return (
    <div className="size-full gap-2 bg-background p-2 flex flex-col">
      <div className="size-full border rounded-xl bg-muted text-xs"></div>
      <div className="flex w-full gap-2">
        <Input placeholder="Send command..." className="text-xs dark:text-xs" />
        <FrequencySelect value={frequency} onChange={setFrequency} />
        <Button>Send</Button>
        <Button variant="outline" size="icon">
          <Trash size={14} />
        </Button>
      </div>
    </div>
  )
}

export function ProblemsTab(): React.JSX.Element {
  const { lastCompileResult } = useArduinoContext()

  return (
    <div className="size-full gap-2 bg-background p-2 flex flex-col">
      <ScrollArea className="size-full border rounded-xl bg-muted p-2 text-xs">
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
    <div className="size-full gap-2 bg-background flex p-2 pb-22 flex-col">
      <ScrollArea className="size-full border rounded-xl bg-muted text-xs">
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
