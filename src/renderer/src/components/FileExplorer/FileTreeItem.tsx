/**
 * FileTreeItem Component
 * Renders individual items in the file tree with support for creation, renaming, and context menus
 */

import { BaseFileItem, cancelCreateItem, useAppDispatch, useAppSelector } from '@renderer/redux'
import {
  ChevronDown,
  ChevronRight,
  Code,
  Download,
  Edit3,
  File,
  Folder,
  FolderOpen,
  Image,
  MoreHorizontal,
  Plus,
  Trash2
} from 'lucide-react'
import React, { useState, useEffect, useRef } from 'react'
import { Button } from '../ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/DropdownMenu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../ui/AlertDialog'
import { getFileIconType } from './utils'
import { Input } from '../ui/Input'
import {
  CreateFileCommand,
  CreateFolderCommand,
  DeleteFileCommand,
  RefreshWorkspaceCommand,
  RenameFileCommand
} from '@renderer/commands/fileCommands'

/**
 * Get the appropriate file icon based on file type and selection state
 */
function getFileIcon(fileName: string | null, isSelected = false): React.ReactNode {
  const iconType = getFileIconType(fileName)

  switch (iconType) {
    case 'image':
      return <Image size={14} className={isSelected ? 'text-accent-foreground' : 'text-blue-500'} />
    case 'code':
      return <Code size={14} className={isSelected ? 'text-accent-foreground' : 'text-green-500'} />
    case 'file':
      return (
        <File
          size={14}
          className={isSelected ? 'text-accent-foreground' : 'text-muted-foreground'}
        />
      )
    default:
      return null
  }
}

interface FileTreeItemProps {
  level?: number
  item: BaseFileItem
}

export function FileTreeItem({ item, level = 1 }: FileTreeItemProps): React.JSX.Element {
  const isSelected = useAppSelector((state) => state.file.highlightedFileId === item.id)
  const isExpanded = false
  const [namingValue, setNamingValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [showDeleteAlert, setShowDeleteAlert] = useState(false)
  const dispatch = useAppDispatch()
  const workspace = useAppSelector((state) => state.file.workspace)
  const [cursorPosition, setCursorPosition] = useState<number>(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Helper function to get cursor position before file extension
  const getCursorPositionBeforeExtension = (fileName: string): number => {
    if (!fileName) return 0
    const lastDotIndex = fileName.lastIndexOf('.')
    // If no extension found or extension is at the beginning, place cursor at end
    if (lastDotIndex === -1 || lastDotIndex === 0) {
      return fileName.length
    }
    return lastDotIndex
  }

  // Effect to set cursor position when renaming starts
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      const input = inputRef.current
      // Use setTimeout to ensure the input is fully rendered
      setTimeout(() => {
        // For files, select everything before the extension; for folders, select all
        if (item.type === 'file' && cursorPosition > 0) {
          input.setSelectionRange(0, cursorPosition)
        } else {
          input.setSelectionRange(0, input.value.length)
        }
        input.focus()
      }, 0)
    }
  }, [isRenaming, cursorPosition, item.type])

  const handleOpenFile = (): void => {
    // Logic to open the file
  }

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    // Logic to open context menu
  }

  // Finishes creating myself as a real file or directory
  const handleCreateFileOrDirectory = async (): Promise<void> => {
    if (item.type === 'file') {
      // Logic to create a new file
      const command = new CreateFileCommand(dispatch, item, namingValue)
      await command.execute()
      const refreshCommand = new RefreshWorkspaceCommand(dispatch, workspace!)
      await refreshCommand.execute()
    } else if (item.type === 'folder') {
      const command = new CreateFolderCommand(dispatch, item, namingValue)
      await command.execute()
      const refreshCommand = new RefreshWorkspaceCommand(dispatch, workspace!)
      await refreshCommand.execute()
    }
  }

  const cancelCreation = (): void => {
    dispatch(cancelCreateItem(item.id))
    setIsRenaming(false)
    setCursorPosition(0)
  }

  // Folder only, creates a sub folder
  const handleCreateSubFolder = (): void => {}

  // Folder only, creates a sub file
  const handleCreateSubFile = (): void => {}

  const handleStartRenameItem = (): void => {
    setIsRenaming(true)
    setNamingValue(item.name || '')
    // Set cursor position before file extension for files, at end for folders
    const cursorPos =
      item.type === 'file'
        ? getCursorPositionBeforeExtension(item.name || '')
        : item.name?.length || 0
    setCursorPosition(cursorPos)
  }

  const handleRenameItem = async (): Promise<void> => {
    const command = new RenameFileCommand(dispatch, item, namingValue)
    await command.execute()
    const refreshCommand = new RefreshWorkspaceCommand(dispatch, workspace!)
    await refreshCommand.execute()
    setIsRenaming(false)
    setCursorPosition(0)
  }

  const handleDeleteItem = (): void => {
    setShowDeleteAlert(true)
  }

  const confirmDeleteItem = async (): Promise<void> => {
    // Logic to delete the item
    const command = new DeleteFileCommand(item)
    await command.execute()
    const refreshCommand = new RefreshWorkspaceCommand(dispatch, workspace!)
    await refreshCommand.execute()
    setShowDeleteAlert(false)
  }

  if (!item.name || isRenaming) {
    return (
      <div
        className={`flex items-center gap-1 px-2 py-1 text-sm cursor-pointer hover:bg-accent/50 group bg-accent text-accent-foreground`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        <Input
          ref={inputRef}
          className="flex-1 h-5 px-1 text-xs rounded-xs text-foreground"
          value={namingValue}
          onChange={(e) => setNamingValue(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              isRenaming ? handleRenameItem() : handleCreateFileOrDirectory()
            } else if (e.key === 'Escape') {
              cancelCreation()
            }
          }}
          onBlur={cancelCreation}
        />
      </div>
    )
  }

  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 text-sm cursor-pointer hover:bg-accent/50 group ${
        isSelected ? 'bg-accent text-accent-foreground' : ''
      }`}
      style={{ paddingLeft: `${level * 12 + 8}px` }}
      onClick={handleOpenFile}
      onContextMenu={handleContextMenu}
    >
      {/* Folder icons and expansion indicators */}
      {item.type === 'folder' ? (
        <>
          {isExpanded ? (
            <ChevronDown size={14} className="text-muted-foreground" />
          ) : (
            <ChevronRight size={14} className="text-muted-foreground" />
          )}
          {isExpanded ? (
            <FolderOpen size={14} className="text-accent" />
          ) : (
            <Folder size={14} className="text-accent" />
          )}
        </>
      ) : (
        <>
          <span className="w-[14px]" />
          {getFileIcon(item.name, isSelected)}
        </>
      )}
      <span className="flex-1 truncate">{item.name}</span>

      {/* Context menu dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-4 opacity-0 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal size={12} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {item.type === 'folder' ? (
            <>
              <DropdownMenuItem onClick={handleCreateSubFile}>
                <Plus size={14} className="mr-2" />
                New File
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCreateSubFolder}>
                <Folder size={14} className="mr-2" />
                New Folder
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleStartRenameItem}>
                <Edit3 size={14} className="mr-2" />
                Rename
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem>
                <Download size={14} className="mr-2" />
                Download
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleStartRenameItem}>
                <Edit3 size={14} className="mr-2" />
                Rename
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem className="text-destructive" onClick={handleDeleteItem}>
            <Trash2 size={14} className="mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Delete confirmation alert dialog */}
      <AlertDialog open={showDeleteAlert} onOpenChange={setShowDeleteAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {item.type === 'folder' ? 'Folder' : 'File'}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{item.name}&quot;? This action cannot be undone.
              {item.type === 'folder' && ' All contents of this folder will also be deleted.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteItem}
              className="bg-destructive text-secondary-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
