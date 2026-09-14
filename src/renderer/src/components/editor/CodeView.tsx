// Code view: the normal tabbed IDE.

import { promptSaveToComputer } from '@renderer/commands/fileCommands'
import { useIsReadOnlyProject } from '@renderer/hooks/useIsReadOnlyProject'
import { fileSystem } from '@renderer/lib/fileSystem'
import { notify as toast } from '@renderer/lib/notify'
import { isVirtualPath } from '@renderer/lib/virtualFileSystem'
import { selectOpenFiles, useAppDispatch, useAppSelector } from '@renderer/redux'
import {
  closeFile,
  saveFileWithContent,
  selectViewingFileId,
  setViewingFile,
  updateFileContent,
  updateReadmeContent
} from '@renderer/redux/fileSlice'
import { useCallback, useEffect, useRef } from 'react'
import { MonacoEditor, MonacoEditorRef } from '../MonacoEditor'
import { FileTabContent, FileTabs, FileTabsList, FileTabTrigger } from '../ui/FileTab'

export function CodeView(): React.JSX.Element {
  const readOnly = useIsReadOnlyProject()
  // Latches so the "saved locally" hint fires once, not on every Ctrl+S.
  const readOnlySaveHinted = useRef(false)
  const allOpenFiles = useAppSelector(selectOpenFiles)
  // Background buffers (diagram.json / visual.js loaded for the Circuit/Visual
  // views) are hidden from the tab bar until revealed via their code button.
  const openFiles = allOpenFiles.filter((f) => !f.hidden)
  const viewingFileId = useAppSelector(selectViewingFileId)
  const dispatch = useAppDispatch()
  const monacoEditorRef = useRef<MonacoEditorRef>(null)

  const handleFileClose = useCallback(
    (fileId: string): void => {
      dispatch(closeFile(fileId))
    },
    [dispatch]
  )

  const handleFileSelect = useCallback(
    (fileId: string): void => {
      dispatch(setViewingFile(fileId))
      setTimeout(() => {
        if (monacoEditorRef.current) monacoEditorRef.current.focus()
      }, 50)
    },
    [dispatch]
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'w') {
        event.preventDefault()
        if (viewingFileId) handleFileClose(viewingFileId)
      }
      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault()
        if (openFiles.length > 1) {
          const i = openFiles.findIndex((f) => f.id === viewingFileId)
          const next = event.shiftKey
            ? i <= 0
              ? openFiles.length - 1
              : i - 1
            : (i + 1) % openFiles.length
          if (openFiles[next]) handleFileSelect(openFiles[next].id)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewingFileId, handleFileClose, openFiles, handleFileSelect])

  const handleContentChange = useCallback(
    (content: string, fileId: string) => {
      const file = openFiles.find((f) => f.id === fileId)
      if (file) {
        dispatch(updateFileContent({ id: file.id, content }))
        if (file.name === 'README.md') dispatch(updateReadmeContent(content))
      }
    },
    [openFiles, dispatch]
  )

  const handleSaveFile = async (content: string, fileId: string): Promise<void> => {
    const file = openFiles.find((f) => f.id === fileId)
    if (!file || !file.path) return
    try {
      await fileSystem.writeFile(file.path, content)
      dispatch(saveFileWithContent({ id: file.id, content }))

      // A project that only lives in the browser: an explicit Save is the
      // moment to ask where it should live for real.
      if (promptSaveToComputer()) return

      // First save on a read-only example: mention the copy path once, without
      // interrupting. The banner carries the offer from here on.
      if (readOnly && !readOnlySaveHinted.current) {
        readOnlySaveHinted.current = true
        toast.info('Saved locally', {
          // Browser projects can now live in a real folder too, so ask the
          // file where it went rather than which build this is.
          description: isVirtualPath(file.path)
            ? 'Saved in this browser — use “Make it mine” to keep it on GitHub.'
            : 'This is a copy of an example — use “Make it mine” to put it on GitHub.'
        })
      }
    } catch (error) {
      // A failed save must be loud: in the browser it is the common case,
      // because File System Access permission is dropped on reload.
      console.error('Failed to save file:', error)
      toast.error(`Could not save ${file.name}`, {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  if (openFiles.length === 0) {
    return (
      <div className="size-full flex flex-col items-center justify-center gap-1 text-center">
        <div className="text-[var(--text-strong)] text-base font-semibold">No file open</div>
        <div className="text-[var(--text-muted)] text-xs">
          Pick a file from the Files panel to start editing.
        </div>
      </div>
    )
  }

  return (
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
      {openFiles.map((file) => (
        <FileTabContent key={`content-${file.id}`} value={file.id}>
          <MonacoEditor
            ref={monacoEditorRef}
            activeFile={file}
            onContentChange={(content) => handleContentChange(content, file.id)}
            onSaveFile={(content) => handleSaveFile(content, file.id)}
          />
        </FileTabContent>
      ))}
    </FileTabs>
  )
}
