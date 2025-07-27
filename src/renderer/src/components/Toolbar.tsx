import {
  Blocks,
  Check,
  Code,
  File,
  Folder,
  Library,
  Lightbulb,
  Monitor,
  Save,
  Upload
} from 'lucide-react'
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
import {
  selectPanelState,
  setEditorMode,
  setPanelOpen,
  useAppDispatch,
  useAppSelector
} from '@renderer/redux'
import { Switch } from './ui/Switch'

export function Toolbar(): React.JSX.Element {
  const dispatch = useAppDispatch()
  const { isDocsPanelOpen, isSerialMonitorOpen } = useAppSelector(selectPanelState)
  const isBlocksMode = useAppSelector((state) => state.editor.editorMode === 'blocks')

  return (
    <div className="px-4 py-3 h-14 flex items-center justify-between shadow-sm bg-primary text-primary-foreground">
      <div className="flex items-center gap-2 h-full">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon">
              <File />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New File</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon">
              <Folder />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New Folder</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon">
              <Save />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Save</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="data-[active=true]:bg-popover data-[active=true]:text-popover-foreground"
            >
              <Library />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Add Libraries</TooltipContent>
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
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-active={isSerialMonitorOpen}
              className="data-[active=true]:bg-popover data-[active=true]:text-popover-foreground"
              onClick={() =>
                dispatch(setPanelOpen({ panel: 'monitor', isOpen: !isSerialMonitorOpen }))
              }
            >
              <Monitor />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Monitor</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-active={isDocsPanelOpen}
              className="data-[active=true]:bg-popover data-[active=true]:text-popover-foreground"
              onClick={() => dispatch(setPanelOpen({ panel: 'docs', isOpen: !isDocsPanelOpen }))}
            >
              <Lightbulb />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Documentation</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex gap-2">
        <div className="flex items-center gap-2 pr-4">
          <Code />
          <Switch
            checked={isBlocksMode}
            onCheckedChange={(checked) => dispatch(setEditorMode(checked ? 'blocks' : 'code'))}
          />
          <Blocks />
        </div>
        <BoardSelect />
        <PortSelect />
      </div>
    </div>
  )
}

const BOARDS = [
  { label: 'tinyCore', value: 'tiny' },
  { label: 'ESP32', value: 'esp' }
]

const PORTS = [
  { label: 'COM3', value: 'COM3' },
  { label: 'COM4', value: 'COM4' },
  { label: 'COM5', value: 'COM5' }
]

export function BoardSelect(): React.JSX.Element {
  const [board, setBoard] = React.useState('tiny')

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
