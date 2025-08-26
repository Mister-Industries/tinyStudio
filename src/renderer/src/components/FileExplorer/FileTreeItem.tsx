/**
 * FileTreeItem Component
 * Renders individual items in the file tree with support for creation, renaming, and context menus
 */

import {
  CreateFileCommand,
  CreateFolderCommand,
  DeleteFileCommand,
  OpenFileCommand,
  RefreshWorkspaceCommand,
  RenameFileCommand,
  SetFolderOpenCommand
} from '@renderer/commands/fileCommands'
import {
  BaseFileItem,
  cancelCreateItem,
  selectIsExpanded,
  selectOpenFiles,
  setViewingFile,
  startCreateItem,
  useAppDispatch,
  useAppSelector
} from '@renderer/redux'
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
import React, { useEffect, useRef, useState } from 'react'
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
import { Button } from '../ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/DropdownMenu'
import { Input } from '../ui/Input'
import { getFileIconType } from './utils'

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
  const isExpanded = useAppSelector((state) => selectIsExpanded(state, item.id))
  const isOpen = useAppSelector(selectOpenFiles).some((openFile) => openFile.id === item.id)
  const [namingValue, setNamingValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [showDeleteAlert, setShowDeleteAlert] = useState(false)
  const [showContextMenu, setShowContextMenu] = useState(false)
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
    if (isOpen) {
      dispatch(setViewingFile(item.id))
      return
    }

    // Logic to open the file
    if (item.type === 'file') {
      const command = new OpenFileCommand(item)
      command.execute()
    } else if (item.type === 'folder') {
      const command = new SetFolderOpenCommand(item, !isExpanded)
      command.execute()
    }
  }

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    setShowContextMenu(true)
  }

  // Finishes creating myself as a real file or directory
  const handleCreateFileOrDirectory = async (): Promise<void> => {
    if (item.type === 'file') {
      // Logic to create a new file
      const command = new CreateFileCommand(item, namingValue)
      await command.execute()
      const refreshCommand = new RefreshWorkspaceCommand(workspace!)
      await refreshCommand.execute()
    } else if (item.type === 'folder') {
      const command = new CreateFolderCommand(item, namingValue)
      await command.execute()
      const refreshCommand = new RefreshWorkspaceCommand(workspace!)
      await refreshCommand.execute()
    }
  }

  const cancelCreation = (): void => {
    dispatch(cancelCreateItem(item.id))
    setIsRenaming(false)
    setCursorPosition(0)
  }

  // Folder only, creates a sub folder
  const handleCreateSubFolder = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (item.type !== 'folder') {
      return
    }
    const command = new SetFolderOpenCommand(item, true)
    await command.execute()
    dispatch(
      startCreateItem({
        id: crypto.randomUUID(),
        parentId: item.id,
        name: null,
        path: item.path,
        type: 'folder',
        children: []
      } as BaseFileItem)
    )
  }

  // Folder only, creates a sub file
  const handleCreateSubFile = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (item.type !== 'folder') {
      return
    }
    const command = new SetFolderOpenCommand(item, true)
    await command.execute()
    dispatch(
      startCreateItem({
        id: crypto.randomUUID(),
        name: null,
        path: item.path,
        type: 'file'
      } as BaseFileItem)
    )
  }

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
    const command = new RenameFileCommand(item, namingValue)
    await command.execute()
    const refreshCommand = new RefreshWorkspaceCommand(workspace!)
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
    const refreshCommand = new RefreshWorkspaceCommand(workspace!)
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
              isRenaming ? setIsRenaming(false) : cancelCreation()
            }
          }}
          onBlur={cancelCreation}
        />
      </div>
    )
  }

  return (
    <>
      <div
        className={`flex items-center gap-1 px-2 py-1 text-sm cursor-pointer hover:bg-accent/50 group ${
          isSelected ? 'bg-accent text-accent-foreground' : isExpanded ? 'bg-accent/20' : ''
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
        <DropdownMenu open={showContextMenu} onOpenChange={setShowContextMenu}>
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
              <AlertDialogTitle>
                Delete {item.type === 'folder' ? 'Folder' : 'File'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &quot;{item.name}&quot;? This action cannot be
                undone.
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
      {item.type === 'folder' && isExpanded && item.children && (
        <>
          {item.children.map((child) => (
            <FileTreeItem key={child.id} item={child} level={level + 1} />
          ))}
        </>
      )}
    </>
  )
}
