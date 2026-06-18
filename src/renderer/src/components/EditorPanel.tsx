import { loader } from '@monaco-editor/react'
import tinyLogo from '@renderer/assets/tinyLogo.png'
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
import { OpenWorkspaceCommand } from '@renderer/commands/fileCommands'
import { selectEditorView } from '@renderer/redux/editorSlice'
import { Code, Eye, FolderOpen } from 'lucide-react'
import * as monaco from 'monaco-editor'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BlocklyEditor } from './BlocklyEditor'
import { Button } from './ui/Button'
import { CircuitEditor } from './CircuitEditor'
import { DiagramEditor } from './DiagramEditor'
import { MonacoEditor, MonacoEditorRef } from './MonacoEditor'
import { FileTabContent, FileTabs, FileTabsList, FileTabTrigger } from './ui/FileTab'
import { Switch } from './ui/Switch'
import { VisualPreview } from './VisualPreview'

loader.config({ monaco })

export function EditorPanel({ size }: { size: number }): React.JSX.Element {
  const openFiles = useAppSelector(selectOpenFiles)
  const viewingFileId = useAppSelector(selectViewingFileId)
  const editorMode = useAppSelector((state) => state.editor.editorMode)
  const editorView = useAppSelector(selectEditorView)
  const dispatch = useAppDispatch()
  const monacoEditorRef = useRef<MonacoEditorRef>(null)
  const pixelSize = Math.round((size / 100) * (window.innerHeight - 92))
  // Track which SVG files should show visual editor (true) vs code editor (false)
  const [svgViewMode, setSvgViewMode] = useState<Record<string, boolean>>({})

  const handleFileClose = useCallback(
    (fileId: string): void => {
      dispatch(closeFile(fileId))
    },
    [dispatch]
  )

  const handleFileSelect = useCallback(
    (fileId: string): void => {
      dispatch(setViewingFile(fileId))
      // Focus the Monaco editor after a short delay to ensure it's rendered
      setTimeout(() => {
        if (monacoEditorRef.current && editorMode !== 'blocks') {
          monacoEditorRef.current.focus()
        }
      }, 50)
    },
    [dispatch, editorMode]
  )

  const toggleSvgViewMode = useCallback((fileId: string) => {
    setSvgViewMode((prev) => ({ ...prev, [fileId]: !prev[fileId] }))
  }, [])

  // Add keyboard listeners for file navigation and closing
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Ctrl/Cmd + W to close current file
      if ((event.metaKey || event.ctrlKey) && event.key === 'w') {
        event.preventDefault()
        if (viewingFileId) {
          handleFileClose(viewingFileId)
        }
      }

      // Ctrl + Tab to focus next tab, Ctrl + Shift + Tab to focus previous tab
      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault()
        if (openFiles.length > 1) {
          const currentIndex = openFiles.findIndex((file) => file.id === viewingFileId)
          let nextIndex: number

          if (event.shiftKey) {
            // Go to previous tab
            nextIndex = currentIndex <= 0 ? openFiles.length - 1 : currentIndex - 1
          } else {
            // Go to next tab
            nextIndex = (currentIndex + 1) % openFiles.length
          }

          const targetFile = openFiles[nextIndex]
          if (targetFile) {
            handleFileSelect(targetFile.id)
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [viewingFileId, handleFileClose, openFiles, handleFileSelect])

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

  return (
    <div className="flex flex-col" style={{ height: `${pixelSize}px` }}>
      <FileTabs
        value={viewingFileId || undefined}
        onValueChange={handleFileSelect}
        className="h-full"
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
        </FileTabsList>
        {openFiles.length > 0 ? (
          openFiles.map((file) => {
            const isSvg = fileSystem.isSvgFile(file.name)
            const showVisualEditor = isSvg && svgViewMode[file.id] !== false // Default to visual for SVG
            const isDiagram = file.name === 'diagram.json'
            const isJs = /\.js$/i.test(file.name)
            // .js files render as a live p5 sketch when the Visual view is active;
            // otherwise they're editable code.
            const showVisual = isJs && editorView === 'visual'

            return (
              <FileTabContent key={`content-${file.id}`} value={file.id}>
                {isSvg && (
                  <div className="absolute top-4 left-4 z-50 flex items-center gap-2 bg-background/95 backdrop-blur-sm border border-border rounded-lg px-3 py-2 shadow-lg">
                    <Code
                      size={16}
                      className={!showVisualEditor ? 'text-primary' : 'text-muted-foreground'}
                    />
                    <Switch
                      checked={showVisualEditor}
                      onCheckedChange={() => toggleSvgViewMode(file.id)}
                    />
                    <Eye
                      size={16}
                      className={showVisualEditor ? 'text-primary' : 'text-muted-foreground'}
                    />
                  </div>
                )}
                {isDiagram ? (
                  <DiagramEditor
                    content={file.content}
                    onChange={(content) => handleContentChange(content, file.id)}
                  />
                ) : showVisual ? (
                  <VisualPreview code={file.content} name={file.name} />
                ) : isSvg && showVisualEditor ? (
                  <CircuitEditor svgContent={file.content} />
                ) : editorMode === 'blocks' ? (
                  <BlocklyEditor />
                ) : (
                  <MonacoEditor
                    ref={monacoEditorRef}
                    activeFile={file}
                    onContentChange={(content) => handleContentChange(content, file.id)}
                    onSaveFile={(content) => handleSaveFile(content, file.id)}
                  />
                )}
              </FileTabContent>
            )
          })
        ) : (
          <div className="size-full flex flex-col items-center justify-center text-sm gap-5">
            <div
              className="size-40"
              style={{
                backgroundColor: 'var(--navy-500)',
                mask: `url(${tinyLogo}) no-repeat center/contain`,
                WebkitMask: `url(${tinyLogo}) no-repeat center/contain`
              }}
            />
            <div className="text-center">
              <div className="text-fg-1 text-base font-semibold">No project open</div>
              <div className="text-fg-3 text-xs mt-1">Open a folder to start building.</div>
            </div>
            <Button
              size="lg"
              className="rounded-full px-6 shadow-[0_0_18px_rgba(0,240,255,0.25)]"
              onClick={() => new OpenWorkspaceCommand(undefined).execute()}
            >
              <FolderOpen size={16} /> Open Folder
            </Button>
          </div>
        )}
      </FileTabs>
    </div>
  )
}
