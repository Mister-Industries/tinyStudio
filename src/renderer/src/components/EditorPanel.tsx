import { useState, useCallback } from 'react'
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import { Blocks, CircuitBoard, Code } from 'lucide-react'
import { BlocklyEditor } from './BlocklyEditor'
import { MonacoEditor } from './MonacoEditor'
import { selectOpenFiles, useAppDispatch, useAppSelector } from '@renderer/redux'
import {
  closeFile,
  setViewingFile,
  updateFileContent,
  saveFileWithContent,
  selectViewingFileId
} from '@renderer/redux/fileSlice'
import { CircuitEditor } from './CircuitEditor'
import { FileTabs, FileTabsList, FileTabTrigger, FileTabContent } from './ui/FileTab'
import { fileSystem } from '@renderer/lib/fileSystem'
import { useFileSystem } from '@renderer/lib/useFileSystem'

loader.config({ monaco })

export function EditorPanel(): React.JSX.Element {
  const openFiles = useAppSelector(selectOpenFiles)
  const viewingFileId = useAppSelector(selectViewingFileId)
  const [editorMode, setEditorMode] = useState<'code' | 'blocks' | 'circuit'>('code')
  const dispatch = useAppDispatch()
  const { setCurrentFile } = useFileSystem()

  const handleFileSelect = (fileId: string): void => {
    dispatch(setViewingFile(fileId))

    // Find the file by ID to get its path and synchronize with FileExplorer
    const file = openFiles.find((f) => f.id === fileId)
    if (file && file.path) {
      setCurrentFile(file.path)
    }
  }

  const handleFileClose = (fileId: string): void => {
    dispatch(closeFile(fileId))
  }

  const handleContentChange = useCallback(
    (content: string, fileId: string) => {
      const file = openFiles.find((f) => f.id === fileId)
      if (file) {
        dispatch(updateFileContent({ id: file.id, content }))
      }
    },
    [openFiles, dispatch]
  )

  const handleSaveFile = async (content: string, fileId: string): Promise<void> => {
    const file = openFiles.find((f) => f.id === fileId)
    if (file && file.path) {
      try {
        console.log(`Saving file: ${file.name} (${file.id}) to ${file.path}`)
        await fileSystem.writeFile(file.path, content)
        // Save with content to ensure state is properly synced
        dispatch(saveFileWithContent({ id: file.id, content }))
        console.log(`Successfully saved: ${file.name}`)
      } catch (error) {
        console.error('Failed to save file:', error)
      }
    } else {
      console.error('Cannot save file: file path is undefined')
    }
  }

  // If no files are open, show a placeholder
  if (openFiles.length === 0) {
    return (
      <div className="flex size-full items-center justify-center text-muted-foreground">
        <p>No files open</p>
      </div>
    )
  }

  return (
    <div className="flex size-full flex-col">
      <FileTabs
        value={viewingFileId || undefined}
        onValueChange={handleFileSelect}
        className="flex-1"
      >
        <FileTabsList>
          <div className="flex">
            {openFiles.map((file) => (
              <FileTabTrigger
                key={file.id}
                value={file.id}
                file={file}
                onFileClose={handleFileClose}
              />
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
        </FileTabsList>
        {openFiles.map((file) => (
          <FileTabContent key={`content-${file.id}`} value={file.id}>
            {editorMode === 'blocks' ? (
              <BlocklyEditor />
            ) : editorMode === 'circuit' ? (
              <CircuitEditor />
            ) : (
              <MonacoEditor
                activeFile={file}
                onContentChange={(content) => handleContentChange(content, file.id)}
                onSaveFile={(content) => handleSaveFile(content, file.id)}
              />
            )}
          </FileTabContent>
        ))}
      </FileTabs>
    </div>
  )
}
