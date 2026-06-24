import { Dispatch } from '@reduxjs/toolkit'
import { fileSystem, FileSystemItem } from '@renderer/lib/fileSystem'
import { fetchRepoFolder, loadAccount } from '@renderer/lib/github'
import { VIRTUAL_PREFIX, virtualFileSystem } from '@renderer/lib/virtualFileSystem'
import {
  BaseFileItem,
  closeFile,
  closeWorkspace,
  EditorFile,
  finishCreateItem,
  openFile,
  openWorkspace,
  setFolderOpen,
  updateDiagramSvgContent,
  updateReadmeContent,
  Workspace
} from '@renderer/redux/fileSlice'
import { store } from '@renderer/redux/store'
import { Command, UndoableCommand } from './command'

// Helper function to convert FileSystemItem to BaseFileItem
const convertToBaseFileItem = (item: FileSystemItem): BaseFileItem => {
  // Extract just the filename/folder name from the path
  // Handle both forward and backward slashes
  const normalizedPath = item.path.replace(/\\/g, '/')
  const lastSlashIndex = normalizedPath.lastIndexOf('/')
  const itemName = lastSlashIndex >= 0 ? normalizedPath.substring(lastSlashIndex + 1) : item.name

  return {
    id: crypto.randomUUID(),
    parentId: '',
    name: itemName,
    path: item.path,
    type: item.isDirectory ? 'folder' : 'file',
    children: item.isDirectory ? [] : undefined
  }
}

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

  // Create a map of normalized paths to original items
  const normalizedPathMap = new Map<string, FileSystemItem>()
  items.forEach((item) => {
    const normalizedPath = item.path.replace(/\\/g, '/')
    normalizedPathMap.set(normalizedPath, item)
  })

  // First pass: create all items, preserving existing IDs where possible
  normalizedPathMap.forEach((originalItem, normalizedPath) => {
    let baseItem: BaseFileItem

    // Try to find existing item with same path to preserve its ID
    const existingItem = existingStructure
      ? findExistingItemByPath(existingStructure, normalizedPath)
      : null

    if (existingItem && existingItem.type === (originalItem.isDirectory ? 'folder' : 'file')) {
      // Preserve existing item's ID and parentId, but update other properties
      baseItem = {
        ...convertToBaseFileItem({ ...originalItem, path: normalizedPath }),
        id: existingItem.id,
        parentId: existingItem.parentId
      }
    } else {
      // Create new item with new ID
      baseItem = convertToBaseFileItem({ ...originalItem, path: normalizedPath })
    }

    itemMap.set(normalizedPath, baseItem)
  })

  // Second pass: build the tree structure
  normalizedPathMap.forEach((_originalItem, normalizedPath) => {
    const baseItem = itemMap.get(normalizedPath)!
    const lastSlashIndex = normalizedPath.lastIndexOf('/')
    const parentPath = lastSlashIndex > 0 ? normalizedPath.substring(0, lastSlashIndex) : ''

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

const findFileInTree = (
  items: BaseFileItem[],
  match: (i: BaseFileItem) => boolean
): BaseFileItem | null => {
  for (const item of items) {
    if (item.type === 'file' && item.name && match(item)) return item
    if (item.children) {
      const found = findFileInTree(item.children, match)
      if (found) return found
    }
  }
  return null
}

/**
 * Swap the open workspace to `workspace` and run the standard "just opened a
 * project" side effects: load the README and diagram.svg into their panels, and
 * auto-open the main .ino (or README) so the editor lands on real content.
 *
 * Shared by OpenWorkspaceCommand (local folder) and LoadGitHubProjectCommand
 * (virtual workspace fetched from GitHub) — both end the same way.
 */
async function activateWorkspace(workspace: Workspace, dispatch: Dispatch): Promise<void> {
  const fileItems = workspace.root

  // Clear any previously open project first so switching doesn't carry over the
  // old workspace's tabs/tree/README/diagram.
  dispatch(closeWorkspace())
  dispatch(openWorkspace(workspace))

  const readme = fileItems.find((file) => file.name === 'README.md')
  if (readme) {
    fileSystem
      .readFile(readme.path)
      .then((content) => dispatch(updateReadmeContent(content)))
      .catch((e) => console.error('Failed to read README:', e))
  }

  const diagram = fileItems.find((file) => file.name === 'diagram.svg')
  if (diagram) {
    fileSystem
      .readFile(diagram.path)
      .then((content) => dispatch(updateDiagramSvgContent(content)))
      .catch((e) => console.error('Failed to read diagram.svg:', e))
  }

  const sketch =
    findFileInTree(fileItems, (i) => /\.ino$/i.test(i.name!)) ||
    findFileInTree(fileItems, (i) => i.name === 'README.md')
  if (sketch) await new OpenFileCommand(sketch).execute()
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
    let folderPath = this.filePath
    if (folderPath) {
      fileSystemItems = await fileSystem.readDirectory(folderPath, true)
    } else {
      const selected = await fileSystem.selectFolder()
      if (selected) {
        folderPath = selected
        fileSystemItems = await fileSystem.readDirectory(selected, true)
      } else {
        // User cancelled folder selection, don't create workspace
        return
      }
    }

    // Remember the folder so the app can reopen it on next launch.
    if (folderPath) {
      try {
        localStorage.setItem('tinystudio.lastWorkspace', folderPath)
      } catch {
        /* ignore */
      }
    }

    const fileItems = buildNestedStructure(fileSystemItems)

    // Extract workspace path from the first item or use empty string
    // Normalize path to use forward slashes
    const workspacePath =
      fileSystemItems.length > 0
        ? (() => {
            const normalizedPath = fileSystemItems[0].path.replace(/\\/g, '/')
            const lastSlashIndex = normalizedPath.lastIndexOf('/')
            return lastSlashIndex > 0 ? normalizedPath.substring(0, lastSlashIndex) : normalizedPath
          })()
        : ''

    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: 'Workspace',
      path: workspacePath,
      root: fileItems
    }

    // Activation (close previous, open this, load README/diagram, auto-open the
    // sketch) is only run after a folder is confirmed above, so a cancelled
    // picker is a no-op.
    await activateWorkspace(workspace, this.dispatch)
  }
}

/**
 * Open a project that lives in a public GitHub repo folder, without a local
 * folder pick. Fetches `<owner>/<repo>/<path>` into the in-memory virtual file
 * system and opens it as a `mem://` workspace. Powers `/<owner>/<repo>/<path>`
 * deep links and the Examples browser.
 */
export class LoadGitHubProjectCommand implements Command {
  private get dispatch(): Dispatch {
    return store.dispatch
  }
  constructor(
    private owner: string,
    private repo: string,
    private path = '',
    private branch?: string
  ) {}

  async execute(): Promise<void> {
    // A signed-in token (if any) just raises the GitHub rate limit; public
    // repos load fine without one.
    const token = loadAccount()?.token
    const files = await fetchRepoFolder(this.owner, this.repo, this.path, this.branch, token)
    if (Object.keys(files).length === 0) {
      throw new Error(
        `No files found at ${this.owner}/${this.repo}${this.path ? '/' + this.path : ''}`
      )
    }

    const name = this.path ? this.path.split('/').pop()! : this.repo

    // Desktop: materialize the project to a real folder so arduino-cli (via
    // tinyService) can read it from disk. The in-memory `mem://` path is not a
    // real file path and can't be compiled/uploaded. The browser has no disk to
    // write to, so it falls back to the virtual workspace (view/edit only; the
    // Arduino service guards mem:// compile/upload with a clear message).
    if (fileSystem.isElectron()) {
      const dir = `${await window.api.app.getExamplesDir()}/${name}`
      for (const [rel, content] of Object.entries(files)) {
        await fileSystem.writeFile(`${dir}/${rel}`, content)
      }
      await new OpenWorkspaceCommand(dir).execute()
      return
    }

    const root = `${VIRTUAL_PREFIX}${this.owner}/${this.repo}${this.path ? '/' + this.path : ''}`
    virtualFileSystem.clear(root)
    await virtualFileSystem.seed(root, files)
    // Overlay any prior in-editor edits saved to the cache for this project.
    await virtualFileSystem.hydrateFromCache(root)
    fileSystem.setCurrentWorkspace(root)

    const fsItems = await fileSystem.readDirectory(root, true)
    const fileItems = buildNestedStructure(fsItems)

    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name,
      path: root,
      root: fileItems
    }
    await activateWorkspace(workspace, this.dispatch)
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

export class CloseWorkspaceCommand implements Command {
  private get dispatch(): Dispatch {
    return store.dispatch
  }

  async execute(): Promise<void> {
    this.dispatch(closeWorkspace())

    // Forget the remembered folder so the app starts on the empty state next
    // launch instead of silently reopening the project the user just closed.
    try {
      localStorage.removeItem('tinystudio.lastWorkspace')
    } catch {
      /* ignore */
    }
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
  private hidden: boolean

  // `hidden` loads the file as a background buffer for a full-window view
  // (Circuit/Visual) without surfacing it as a code tab — see EditorFile.hidden.
  constructor(item: BaseFileItem, opts?: { hidden?: boolean }) {
    this.item = item
    this.hidden = opts?.hidden ?? false
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
        updatedAt: '',
        hidden: this.hidden
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
