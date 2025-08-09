/**
 * FileExplorerContent Component
 * Main content area for the file explorer with workspace management
 */

import React, { useState, useCallback } from 'react'
import { Folder, FolderOpen, AlertCircle, FolderSync, FolderPlus, Plus } from 'lucide-react'
import { Button } from '../ui/Button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'
import { ScrollArea } from '../ui/ScrollArea'
import { FileTree } from './FileTree'
import { CreateProjectDialog } from './CreateProjectDialog'
import { useFileSystem } from '../../lib/useFileSystem'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { openFile, setViewingFile, selectOpenFiles, type EditorFile } from '../../redux/fileSlice'
import { fileSystem } from '../../lib/fileSystem'

export function FileExplorerContent(): React.JSX.Element {
  const dispatch = useAppDispatch()
  const openFiles = useAppSelector(selectOpenFiles)
  
  // File system hook for workspace and file operations
  const {
    workspace,
    files,
    currentFile,
    isLoading,
    error,
    selectWorkspace,
    openWorkspace,
    refreshFiles,
    createFile,
    setCurrentFile,
    clearError,
    loadDirectory
  } = useFileSystem()

  // State for triggering root-level file/folder creation
  const [triggerRootFileCreation, setTriggerRootFileCreation] = useState(false)
  const [triggerRootFolderCreation, setTriggerRootFolderCreation] = useState(false)

  /**
   * Reset root file creation trigger
   */
  const handleRootFileCreationComplete = useCallback(() => {
    setTriggerRootFileCreation(false)
  }, [])

  /**
   * Reset root folder creation trigger
   */
  const handleRootFolderCreationComplete = useCallback(() => {
    setTriggerRootFolderCreation(false)
  }, [])

  /**
   * Handle file selection and opening in editor
   */
  const handleFileSelect = useCallback(
    async (filePath: string) => {
      try {
        setCurrentFile(filePath)

        // Check if file is already open in editor
        const existingFile = openFiles.find((file) => file.path === filePath)
        if (existingFile) {
          // File is already open, just set it as the viewing file
          dispatch(setViewingFile(existingFile.id))
          return
        }

        // Read file content and create editor file object
        const content = await fileSystem.readFile(filePath)
        const editorFile: EditorFile = {
          id: crypto.randomUUID(),
          name: fileSystem.getFileName(filePath),
          path: filePath,
          content,
          modified: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }

        // Add to open files in Redux store
        dispatch(openFile(editorFile))
      } catch (err) {
        console.error('Failed to open file:', err)
      }
    },
    [setCurrentFile, dispatch, openFiles]
  )

  /**
   * Trigger creation of new file at root level
   */
  const handleNewFile = useCallback(async () => {
    if (!workspace) return
    setTriggerRootFileCreation(true)
  }, [workspace])

  /**
   * Trigger creation of new folder at root level
   */
  const handleNewFolder = useCallback(async () => {
    if (!workspace) return
    setTriggerRootFolderCreation(true)
  }, [workspace])

  /**
   * Handle file creation with default content
   */
  const handleCreateFile = useCallback(
    async (filePath: string) => {
      try {
        await createFile(filePath, '// New file\n')

        // Check if file is already open
        const existingFile = openFiles.find((file) => file.path === filePath)
        if (existingFile) {
          // File is already open, just set it as the viewing file
          dispatch(setViewingFile(existingFile.id))
          setCurrentFile(filePath)
          return
        }

        // Auto-open the new file in editor
        const fileName = fileSystem.getFileName(filePath)
        const editorFile: EditorFile = {
          id: crypto.randomUUID(),
          name: fileName,
          path: filePath,
          content: '// New file\n',
          modified: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }

        dispatch(openFile(editorFile))
        setCurrentFile(filePath)

        // Refresh files to show the new file
        await refreshFiles()
      } catch (err) {
        console.error('Failed to create file:', err)
      }
    },
    [createFile, dispatch, setCurrentFile, openFiles, refreshFiles]
  )

  /**
   * Handle folder creation
   */
  const handleCreateFolder = useCallback(
    async (folderPath: string) => {
      try {
        await fileSystem.createFolder(folderPath)
        // Refresh files to show the new folder
        await refreshFiles()
      } catch (err) {
        console.error('Failed to create folder:', err)
      }
    },
    [refreshFiles]
  )

  /**
   * Handle item deletion with confirmation
   */
  const handleDeleteItem = useCallback(
    async (itemPath: string) => {
      const itemName = fileSystem.getFileName(itemPath)
      const confirmed = confirm(`Are you sure you want to delete "${itemName}"?`)
      if (!confirmed) return

      try {
        await fileSystem.deleteFile(itemPath)
        // Refresh files to reflect the deletion
        await refreshFiles()
      } catch (err) {
        console.error('Failed to delete item:', err)
      }
    },
    [refreshFiles]
  )

  return (
    <div className="h-full flex flex-col">
      {/* Header with workspace name and action buttons */}
      <div className="flex justify-between items-center px-4 py-3 text-xs font-semibold border-b border-border">
        <div className="flex items-center gap-2">
          <Folder size={14} />
          {workspace ? workspace.split('/').pop() || workspace : 'WORKSPACE'}
        </div>
        <div className="flex gap-1">
          {workspace && (
            <>
              {/* Refresh Files Button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-4" onClick={refreshFiles}>
                    <FolderSync size={12} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh files</TooltipContent>
              </Tooltip>
              {/* New Folder Button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-4" onClick={handleNewFolder}>
                    <FolderPlus size={12} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>New folder</TooltipContent>
              </Tooltip>
              {/* New File Button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-4" onClick={handleNewFile}>
                    <Plus size={12} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>New file</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mx-4 my-2 p-2 bg-destructive/10 border border-destructive/20 rounded text-xs flex items-center gap-2">
          <AlertCircle size={14} className="text-destructive" />
          <span className="flex-1">{error}</span>
          <Button variant="ghost" size="icon" className="size-4" onClick={clearError}>
            ×
          </Button>
        </div>
      )}

      {/* Main Content Area */}
      <ScrollArea className="flex-1">
        {!workspace ? (
          // No workspace state - show welcome screen
          <div className="flex flex-col items-center justify-center text-muted-foreground py-8 px-4 gap-2">
            <Folder size={48} className="mb-4 opacity-50" />
            <p className="text-sm mb-4 text-center">Open a folder to start working with files</p>
            <Button onClick={selectWorkspace} className="w-40">
              Open Folder
              <FolderOpen size={14} />
            </Button>
            <CreateProjectDialog openWorkspace={openWorkspace} />
          </div>
        ) : isLoading ? (
          // Loading state
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          // File tree display
          <FileTree
            files={files}
            onFileSelect={handleFileSelect}
            selectedFile={currentFile}
            loadDirectory={loadDirectory}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onDeleteItem={handleDeleteItem}
            refreshFiles={refreshFiles}
            triggerRootFileCreation={triggerRootFileCreation}
            onRootFileCreationComplete={handleRootFileCreationComplete}
            triggerRootFolderCreation={triggerRootFolderCreation}
            onRootFolderCreationComplete={handleRootFolderCreationComplete}
            workspacePath={workspace}
          />
        )}
      </ScrollArea>
    </div>
  )
}
