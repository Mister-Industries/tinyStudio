/**
 * BoardControls — board-type and serial-port pickers for the toolbar.
 *
 * The board pill chooses the target board TYPE (FQBN) from a known list; the
 * port pill chooses which detected serial port to upload to. Together they form
 * the `selectedBoard` the Verify/Upload buttons compile and flash against, so
 * the user can correct a misidentified clone (e.g. a CH340 board the service
 * guessed as an Uno) or pick a board when only a bare serial port was detected.
 */

import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import { Board, COMMON_BOARDS } from '@renderer/services/arduino/types'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger
} from '@renderer/components/ui/Select'
import { ChevronDown, Cpu, Usb } from 'lucide-react'
import React from 'react'

const PILL =
  'h-9 flex items-center gap-2 px-3.5 rounded-full bg-navy-700/60 border border-navy-400 text-[13px] font-semibold text-fg-1 hover:bg-navy-500 transition-colors outline-none disabled:opacity-50'

export function BoardPicker(): React.JSX.Element {
  const { selectedBoard, setSelectedBoard, isAgentConnected } = useArduinoContext()

  const isConnected = isAgentConnected && selectedBoard !== null

  const handleChange = (fqbn: string): void => {
    const config = COMMON_BOARDS[fqbn]
    if (!config) return
    // Keep the currently selected port; only swap the board type/FQBN.
    setSelectedBoard({
      port: selectedBoard?.port || '',
      config,
      connected: selectedBoard?.connected ?? false
    } as Board)
  }

  return (
    <Select value={selectedBoard?.config.fqbn || ''} onValueChange={handleChange}>
      <SelectTrigger className={`${PILL} [&>svg]:hidden`}>
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={
            isConnected
              ? { background: 'var(--signal-success)', boxShadow: '0 0 8px var(--signal-success)' }
              : { background: 'var(--fg-4)' }
          }
        />
        <Cpu size={14} className="text-fg-3" />
        {selectedBoard?.config.name ? (
          <>
            {selectedBoard.config.name}
            {selectedBoard.config.architecture && (
              <span className="text-[11px] font-medium text-fg-3">
                {selectedBoard.config.architecture}
              </span>
            )}
          </>
        ) : (
          <span className="text-fg-3 font-medium">Select board</span>
        )}
        <ChevronDown size={14} className="text-fg-4" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Board</SelectLabel>
          {Object.values(COMMON_BOARDS).map((b) => (
            <SelectItem key={b.fqbn} value={b.fqbn}>
              {b.name}
              <span className="text-[11px] text-muted-foreground ml-1">{b.architecture}</span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function PortPicker(): React.JSX.Element {
  const { boards, selectedBoard, setSelectedBoard, isAgentConnected } = useArduinoContext()

  // Unique detected ports (a port may match multiple boards).
  const ports = Array.from(new Set(boards.map((b) => b.port).filter(Boolean))) as string[]

  const handleChange = (port: string): void => {
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
      value={selectedBoard?.port || ''}
      onValueChange={handleChange}
      disabled={!isAgentConnected}
    >
      <SelectTrigger className={`${PILL} [&>svg]:hidden`}>
        <Usb size={14} className="text-fg-3" />
        {selectedBoard?.port || <span className="text-fg-3 font-medium">No port</span>}
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
