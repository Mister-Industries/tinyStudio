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
import { BookOpen, Monitor, RefreshCw, Save } from 'lucide-react'
import React from 'react'
import { UploadButton, VerifyButton } from './arduino/ArduinoButtons'
import { BoardManager } from './arduino/BoardManager'
import { PortPicker } from './arduino/BoardControls'
import { LibraryManager } from './arduino/LibraryManager'
import { Button } from './ui/Button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/Tooltip'
import { ViewSegment } from './ViewSegment'

export function Toolbar(): React.JSX.Element {
  const dispatch = useAppDispatch()
  const { isDocsPanelOpen, isSerialMonitorOpen } = useAppSelector(selectPanelState)
  const openFiles = useAppSelector(selectOpenFiles)
  const viewingFileId = useAppSelector((state) => state.file.viewingFileId)
  const { isAgentConnected, isLoadingBoards, refreshBoards } = useArduinoContext()

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

      <div className="ml-1 flex items-center gap-2">
        <BoardManager />
        <PortPicker />
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
        <LibraryManager />
      </div>

      <div className="flex-1" />

      <ViewSegment />

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
              <BookOpen size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Help and documentation</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
