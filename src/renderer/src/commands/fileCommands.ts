import { Dispatch } from '@reduxjs/toolkit'
import { fileSystem, FileSystemItem } from '@renderer/lib/fileSystem'
import {
  BaseFileItem,
  closeFile,
  EditorFile,
  finishCreateItem,
  openFile,
  openWorkspace,
  setFolderOpen,
  updateReadmeContent,
  Workspace
} from '@renderer/redux/fileSlice'
import { store } from '@renderer/redux/store'
import { Command, UndoableCommand } from './command'

// Helper function to convert FileSystemItem to BaseFileItem
const convertToBaseFileItem = (item: FileSystemItem): BaseFileItem => ({
  id: crypto.randomUUID(),
  parentId: '',
  name: item.name,
  path: item.path,
  type: item.isDirectory ? 'folder' : 'file',
  children: item.isDirectory ? [] : undefined
})

// Helper function to find existing item by path in the current workspace structure
const findExistingItemByPath = (items: BaseFileItem[], path: string): BaseFileItem | null => {
  for (const item of items) {
    if (item.path === path) {
      return item
    }
    if (item.children) {
      const found = findExistingItemByPath(item.children, path)
      if (found) return found
    }
  }
  return null
}

// Build nested structure from flat array, preserving existing IDs where possible
const buildNestedStructure = (
  items: FileSystemItem[],
  existingStructure?: BaseFileItem[]
): BaseFileItem[] => {
  const itemMap = new Map<string, BaseFileItem>()
  const rootItems: BaseFileItem[] = []

  // First pass: create all items, preserving existing IDs where possible
  items.forEach((item) => {
    let baseItem: BaseFileItem

    // Try to find existing item with same path to preserve its ID
    const existingItem = existingStructure
      ? findExistingItemByPath(existingStructure, item.path)
      : null

    if (existingItem && existingItem.type === (item.isDirectory ? 'folder' : 'file')) {
      // Preserve existing item's ID and parentId, but update other properties
      baseItem = {
        ...convertToBaseFileItem(item),
        id: existingItem.id,
        parentId: existingItem.parentId
      }
    } else {
      // Create new item with new ID
      baseItem = convertToBaseFileItem(item)
    }

    itemMap.set(item.path, baseItem)
  })

  // Second pass: build the tree structure
  items.forEach((item) => {
    const baseItem = itemMap.get(item.path)!
    const parentPath = item.path.substring(0, item.path.lastIndexOf('/'))

    if (parentPath && itemMap.has(parentPath)) {
      // This item has a parent
      baseItem.parentId = itemMap.get(parentPath)!.id
      const parent = itemMap.get(parentPath)!
      if (parent.children) {
        parent.children.push(baseItem)
      }
    } else {
      // This is a root item
      baseItem.parentId = 'root'
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
  private get dispatch(): Dispatch {
    return store.dispatch
  }

  constructor(file: string | undefined) {
    this.filePath = file
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

    if (fileItems.some((file: BaseFileItem) => file.name === 'README.md')) {
      // Open the README.md file if it exists
      const readmeFile = fileItems.find((file: BaseFileItem) => file.name === 'README.md')
      if (readmeFile) {
        fileSystem.readFile(readmeFile.path).then((content) => {
          this.dispatch(updateReadmeContent(content))
        })
      }
    }
  }
}

export class RefreshWorkspaceCommand implements Command {
  private get dispatch(): Dispatch {
    return store.dispatch
  }
  private workspace: Workspace

  constructor(workspace: Workspace) {
    this.workspace = workspace
  }

  async execute(): Promise<void> {
    // Logic to refresh the workspace
    const fileSystemItems = await fileSystem.readDirectory(this.workspace.path, true)
    const fileItems = buildNestedStructure(fileSystemItems, this.workspace.root)

    // Update the workspace with the new file structure
    this.dispatch(openWorkspace({ ...this.workspace, root: fileItems }))
  }
}

export class CreateFolderCommand implements UndoableCommand {
  private get dispatch(): Dispatch {
    return store.dispatch
  }
  private item: BaseFileItem
  private folderName: string

  constructor(item: BaseFileItem, folderName: string) {
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
  private get dispatch(): Dispatch {
    return store.dispatch
  }
  private item: BaseFileItem
  private fileName: string

  constructor(item: BaseFileItem, fileName: string) {
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

export class OpenFileCommand implements Command {
  private get dispatch(): Dispatch {
    return store.dispatch
  }
  private item: BaseFileItem

  constructor(item: BaseFileItem) {
    this.item = item
  }

  async execute(): Promise<void> {
    if (this.item.type !== 'file') {
      return
    }
    const content = await fileSystem.readFile(this.item.path)
    if (this.item.name) {
      const file: EditorFile = {
        id: this.item.id,
        name: this.item.name,
        content,
        path: this.item.path,
        modified: false,
        createdAt: '',
        updatedAt: ''
      }
      this.dispatch(openFile(file))
    }
  }
}

export class SetFolderOpenCommand implements Command {
  private get dispatch(): Dispatch {
    return store.dispatch
  }
  private item: BaseFileItem
  private isOpen: boolean

  constructor(item: BaseFileItem, isOpen: boolean) {
    this.item = item
    this.isOpen = isOpen
  }

  async execute(): Promise<void> {
    if (this.item.type !== 'folder') {
      return
    }
    this.dispatch(setFolderOpen({ id: this.item.id, isOpen: this.isOpen }))
  }
}

export class RenameFileCommand implements UndoableCommand {
  private get dispatch(): Dispatch {
    return store.dispatch
  }
  private item: BaseFileItem
  private newName: string

  constructor(item: BaseFileItem, newName: string) {
    this.item = item
    this.item = item
    this.newName = newName
  }

  async execute(): Promise<void> {
    const oldPath = this.item.path
    // Get the directory path by removing the filename
    const lastSlashIndex = this.item.path.lastIndexOf('/')
    const directoryPath = lastSlashIndex >= 0 ? this.item.path.substring(0, lastSlashIndex) : ''

    // Create new path with the new filename
    const newPath = directoryPath ? `${directoryPath}/${this.newName}` : this.newName

    await fileSystem.renameFile(oldPath, newPath)
    this.dispatch(finishCreateItem(this.item))
  }

  async undo(): Promise<void> {
    const originalPath = this.item.path
    // Get the directory path by removing the filename
    const lastSlashIndex = this.item.path.lastIndexOf('/')
    const directoryPath = lastSlashIndex >= 0 ? this.item.path.substring(0, lastSlashIndex) : ''

    // Create new path with the new filename
    const newPath = directoryPath ? `${directoryPath}/${this.newName}` : this.newName

    await fileSystem.renameFile(newPath, originalPath)
  }
}

export class DeleteFileCommand implements Command {
  private get dispatch(): Dispatch {
    return store.dispatch
  }
  private item: BaseFileItem

  constructor(item: BaseFileItem) {
    this.item = item
  }

  async execute(): Promise<void> {
    await fileSystem.deleteFile(this.item.path)
    this.dispatch(closeFile(this.item.id))
  }
}
