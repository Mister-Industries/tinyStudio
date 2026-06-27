/**
 * BoardControls — the serial-port picker for the toolbar.
 *
 * The port pill chooses which detected serial port to upload to. The board
 * TYPE (FQBN) is chosen in the Boards Manager modal (see BoardManager.tsx);
 * together they form the `selectedBoard` the Verify/Upload buttons compile and
 * flash against.
 */

import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger
} from '@renderer/components/ui/Select'
import { useSerial } from '@renderer/contexts/SerialContext'
import { ChevronDown, Usb } from 'lucide-react'
import React from 'react'

const PILL =
  'h-[30px] flex items-center gap-[7px] px-2.5 rounded-[var(--radius-sm)] bg-[var(--surface-card)] border-[1.5px] border-[var(--border-default)] text-[13px] font-semibold text-[var(--text-strong)] hover:border-[var(--border-interactive)] transition-colors outline-none disabled:opacity-50'

export function PortPicker(): React.JSX.Element {
  const { boards, selectedBoard, setSelectedBoard, isAgentConnected } = useArduinoContext()
  const { disconnected, disconnect, reconnect } = useSerial()
  const [open, setOpen] = React.useState(false)

  // Unique detected ports (a port may match multiple boards).
  const ports = Array.from(new Set(boards.map((b) => b.port).filter(Boolean))) as string[]

  // The pill is "active" when a port is selected and we haven't released it.
  // In that state a click disconnects (frees the port) instead of opening the
  // dropdown; click again (now released) to open it and re-select a port.
  const isActive = Boolean(selectedBoard?.port) && !disconnected

  const handleChange = (value: string): void => {
    const port = value
    // Choosing a port re-enables the connection if the user had disconnected.
    if (disconnected) reconnect()
    // Prefer a detected board on that port (carries its guessed FQBN); else
    // just move the current board type to the chosen port.
    const detected = boards.find((b) => b.port === port)
    if (detected && (!selectedBoard || !selectedBoard.config.fqbn)) {
      setSelectedBoard(detected)
    } else if (selectedBoard) {
      setSelectedBoard({ ...selectedBoard, port })
    } else if (detected) {
      setSelectedBoard(detected)
    }
  }

  return (
    <Select
      open={open}
      onOpenChange={setOpen}
      // While released we clear the value so re-selecting the SAME port still
      // fires onValueChange (and reconnects); otherwise Radix swallows it.
      value={disconnected ? '' : selectedBoard?.port || ''}
      onValueChange={handleChange}
      disabled={!isAgentConnected}
    >
      <SelectTrigger size="sm"
        className={`${PILL} [&>svg]:hidden`}
        onPointerDown={(e) => {
          // Active = connected: a click disconnects rather than opening the menu.
          // Radix composes our handler first and skips its own open logic when
          // we preventDefault, so this swallows the open.
          if (isActive) {
            e.preventDefault()
            disconnect()
          }
        }}
      >
        <Usb size={14} className={disconnected ? 'text-fg-4' : 'text-fg-3'} />
        {selectedBoard?.port || <span className="text-fg-3 font-medium">No port</span>}
        {disconnected && <span className="text-[11px] font-medium text-fg-4">released</span>}
        <ChevronDown size={14} className="text-fg-4" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Serial port</SelectLabel>
          {ports.length === 0 && (
            <SelectItem value="none" disabled>
              No ports detected
            </SelectItem>
          )}
          {ports.map((port) => {
            const board = boards.find((b) => b.port === port)
            return (
              <SelectItem key={port} value={port}>
                {port}
                {board?.config.name && (
                  <span className="text-[11px] text-muted-foreground ml-1">
                    {board.config.name}
                  </span>
                )}
              </SelectItem>
            )
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
