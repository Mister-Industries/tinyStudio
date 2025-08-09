/**
 * FileTreeItem Component
 * Renders individual items in the file tree with support for creation, renaming, and context menus
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  File,
  Image,
  Code,
  MoreHorizontal,
  Plus,
  Edit3,
  Download,
  Trash2
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/DropdownMenu'
import { FileTreeItemProps } from './types'
import { getFileIconType } from './utils'

/**
 * Get the appropriate file icon based on file type and selection state
 */
function getFileIcon(fileName: string, isDirectory: boolean, isSelected = false): React.ReactNode {
  const iconType = getFileIconType(fileName, isDirectory)

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

export function FileTreeItem({
  item,
  level,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  onContextMenu,
  onCreateFile,
  onCreateFolder,
  onDeleteItem,
  onRenameItem,
  onConfirmCreate,
  onCancelCreate,
  onConfirmRename,
  onCancelRename,
  isCreating = false,
  creationType,
  isRenaming = false
}: FileTreeItemProps): React.JSX.Element {
  const [fileName, setFileName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when creating or renaming
  useEffect(() => {
    if ((isCreating || isRenaming) && inputRef.current) {
      if (isRenaming) {
        // Pre-populate with current name for renaming
        setFileName(item.name)
      }
      inputRef.current.focus()
      if (isRenaming) {
        inputRef.current.select()
      }
    }
  }, [isCreating, isRenaming, item.name])

  // Handle keyboard events for input field
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (fileName.trim()) {
          if (isCreating && onConfirmCreate && creationType) {
            onConfirmCreate(item.path, fileName.trim(), creationType)
          } else if (isRenaming && onConfirmRename) {
            onConfirmRename(item.path, fileName.trim())
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (isCreating && onCancelCreate) {
          onCancelCreate()
        } else if (isRenaming && onCancelRename) {
          onCancelRename()
        }
      }
    },
    [
      fileName,
      onConfirmCreate,
      onCancelCreate,
      onConfirmRename,
      onCancelRename,
      item.path,
      creationType,
      isCreating,
      isRenaming
    ]
  )

  // Handle click events on tree items
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()

      // Don't handle clicks on creating or renaming items
      if (isCreating || isRenaming) return

      if (item.isDirectory) {
        onToggle()
      } else {
        onSelect()
      }
    },
    [item.isDirectory, onToggle, onSelect, isCreating, isRenaming]
  )

  // Handle context menu events
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      onContextMenu(item)
    },
    [onContextMenu, item]
  )

  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 text-sm cursor-pointer hover:bg-accent/50 group ${
        isSelected ? 'bg-accent text-accent-foreground' : ''
      }`}
      style={{ paddingLeft: `${level * 12 + 8}px` }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Folder icons and expansion indicators */}
      {(item.isDirectory && !isRenaming) || (isCreating && creationType === 'folder') ? (
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
          {isCreating && creationType === 'file' ? (
            <File size={14} className="text-muted-foreground" />
          ) : (
            getFileIcon(item.name, item.isDirectory, isSelected)
          )}
        </>
      )}

      {/* Input field for creating/renaming or display name */}
      {isCreating || isRenaming ? (
        <Input
          ref={inputRef}
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (isCreating) {
              onCancelCreate?.()
            } else if (isRenaming) {
              onCancelRename?.()
            }
          }}
          className="flex-1 h-5 px-1 text-xs rounded-xs"
          placeholder={isCreating ? (creationType === 'file' ? 'filename.txt' : 'folder name') : ''}
        />
      ) : (
        <span className="flex-1 truncate">{item.name}</span>
      )}

      {/* Context menu dropdown */}
      {!isCreating && !isRenaming && (
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
            {item.isDirectory ? (
              <>
                <DropdownMenuItem onClick={() => onCreateFile(item.path)}>
                  <Plus size={14} className="mr-2" />
                  New File
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onCreateFolder(item.path)}>
                  <Folder size={14} className="mr-2" />
                  New Folder
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onRenameItem(item.path)}>
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
                <DropdownMenuItem onClick={() => onRenameItem(item.path)}>
                  <Edit3 size={14} className="mr-2" />
                  Rename
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem className="text-destructive" onClick={() => onDeleteItem(item.path)}>
              <Trash2 size={14} className="mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
