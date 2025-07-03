import { FileText, Monitor, Trash, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import { Input } from './ui/Input'
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

export function SerialMonitor(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'serial' | 'problems' | 'output'>('serial')
  const dispatch = useAppDispatch()

  // TODO: Implement the logic for each tab
  // TODO: implement this as a Tabs component for proper focus
  // TODO: Implement the logic for closing the monitor
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
          <div
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
