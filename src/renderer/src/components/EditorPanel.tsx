import { useState, useCallback } from 'react'
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import { Blocks, CircuitBoard, Code, X } from 'lucide-react'
import { BlocklyEditor } from './BlocklyEditor'
import { MonacoEditor } from './MonacoEditor'
import { selectOpenFiles, selectViewingFile, useAppDispatch, useAppSelector } from '@renderer/redux'
import {
  closeFile,
  setViewingFile,
  EditorFile,
  updateFileContent,
  saveFileWithContent
} from '@renderer/redux/fileSlice'
import { Button } from './ui/Button'
import { fileSystem } from '../lib/fileSystem'
import { CircuitEditor } from './CircuitEditor'

loader.config({ monaco })

export function EditorPanel(): React.JSX.Element {
  const openFiles = useAppSelector(selectOpenFiles)
  const viewingFile = useAppSelector(selectViewingFile)
  const [editorMode, setEditorMode] = useState<'code' | 'blocks' | 'circuit'>('code')
  const dispatch = useAppDispatch()

  const handleFileSelect = (file: EditorFile): void => {
    dispatch(setViewingFile(file.id))
  }

  const handleFileClose = (file: EditorFile): void => {
    dispatch(closeFile(file.id))
  }

  const handleContentChange = useCallback(
    (content: string) => {
      if (viewingFile) {
        console.log(`Content changed for: ${viewingFile.name} (${viewingFile.id})`)
        dispatch(updateFileContent({ id: viewingFile.id, content }))
      }
    },
    [viewingFile, dispatch]
  )

  const handleSaveFile = useCallback(
    async (content: string) => {
      if (viewingFile?.path) {
        try {
          console.log(`Saving file: ${viewingFile.name} (${viewingFile.id}) to ${viewingFile.path}`)
          console.log(`Content length: ${content.length}`)
          await fileSystem.writeFile(viewingFile.path, content)
          // Save with content to ensure state is properly synced
          dispatch(saveFileWithContent({ id: viewingFile.id, content }))
          console.log(`Successfully saved: ${viewingFile.name}`)
        } catch (error) {
          console.error('Failed to save file:', error)
        }
      }
    },
    [viewingFile, dispatch]
  )

  // If no files are open, show a placeholder
  if (openFiles.length === 0) {
    return (
      <div className="flex size-full items-center justify-center text-muted-foreground">
        <p>No files open</p>
      </div>
    )
  }

  // TODO: Implement better logic for the tabs
  // TODO: Make this a controlled component so that we can manage via state
  return (
    <div className="flex size-full flex-col">
      <div className="flex w-full border-b border-border justify-between">
        <div className="flex w-full">
          {openFiles.map((file) => (
            <div
              data-active={viewingFile?.id === file.id}
              key={file.id}
              className="text-xs justify-start px-4 py-2 border-b border-transparent data-[active=true]:bg-muted data-[active=true]:border-b data-[active=true]:border-primary hover:bg-muted/50 transition-colors cursor-pointer flex items-center gap-2"
              onClick={() => handleFileSelect(file)}
            >
              <span>{file.name}</span>
              {file.modified && (
                <span className="w-2 h-2 bg-orange-500 rounded-full" title="Unsaved changes" />
              )}
              <Button variant="ghost" className="size-4 p-0" onClick={() => handleFileClose(file)}>
                <X size={10} />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex">
          <button
            data-active={editorMode === 'circuit'}
            onClick={() => setEditorMode('circuit')}
            className="flex items-center gap-2 p-2 hover:bg-accent/50 hover:text-accent-foreground data-[active=true]:bg-accent/50 data-[active=true]:text-accent-foreground data-[active=true]:border-b data-[active=true]:border-primary"
          >
            <CircuitBoard />
            Circuit
          </button>
          <button
            data-active={editorMode === 'code'}
            onClick={() => setEditorMode('code')}
            className="flex items-center gap-2 p-2 hover:bg-accent/50 hover:text-accent-foreground data-[active=true]:bg-accent/50 data-[active=true]:text-accent-foreground data-[active=true]:border-b data-[active=true]:border-primary"
          >
            <Code />
            Code
          </button>
          <button
            data-active={editorMode === 'blocks'}
            onClick={() => setEditorMode('blocks')}
            className="flex items-center gap-2 p-2 hover:bg-accent/50 hover:text-accent-foreground data-[active=true]:bg-accent/50 data-[active=true]:text-accent-foreground data-[active=true]:border-b data-[active=true]:border-primary"
          >
            <Blocks />
            Blocks
          </button>
        </div>
      </div>
      {editorMode === 'blocks' && viewingFile !== null ? (
        <BlocklyEditor />
      ) : editorMode === 'circuit' && viewingFile !== null ? (
        <CircuitEditor />
      ) : viewingFile !== null ? (
        <MonacoEditor
          activeFile={viewingFile}
          onContentChange={handleContentChange}
          onSaveFile={handleSaveFile}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <p>Select a file to edit</p>
        </div>
      )}
    </div>
  )
}
