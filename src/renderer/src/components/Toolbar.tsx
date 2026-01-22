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
import { Lightbulb, Monitor, RefreshCw, Save } from 'lucide-react'
import React from 'react'
import { UploadButton, VerifyButton } from './arduino/ArduinoButtons'
import { Button } from './ui/Button'
import { Separator } from './ui/Separator'
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
    <div className="px-4 py-3 h-14 flex items-center justify-between shadow-sm bg-primary text-primary-foreground">
      <div className="flex items-center gap-2 h-full">
        {/* <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={handleNewFile}>
              <File />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New File</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={handleNewFolder}>
              <Folder />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New Folder</TooltipContent>
        </Tooltip> */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={handleSaveFile}>
              <Save />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Save</TooltipContent>
        </Tooltip>
        {/* <Tooltip>
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
        </Tooltip> */}
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
        {/* <div className="flex items-center gap-2 pr-4">
          <Code />
          <Switch
            checked={isBlocksMode}
            onCheckedChange={(checked) => dispatch(setEditorMode(checked ? 'blocks' : 'code'))}
          />
          <Blocks />
        </div> */}
        {/* <BoardSelect />
        <PortSelect /> */}
        <BoardConnectionStatus isConnected={isBoardConnected} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refreshBoards()}
              disabled={!isAgentConnected || isLoadingBoards}
              className={`${!isAgentConnected ? 'opacity-50' : ''}`}
            >
              <RefreshCw className={`h-4 w-4 ${isLoadingBoards ? 'animate-spin' : ''}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {isLoadingBoards ? 'Scanning...' : 'Refresh boards'}
          </TooltipContent>
        </Tooltip>
        <VerifyButton />
        <UploadButton />
      </div>
    </div>
  )
}

function BoardConnectionStatus({ isConnected }: { isConnected: boolean }): React.JSX.Element {
  const { selectedBoard } = useArduinoContext()

  if (!isConnected || !selectedBoard) {
    return (
      <div className="text-sm text-secondary-foreground px-2 py-1 rounded bg-background/10 text-center flex items-center">
        No board connected
      </div>
    )
  }

  return (
    <div
      className="text-sm text-secondary-foreground
     px-2 py-1 rounded bg-background/10 flex items-center gap-1"
    >
      <div className="w-2 h-2 rounded-full bg-green-400"></div>
      tinyCore Connected
    </div>
  )
}
