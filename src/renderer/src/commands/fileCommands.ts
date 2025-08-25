import { fileSystem, FileSystemItem } from '@renderer/lib/fileSystem'
import { Command } from './command'
import { Dispatch } from '@reduxjs/toolkit'
import { BaseFileItem, openWorkspace, Workspace } from '@renderer/redux/fileSlice'

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

    // Helper function to convert FileSystemItem to BaseFileItem
    const convertToBaseFileItem = (item: FileSystemItem): BaseFileItem => ({
      id: crypto.randomUUID(),
      name: item.name,
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
          return a.name.localeCompare(b.name, undefined, { numeric: true })
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
