import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import { fileSystem } from '@renderer/lib/fileSystem'
import {
  saveFileWithContent,
  selectOpenFiles,
  selectPanelState,
  setPanelOpen,
  useAppDispatch,
  useAppSelector
} from '@renderer/redux'
import { ChevronDown, FileText, Monitor, RefreshCw, Save, Usb } from 'lucide-react'
import React from 'react'
import { UploadButton, VerifyButton } from './arduino/ArduinoButtons'
import { Button } from './ui/Button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/Tooltip'

export function Toolbar(): React.JSX.Element {
  const dispatch = useAppDispatch()
  const { isDocsPanelOpen, isSerialMonitorOpen } = useAppSelector(selectPanelState)
  const openFiles = useAppSelector(selectOpenFiles)
  const viewingFileId = useAppSelector((state) => state.file.viewingFileId)
  const { selectedBoard, isAgentConnected, isLoadingBoards, refreshBoards } = useArduinoContext()

  // Board is connected if we have an agent connection and a selected board
  const isBoardConnected = isAgentConnected && selectedBoard !== null

  const handleSaveFile = async (): Promise<void> => {
    const file = openFiles.find((f) => f.id === viewingFileId)
    if (file && file.path) {
      try {
        console.log(`Saving file: ${file.name} (${file.id}) to ${file.path}`)
        await fileSystem.writeFile(file.path, file.content)
        // Save with content to ensure state is properly synced
        dispatch(saveFileWithContent({ id: file.id, content: file.content }))
        console.log(`Successfully saved: ${file.name}`)
      } catch (error) {
        console.error('Failed to save file:', error)
      }
    } else {
      console.error('Cannot save file: file path is undefined')
    }
  }

  return (
    <div className="px-3 py-2 h-13 shrink-0 flex items-center gap-2 bg-navy-800 border-b border-navy-600">
      <VerifyButton
        variant="ghost"
        className="rounded-full h-9 px-4 border border-navy-400 bg-navy-700/60 text-fg-1 hover:bg-navy-500 hover:text-fg-1 text-[13px] font-semibold"
      />
      <UploadButton
        variant="default"
        className="rounded-full h-9 px-4 text-[13px] font-bold shadow-[0_0_18px_rgba(0,240,255,0.25)] hover:bg-cyan-bright"
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-fg-3 hover:text-fg-1 hover:bg-navy-500"
            onClick={handleSaveFile}
          >
            <Save />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Save</TooltipContent>
      </Tooltip>

      <BoardConnectionStatus isConnected={isBoardConnected} />
      <PortStatus />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refreshBoards()}
            disabled={!isAgentConnected || isLoadingBoards}
            className={`rounded-full text-fg-3 hover:text-fg-1 hover:bg-navy-500 ${!isAgentConnected ? 'opacity-50' : ''}`}
          >
            <RefreshCw className={`h-4 w-4 ${isLoadingBoards ? 'animate-spin' : ''}`} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {isLoadingBoards ? 'Scanning...' : 'Refresh boards'}
        </TooltipContent>
      </Tooltip>

      <div className="flex-1" />

      <div className="flex items-center gap-1 p-1 rounded-full bg-navy-900 border border-navy-600">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              data-active={isSerialMonitorOpen}
              className="rounded-full h-7 px-3 text-xs text-fg-3 hover:bg-navy-500 hover:text-fg-1 data-[active=true]:bg-navy-500 data-[active=true]:text-fg-1"
              onClick={() =>
                dispatch(setPanelOpen({ panel: 'monitor', isOpen: !isSerialMonitorOpen }))
              }
            >
              <Monitor size={14} />
              Monitor
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Serial monitor & output</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              data-active={isDocsPanelOpen}
              className="rounded-full h-7 px-3 text-xs text-fg-3 hover:bg-navy-500 hover:text-fg-1 data-[active=true]:bg-navy-500 data-[active=true]:text-fg-1"
              onClick={() => dispatch(setPanelOpen({ panel: 'docs', isOpen: !isDocsPanelOpen }))}
            >
              <FileText size={14} />
              Docs
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Help and documentation</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

function BoardConnectionStatus({ isConnected }: { isConnected: boolean }): React.JSX.Element {
  const { selectedBoard } = useArduinoContext()

  return (
    <div className="ml-2 h-9 flex items-center gap-2 px-3.5 rounded-full bg-navy-700/60 border border-navy-400 text-[13px] font-semibold text-fg-1">
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={
          isConnected
            ? { background: 'var(--signal-success)', boxShadow: '0 0 8px var(--signal-success)' }
            : { background: 'var(--fg-4)' }
        }
      />
      {isConnected && selectedBoard ? (
        <>
          {selectedBoard.config.name}
          {selectedBoard.config.architecture && (
            <span className="text-[11px] font-medium text-fg-3">
              {selectedBoard.config.architecture}
            </span>
          )}
        </>
      ) : (
        <span className="text-fg-3 font-medium">No board connected</span>
      )}
      <ChevronDown size={14} className="text-fg-4" />
    </div>
  )
}

function PortStatus(): React.JSX.Element {
  const { selectedBoard } = useArduinoContext()

  return (
    <div className="h-9 flex items-center gap-2 px-3.5 rounded-full bg-navy-700/60 border border-navy-400 text-[13px] font-semibold text-fg-1">
      <Usb size={14} className="text-fg-3" />
      {selectedBoard?.port || <span className="text-fg-3 font-medium">No port</span>}
      <ChevronDown size={14} className="text-fg-4" />
    </div>
  )
}
