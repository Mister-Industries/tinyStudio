import { loader } from '@monaco-editor/react'
import { fileSystem } from '@renderer/lib/fileSystem'
import { selectOpenFiles, useAppDispatch, useAppSelector } from '@renderer/redux'
import {
  closeFile,
  saveFileWithContent,
  selectViewingFileId,
  setViewingFile,
  updateFileContent,
  updateReadmeContent
} from '@renderer/redux/fileSlice'
import { CircuitBoard } from 'lucide-react'
import * as monaco from 'monaco-editor'
import { useCallback, useEffect, useState } from 'react'
import { BlocklyEditor } from './BlocklyEditor'
import { CircuitEditor } from './CircuitEditor'
import { MonacoEditor } from './MonacoEditor'
import { FileTabContent, FileTabs, FileTabsList, FileTabTrigger } from './ui/FileTab'

loader.config({ monaco })

export function EditorPanel(): React.JSX.Element {
  const openFiles = useAppSelector(selectOpenFiles)
  const viewingFileId = useAppSelector(selectViewingFileId)
  const editorMode = useAppSelector((state) => state.editor.editorMode)
  const dispatch = useAppDispatch()
  const [showCircuit, setShowCircuit] = useState(false)

  const handleFileClose = useCallback(
    (fileId: string): void => {
      dispatch(closeFile(fileId))
    },
    [dispatch]
  )

  // Add keyboard listener for Ctrl/Cmd + W to close current file
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'w') {
        event.preventDefault()
        if (viewingFileId) {
          handleFileClose(viewingFileId)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [viewingFileId, handleFileClose])

  const handleFileSelect = (fileId: string): void => {
    dispatch(setViewingFile(fileId))

    // Find the file by ID to get its path and synchronize with FileExplorer
    const file = openFiles.find((f) => f.id === fileId)
    if (file && file.path) {
      // setCurrentFile(file.path)
    }
  }

  const handleContentChange = useCallback(
    (content: string, fileId: string) => {
      const file = openFiles.find((f) => f.id === fileId)
      if (file) {
        dispatch(updateFileContent({ id: file.id, content }))
        if (file.name === 'README.md') {
          dispatch(updateReadmeContent(content))
        }
      }
    },
    [openFiles, dispatch]
  )

  const handleSaveFile = async (content: string, fileId: string): Promise<void> => {
    const file = openFiles.find((f) => f.id === fileId)
    console.log(file)
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
              data-active={showCircuit}
              onClick={() => setShowCircuit(!showCircuit)}
              className="flex items-center gap-2 p-2 hover:bg-accent/50 hover:text-accent-foreground data-[active=true]:bg-accent/50 data-[active=true]:text-accent-foreground data-[active=true]:border-b data-[active=true]:border-primary"
            >
              <CircuitBoard />
              Circuit
            </button>
          </div>
        </FileTabsList>
        {openFiles.map((file) => (
          <FileTabContent key={`content-${file.id}`} value={file.id}>
            {showCircuit ? (
              <CircuitEditor />
            ) : editorMode === 'blocks' ? (
              <BlocklyEditor />
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
