import { Monitor, Trash, X } from 'lucide-react'
import { useState } from 'react'
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
import { Button } from './ui/Button'
import { setPanelOpen } from '@renderer/redux/editorSlice'
import { useAppDispatch } from '@renderer/redux'
import { useArduino } from '@renderer/hooks/useArduino'

export function SerialMonitor(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'serial' | 'problems' | 'output'>('serial')
  const dispatch = useAppDispatch()

  return (
    <div className="size-full flex flex-col">
      <div className="w-full flex justify-between text-xs font-semibold border-b border-border">
        <div className="flex">
          <div
            data-active={activeTab === 'serial'}
            onClick={() => setActiveTab('serial')}
            className="flex gap-2 px-4 py-2 bg-muted items-center border-b-3 border-transparent data-[active=true]:bg-background data-[active=true]:border-secondary cursor-pointer"
          >
            <Monitor size={14} />
            Serial Monitor
          </div>
          {/* <div
            data-active={activeTab === 'problems'}
            onClick={() => setActiveTab('problems')}
            className="flex gap-2 px-4 py-2 bg-muted items-center border-b-3 border-transparent data-[active=true]:bg-background data-[active=true]:border-secondary cursor-pointer"
          >
            <TriangleAlert size={14} />
            Problems
          </div>
          <div
            data-active={activeTab === 'output'}
            onClick={() => setActiveTab('output')}
            className="flex gap-2 px-4 py-2 bg-muted items-center border-b-3 border-transparent data-[active=true]:bg-background data-[active=true]:border-secondary cursor-pointer"
          >
            <FileText size={14} />
            Output
          </div> */}
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
  const { lastCompileResult } = useArduino()

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
  const { logs, clearLogs } = useArduino()

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

  return (
    <div className="size-full gap-2 bg-background p-2 flex flex-col">
      <ScrollArea className="size-full border rounded-xl bg-muted p-2 text-xs">
        {logs.length > 0 ? (
          <div className="space-y-1">
            {logs.map((log) => (
              <div key={log.id} className="flex gap-2 items-start">
                <span className="text-xs text-muted-foreground">
                  {formatTimestamp(log.timestamp)}
                </span>
                <span>{getLogIcon(log.type)}</span>
                <div className="flex-1">
                  <div className={`${getLogColor(log.type)} font-medium`}>{log.message}</div>
                  {log.details && (
                    <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                      {log.details}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground">No output yet</div>
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
