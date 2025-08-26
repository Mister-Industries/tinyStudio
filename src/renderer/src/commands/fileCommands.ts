import { fileSystem, FileSystemItem } from '@renderer/lib/fileSystem'
import { Command, UndoableCommand } from './command'
import { Dispatch } from '@reduxjs/toolkit'
import { BaseFileItem, finishCreateItem, openWorkspace, Workspace } from '@renderer/redux/fileSlice'

// Helper function to convert FileSystemItem to BaseFileItem
const convertToBaseFileItem = (item: FileSystemItem): BaseFileItem => ({
  id: crypto.randomUUID(),
  name: item.name,
  path: item.path,
  type: item.isDirectory ? 'folder' : 'file',
  children: item.isDirectory ? [] : undefined
})

// Build nested structure from flat array
const buildNestedStructure = (items: FileSystemItem[]): BaseFileItem[] => {
  const itemMap = new Map<string, BaseFileItem>()
  const rootItems: BaseFileItem[] = []

  // First pass: create all items
  items.forEach((item) => {
    const baseItem = convertToBaseFileItem(item)
    itemMap.set(item.path, baseItem)
  })

  // Second pass: build the tree structure
  items.forEach((item) => {
    const baseItem = itemMap.get(item.path)!
    const parentPath = item.path.substring(0, item.path.lastIndexOf('/'))

    if (parentPath && itemMap.has(parentPath)) {
      // This item has a parent
      const parent = itemMap.get(parentPath)!
      if (parent.children) {
        parent.children.push(baseItem)
      }
    } else {
      // This is a root item
      rootItems.push(baseItem)
    }
  })

  // Sort function: folders first, then files, both alphabetically
  const sortItems = (items: BaseFileItem[]): BaseFileItem[] => {
    return items.sort((a, b) => {
      // If one is folder and one is file, folder comes first
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1
      }
      // If both are same type, sort alphabetically by name
      return a.name!.localeCompare(b.name!, undefined, { numeric: true })
    })
  }

  // Recursively sort all levels
  const sortRecursively = (items: BaseFileItem[]): BaseFileItem[] => {
    const sorted = sortItems(items)
    sorted.forEach((item) => {
      if (item.children && item.children.length > 0) {
        item.children = sortRecursively(item.children)
      }
    })
    return sorted
  }

  return sortRecursively(rootItems)
}

const combinePathAndFileName = (dirPath: string, fileName: string): string => {
  return dirPath + '/' + fileName
}

export class OpenWorkspaceCommand implements Command {
  private filePath: string | undefined
  private dispatch: Dispatch

  constructor(
    private file: string | undefined,
    dispatch: Dispatch
  ) {
    this.filePath = file
    this.dispatch = dispatch
  }

  async execute(): Promise<void> {
    let fileSystemItems: FileSystemItem[] = []
    if (this.filePath) {
      fileSystemItems = await fileSystem.readDirectory(this.filePath, true)
    } else {
      const filePath = await fileSystem.selectFolder()
      if (filePath) {
        fileSystemItems = await fileSystem.readDirectory(filePath, true)
      }
    }

    const fileItems = buildNestedStructure(fileSystemItems)

    // Extract workspace path from the first item or use empty string
    const workspacePath =
      fileSystemItems.length > 0
        ? fileSystemItems[0].path.substring(0, fileSystemItems[0].path.lastIndexOf('/')) ||
          fileSystemItems[0].path
        : ''

    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: 'Workspace',
      path: workspacePath,
      root: fileItems
    }

    this.dispatch(openWorkspace(workspace))
  }
}

export class RefreshWorkspaceCommand implements Command {
  private dispatch: Dispatch
  private workspace: Workspace

  constructor(dispatch: Dispatch, workspace: Workspace) {
    this.dispatch = dispatch
    this.workspace = workspace
  }

  async execute(): Promise<void> {
    // Logic to refresh the workspace
    const fileSystemItems = await fileSystem.readDirectory(this.workspace.path, true)
    const fileItems = buildNestedStructure(fileSystemItems)

    // Update the workspace with the new file structure
    this.dispatch(openWorkspace({ ...this.workspace, root: fileItems }))
  }
}

export class CreateFolderCommand implements UndoableCommand {
  private dispatch: Dispatch
  private item: BaseFileItem
  private folderName: string

  constructor(dispatch: Dispatch, item: BaseFileItem, folderName: string) {
    this.dispatch = dispatch
    this.item = item
    this.folderName = folderName
  }

  async execute(): Promise<void> {
    const fullPath = combinePathAndFileName(this.item.path, this.folderName)
    await fileSystem.createFolder(fullPath)
    this.dispatch(finishCreateItem(this.item))
  }

  async undo(): Promise<void> {
    const fullPath = combinePathAndFileName(this.item.path, this.folderName)
    fileSystem.deleteFile(fullPath)
  }
}
export class CreateFileCommand implements UndoableCommand {
  private dispatch: Dispatch
  private item: BaseFileItem
  private fileName: string

  constructor(dispatch: Dispatch, item: BaseFileItem, fileName: string) {
    this.dispatch = dispatch
    this.item = item
    this.fileName = fileName
  }

  async execute(): Promise<void> {
    const fullPath = combinePathAndFileName(this.item.path, this.fileName)
    await fileSystem.createFile(fullPath)
    this.dispatch(finishCreateItem(this.item))
  }

  async undo(): Promise<void> {
    const fullPath = combinePathAndFileName(this.item.path, this.fileName)
    fileSystem.deleteFile(fullPath)
  }
}
