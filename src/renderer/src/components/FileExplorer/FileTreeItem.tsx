/**
 * FileTreeItem Component
 * Renders individual items in the file tree with support for creation, renaming, and context menus
 */

import { BaseFileItem, useAppSelector } from '@renderer/redux'
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
import React from 'react'
import { Button } from '../ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/DropdownMenu'
import { getFileIconType } from './utils'

/**
 * Get the appropriate file icon based on file type and selection state
 */
function getFileIcon(fileName: string, isSelected = false): React.ReactNode {
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

export function FileTreeItem({ item, level = 0 }: FileTreeItemProps): React.JSX.Element {
  const isSelected = useAppSelector((state) => state.file.highlightedFileId === item.id)
  const isExpanded = false

  const handleOpenFile = (): void => {
    // Logic to open the file
  }

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    // Logic to open context menu
  }

  const handleCreateFile = (): void => {
    // Logic to create a new file
  }

  const handleCreateFolder = (): void => {
    // Logic to create a new folder
  }

  const handleRenameItem = (): void => {
    // Logic to rename the item
  }

  const handleDeleteItem = (): void => {
    // Logic to delete the item
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

      {/* Input field for creating/renaming or display name */}
      {/* {isCreating || isRenaming ? (
        <Input
          ref={inputRef}
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          className="flex-1 h-5 px-1 text-xs rounded-xs"
          placeholder={isCreating ? (creationType === 'file' ? 'filename.txt' : 'folder name') : ''}
        />
      ) : ( */}
      <span className="flex-1 truncate">{item.name}</span>
      {/* )} */}

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
          {item.type ? (
            <>
              <DropdownMenuItem onClick={handleCreateFile}>
                <Plus size={14} className="mr-2" />
                New File
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCreateFolder}>
                <Folder size={14} className="mr-2" />
                New Folder
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleRenameItem}>
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
              <DropdownMenuItem onClick={handleRenameItem}>
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
    </div>
  )
}
