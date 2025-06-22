import { useState, useEffect } from 'react'
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import { Blocks, Code } from 'lucide-react'
import { BlocklyEditor } from './BlocklyEditor'
import { MonacoEditor } from './MonacoEditor'
import { selectOpenFiles, useAppSelector } from '@renderer/redux'
import { EditorFile } from '@renderer/redux/fileSlice'

loader.config({ monaco })

// export interface ArduinoFile {
//   id: string
//   name: string
//   content: string
//   fileHandle?: FileSystemFileHandle
//   modified: boolean
//   createdAt: string
//   updatedAt: string
// }

export function EditorPanel(): React.JSX.Element {
  const openFiles = useAppSelector(selectOpenFiles)
  const [viewingFile, setViewingFile] = useState<EditorFile | null>(openFiles[0] ?? null)
  const [isBlocks, setIsBlocks] = useState<boolean>(false)

  // Update viewingFile when openFiles changes
  useEffect(() => {
    if (openFiles.length === 0) {
      setViewingFile(null)
    } else if (viewingFile === null || !openFiles.find((file) => file.id === viewingFile.id)) {
      // If no file is selected or the current file is no longer open, select the first one
      setViewingFile(openFiles[0])
    }
  }, [openFiles, viewingFile])

  const handleFileSelect = (file: EditorFile): void => {
    setViewingFile(file)
  }

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
              className="text-xs justify-start px-4 py-2 border-b border-transparent data-[active=true]:bg-muted data-[active=true]:border-b data-[active=true]:border-primary hover:bg-muted/50 transition-colors cursor-pointer"
              onClick={() => handleFileSelect(file)}
            >
              {file.name}
            </div>
          ))}
        </div>
        <div className="flex">
          <button
            data-active={isBlocks == false}
            onClick={() => setIsBlocks(false)}
            className="flex items-center gap-2 p-2 hover:bg-accent/50 hover:text-accent-foreground data-[active=true]:bg-accent/50 data-[active=true]:text-accent-foreground data-[active=true]:border-b data-[active=true]:border-primary"
          >
            <Code />
            Code
          </button>
          <button
            data-active={isBlocks == true}
            onClick={() => setIsBlocks(true)}
            className="flex items-center gap-2 p-2 hover:bg-accent/50 hover:text-accent-foreground data-[active=true]:bg-accent/50 data-[active=true]:text-accent-foreground data-[active=true]:border-b data-[active=true]:border-primary"
          >
            <Blocks />
            Blocks
          </button>
        </div>
      </div>
      {isBlocks && viewingFile !== null ? (
        <BlocklyEditor />
      ) : viewingFile !== null ? (
        <MonacoEditor activeFile={viewingFile} />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <p>Select a file to edit</p>
        </div>
      )}
    </div>
  )
}
