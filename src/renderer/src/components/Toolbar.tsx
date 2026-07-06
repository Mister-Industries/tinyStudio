import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import { fileSystem } from '@renderer/lib/fileSystem'
import {
  saveFileWithContent,
  selectOpenFiles,
  useAppDispatch,
  useAppSelector
} from '@renderer/redux'
import { RefreshCw, Save } from 'lucide-react'
import React from 'react'
import { UploadButton, VerifyButton } from './arduino/ArduinoButtons'
import { BoardManager } from './arduino/BoardManager'
import { PortPicker } from './arduino/BoardControls'
import { LibraryManager } from './arduino/LibraryManager'
import { IconButton } from './ui/IconButton'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/Tooltip'
import { ViewSegment } from './ViewSegment'

export function Toolbar(): React.JSX.Element {
  const dispatch = useAppDispatch()
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
    <div className="px-3 h-[54px] shrink-0 flex items-center gap-2 bg-[var(--bg-raised)] border-b-[1.5px] border-[var(--border-default)]">
      <div className="flex items-center gap-2">
        <VerifyButton variant="default" size="sm" />
        <UploadButton variant="success" size="sm" />
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton label="Save" size="sm" onClick={handleSaveFile}>
              <Save size={15} />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">Save</TooltipContent>
        </Tooltip>
      </div>

      <span
        data-toolbar-divider
        className="w-[1.5px] h-[26px] bg-[var(--border-default)] mx-0.5 shrink-0"
      />

      <div className="flex items-center gap-2">
        <BoardManager />
        <PortPicker />
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              label={isLoadingBoards ? 'Scanning…' : 'Refresh boards'}
              size="sm"
              variant="ghost"
              onClick={() => refreshBoards()}
              disabled={!isAgentConnected || isLoadingBoards}
            >
              <RefreshCw size={15} className={isLoadingBoards ? 'animate-spin' : ''} />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {isLoadingBoards ? 'Scanning...' : 'Refresh boards'}
          </TooltipContent>
        </Tooltip>
        <LibraryManager />
      </div>

      <div className="flex-1" />

      <ViewSegment />
    </div>
  )
}
