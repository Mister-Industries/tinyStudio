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
  revealFile,
  selectIsExpanded,
  selectOpenFiles,
  setEditorView,
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
      return <Image size={14} className={isSelected ? 'text-accent-foreground' : 'text-pink'} />
    case 'code':
      return <Code size={14} className={isSelected ? 'text-accent-foreground' : 'text-cyan'} />
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
  const itemRef = useRef<HTMLDivElement>(null)

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

  // Helper function to find next/previous focusable tree item
  const findNextFocusableItem = (direction: 'up' | 'down'): HTMLElement | null => {
    if (!itemRef.current) return null

    const allTreeItems = Array.from(
      document.querySelectorAll('[data-tree-item="true"]')
    ) as HTMLElement[]

    const currentIndex = allTreeItems.indexOf(itemRef.current)
    if (currentIndex === -1) return null

    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    return allTreeItems[nextIndex] || null
  }

  // Handle keyboard events for focus navigation and actions
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (isRenaming) return // Don't handle navigation when renaming

    switch (e.key) {
      case 'ArrowUp': {
        e.preventDefault()
        const prevItem = findNextFocusableItem('up')
        if (prevItem) prevItem.focus()
        break
      }

      case 'ArrowDown': {
        e.preventDefault()
        const nextItem = findNextFocusableItem('down')
        if (nextItem) nextItem.focus()
        break
      }

      case 'Enter':
        e.preventDefault()
        if (e.ctrlKey || e.metaKey) {
          // Ctrl/Cmd + Enter: Open file and focus editor
          handleOpenFile()
        } else {
          // Enter: Start rename
          handleStartRenameItem()
        }
        break

      case ' ':
        e.preventDefault()
        handleOpenFile()
        break
    }
  }

  const handleOpenFile = (): void => {
    if (item.type === 'folder') {
      new SetFolderOpenCommand(item, !isExpanded).execute()
      return
    }

    // Opening a file from the tree always lands you in the Code view with that
    // file selected. revealFile also un-hides background buffers (diagram.json /
    // visual.js) so they show up as a tab; for files not open yet, load them.
    if (isOpen) {
      dispatch(revealFile(item.id))
    } else {
      new OpenFileCommand(item).execute()
    }
    dispatch(setEditorView('code'))
  }

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    setShowContextMenu(true)
  }

  const handleContextMenuOpenChange = (open: boolean): void => {
    setShowContextMenu(open)
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
        type: 'file',
        parentId: item.id
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
        style={{ paddingLeft: `${level * 12 + 24}px` }}
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
        ref={itemRef}
        className={`flex items-center gap-1 px-2 py-1 text-sm cursor-pointer hover:bg-accent/50 group focus:ring-accent focus:ring-1 focus:outline-none ${
          isSelected ? 'bg-accent text-accent-foreground' : isExpanded ? 'bg-accent/20' : ''
        }`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleOpenFile}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        data-tree-item="true"
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
              <FolderOpen size={14} className="text-cyan" />
            ) : (
              <Folder size={14} className="text-cyan" />
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
        <DropdownMenu open={showContextMenu} onOpenChange={handleContextMenuOpenChange}>
          <DropdownMenuTrigger asChild tabIndex={-1}>
            <Button
              variant="ghost"
              size="icon"
              className="size-4 opacity-0 group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
              tabIndex={-1}
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
