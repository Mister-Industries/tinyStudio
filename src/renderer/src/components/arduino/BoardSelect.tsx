/**
 * BoardSelect - Arduino board selection component
 */

import { Button } from '@renderer/components/ui/Button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/Select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/Tooltip'
import { useArduino } from '@renderer/hooks/useArduino'
import { Board } from '@renderer/services/arduino/types'
import { RefreshCw } from 'lucide-react'
import React from 'react'

export interface BoardSelectProps {
  /** Custom className for styling */
  className?: string
  /** Whether to show refresh button */
  showRefresh?: boolean
  /** Size variant */
  size?: 'sm' | 'default'
}

/**
 * Arduino board selection component with refresh functionality
 */
export function BoardSelect({
  className,
  showRefresh = true,
  size = 'sm'
}: BoardSelectProps): React.JSX.Element {
  const {
    boards,
    selectedBoard,
    setSelectedBoard,
    refreshBoards,
    isLoadingBoards,
    isAgentConnected
  } = useArduino()

  const handleBoardChange = (value: string): void => {
    if (value === 'none') {
      setSelectedBoard(null)
      return
    }

    const board = boards.find((b) => `${b.port}:${b.config.fqbn}` === value)
    if (board) {
      setSelectedBoard(board)
    }
  }

  const getBoardValue = (board: Board | null): string => {
    if (!board) return 'none'
    return `${board.port}:${board.config.fqbn}`
  }

  const getBoardDisplayName = (board: Board): string => {
    return `${board.config.name} (${board.port})`
  }

  return (
    <div className={`flex items-center gap-2 ${className || ''}`}>
      <Select
        value={getBoardValue(selectedBoard)}
        onValueChange={handleBoardChange}
        disabled={!isAgentConnected || isLoadingBoards}
      >
        <SelectTrigger
          size={size}
          className={`min-w-[140px] ${!isAgentConnected ? 'opacity-50' : ''}`}
        >
          <span className="text-xs">Board:</span>
          <SelectValue placeholder="Select board..." />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Arduino Boards</SelectLabel>
            {!isAgentConnected && (
              <SelectItem value="none" disabled>
                Arduino Agent not connected
              </SelectItem>
            )}
            {isAgentConnected && boards.length === 0 && !isLoadingBoards && (
              <SelectItem value="none" disabled>
                No boards found
              </SelectItem>
            )}
            {isLoadingBoards && (
              <SelectItem value="none" disabled>
                Scanning for boards...
              </SelectItem>
            )}
            {boards.length > 0 && <SelectItem value="none">None selected</SelectItem>}
            {boards.map((board) => (
              <SelectItem key={getBoardValue(board)} value={getBoardValue(board)}>
                {getBoardDisplayName(board)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {showRefresh && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refreshBoards()}
              disabled={!isAgentConnected || isLoadingBoards}
              className={`${size === 'sm' ? 'h-8 w-8' : ''} ${!isAgentConnected ? 'opacity-50' : ''}`}
            >
              <RefreshCw className={`h-4 w-4 ${isLoadingBoards ? 'animate-spin' : ''}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {isLoadingBoards ? 'Scanning...' : 'Refresh boards'}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

/**
 * Simple port selector component (for backward compatibility)
 */
export function PortSelect(): React.JSX.Element {
  const { selectedBoard } = useArduino()

  return (
    <Select value={selectedBoard?.port || ''} disabled>
      <SelectTrigger size="sm" className="min-w-[90px] opacity-50">
        <span className="text-xs">Port:</span>
        <SelectValue placeholder="Auto" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Ports</SelectLabel>
          <SelectItem value="port">{selectedBoard?.port || 'Auto'}</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
