import { Check, File, Folder, Library, Monitor, Save, Upload } from 'lucide-react'
import { Button } from './ui/Button'
import { Separator } from './ui/Separator'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from './ui/Select'
import React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/Tooltip'

export function Toolbar(): React.JSX.Element {
  return (
    <div className="px-4 py-3 h-14 flex items-center justify-between shadow-sm bg-primary text-primary-foreground">
      <div className="flex items-center gap-2 h-full">
        <Tooltip>
          <TooltipTrigger>
            <Button variant="ghost" size="icon">
              <File />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New File</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <Button variant="ghost" size="icon">
              <Folder />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New Folder</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <Button variant="ghost" size="icon">
              <Save />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Save</TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" />
        <Button variant="muted">
          <Check />
          Verify
        </Button>
        <Button variant="secondary">
          <Upload />
          Upload
        </Button>
        <Separator orientation="vertical" />
        <Tooltip>
          <TooltipTrigger>
            <Button variant="ghost" size="icon">
              <Monitor />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Monitor</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <Button variant="ghost" size="icon">
              <Library />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Library</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex gap-2">
        <BoardSelect />
        <PortSelect />
      </div>
    </div>
  )
}

const BOARDS = [
  { label: 'Arduino Uno', value: 'uno' },
  { label: 'Arduino Nano', value: 'nano' },
  { label: 'Arduino Mega', value: 'mega' },
  { label: 'ESP32', value: 'esp' },
  { label: 'Arduino Leonardo', value: 'leo' }
]

const PORTS = [
  { label: 'COM3', value: 'COM3' },
  { label: 'COM4', value: 'COM4' },
  { label: 'COM5', value: 'COM5' }
]

export function BoardSelect(): React.JSX.Element {
  const [board, setBoard] = React.useState('uno')

  return (
    <Select value={board} onValueChange={setBoard}>
      <SelectTrigger size="sm" className="min-w-[120px]">
        <span className="text-xs">Board:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Boards</SelectLabel>
          {BOARDS.map((b) => (
            <SelectItem key={b.value} value={b.value}>
              {b.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function PortSelect(): React.JSX.Element {
  const [port, setPort] = React.useState('COM3')

  return (
    <Select value={port} onValueChange={setPort}>
      <SelectTrigger size="sm" className="min-w-[90px]">
        <span className="text-xs">Port:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Ports</SelectLabel>
          {PORTS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
