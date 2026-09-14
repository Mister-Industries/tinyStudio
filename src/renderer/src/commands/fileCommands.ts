import { Dispatch } from '@reduxjs/toolkit'
import { fileSystem, FileSystemItem } from '@renderer/lib/fileSystem'
import {
  canPushTo,
  fetchBlobs,
  fetchRepoProject,
  loadAccount,
  loadLink,
  saveLink,
  type RepoLink
} from '@renderer/lib/github'
import { notify as toast } from '@renderer/lib/notify'
import { flattenSketchLayout, suggestProjectName } from '@renderer/lib/projectLayout'
import {
  canSaveToComputer,
  chooseProjectTarget,
  ensureFolderAccess,
  folderLabel,
  pickParentFolder,
  recentFolderHandle,
  rememberFolder,
  writeProjectFolder,
  type RecentProject
} from '@renderer/lib/projectStore'
import { isVirtualPath, VIRTUAL_PREFIX, virtualFileSystem } from '@renderer/lib/virtualFileSystem'
import { webFileSystem } from '@renderer/lib/webFileSystem'
import { setDocsTab, setSavingToComputer, snoozeSavePrompt } from '@renderer/redux/editorSlice'
import {
  BaseFileItem,
  closeFile,
  closeWorkspace,
  EditorFile,
  finishCreateItem,
  openFile,
  openWorkspace,
  rebaseOpenFiles,
  saveFileWithContent,
  selectOpenFiles,
  setFolderOpen,
  setViewingFile,
  updateDiagramSvgContent,
  updateReadmeContent,
  Workspace,
  WorkspaceSource
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
  // Opening a project (folder or example) means there's now something to read —
  // switch the docs panel off the Examples tab and onto Docs.
  dispatch(setDocsTab('readme'))

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
  private source: WorkspaceSource | undefined
  private get dispatch(): Dispatch {
    return store.dispatch
  }

  // `source` is set when the folder was materialized from a GitHub repo, so the
  // opened workspace still knows where it came from and what else lives there.
  constructor(file: string | undefined, source?: WorkspaceSource) {
    this.filePath = file
    this.source = source
  }

  async execute(): Promise<void> {
    let folderPath = this.filePath
    if (!folderPath) {
      const selected = await fileSystem.selectFolder()
      // User cancelled folder selection, don't create workspace
      if (!selected) return
      folderPath = selected
    }

    // The workspace path is the folder itself, with forward slashes like the
    // tree. (It used to be inferred from the first listed file's parent, which
    // was wrong for a browser folder and empty for an empty one.)
    const workspacePath = folderPath.replace(/\\/g, '/').replace(/\/+$/, '')
    fileSystem.setCurrentWorkspace(workspacePath)
    const fileSystemItems: FileSystemItem[] = await fileSystem.readDirectory(workspacePath, true)

    if (!isVirtualPath(workspacePath)) {
      // Remember the folder so the app can reopen it on next launch.
      try {
        localStorage.setItem('tinystudio.lastWorkspace', workspacePath)
      } catch {
        /* ignore */
      }
      void rememberFolder(workspacePath)
      leaveProjectRoute()
    }

    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: workspacePath.split('/').pop() || 'Workspace',
      path: workspacePath,
      root: buildNestedStructure(fileSystemItems),
      source: this.source
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
    // A signed-in token raises the rate limit, unlocks private repos, and is
    // what lets us tell whether this user can push to the source repo.
    const token = loadAccount()?.token
    const project = await fetchRepoProject(this.owner, this.repo, this.path, this.branch, token)
    if (project.manifest.length === 0) {
      throw new Error(
        `No files found at ${this.owner}/${this.repo}${this.path ? '/' + this.path : ''}`
      )
    }

    const source: WorkspaceSource = {
      owner: this.owner,
      repo: this.repo,
      branch: project.branch,
      path: project.path,
      manifest: project.manifest,
      truncated: project.truncated,
      canPush: await canPushTo(this.owner, this.repo, token)
    }

    const name = this.path ? this.path.split('/').pop()! : this.repo

    // Desktop: materialize the project to a real folder so arduino-cli (via
    // tinyService) can read it from disk. The in-memory `mem://` path is not a
    // real file path and can't be compiled/uploaded. The browser has no disk to
    // write to, so it falls back to the virtual workspace (view/edit only; the
    // Arduino service guards mem:// compile/upload with a clear message).
    if (fileSystem.isElectron()) {
      // Namespaced by owner/repo: two examples that share a folder name (two
      // repos each with a `blink/`) used to land on the same path, and the
      // second silently overwrote the first.
      const examplesDir = await window.api.app.getExamplesDir()
      const dir = [examplesDir, this.owner, this.repo, this.path].filter(Boolean).join('/')
      for (const [rel, content] of Object.entries(project.files)) {
        await fileSystem.writeFile(`${dir}/${rel}`, content)
      }
      await new OpenWorkspaceCommand(dir, source).execute()
      return
    }

    const root = `${VIRTUAL_PREFIX}${this.owner}/${this.repo}${this.path ? '/' + this.path : ''}`
    virtualFileSystem.clear(root)
    await virtualFileSystem.seed(root, project.files)
    // Overlay any prior in-editor edits saved to the cache for this project.
    await virtualFileSystem.hydrateFromCache(root)
    fileSystem.setCurrentWorkspace(root)

    // A repo this user can push to opens already linked, so Push works straight
    // away — and the link travels with the project if it's saved to a folder.
    // The baseline is this fresh fetch, so edits cached from an earlier visit
    // show up as changes instead of being absorbed into it.
    if (source.canPush && !loadLink(root)) {
      try {
        saveLink(root, {
          remote: `${this.owner}/${this.repo}`,
          branch: project.branch,
          path: project.path,
          base: project.files
        })
      } catch (e) {
        console.warn('Could not save repo link:', e)
      }
    }

    const fsItems = await fileSystem.readDirectory(root, true)
    const fileItems = buildNestedStructure(fsItems)

    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name,
      path: root,
      root: fileItems,
      source
    }
    await activateWorkspace(workspace, this.dispatch)
  }
}

/**
 * Re-point an open workspace at the repo the user just copied it into.
 *
 * This is the fiddly half of "make it mine": four things have to move together
 * or the result is worse than not moving at all —
 *   1. the in-memory project and its cached copies (web only; on desktop the
 *      folder already belongs to the user and stays where it is),
 *   2. the paths held by open editor tabs, which nothing else updates,
 *   3. the tree, rebuilt from the new root,
 *   4. the URL, so a refresh reopens *their* project and not the example.
 */
export class AdoptCopiedProjectCommand implements Command {
  private get dispatch(): Dispatch {
    return store.dispatch
  }

  constructor(
    private workspace: Workspace,
    private link: RepoLink,
    private newOwner: string
  ) {}

  /**
   * The repo already exists on GitHub by the time we get here, so a failure to
   * write the local baseline must not read as "the copy failed" — that sends
   * people looking for a repo that is sitting there fine.
   */
  private persistLink(workspacePath: string): void {
    try {
      saveLink(workspacePath, this.link)
    } catch (e) {
      throw new Error(
        `${this.link.remote} was created and your files were copied, but the local sync ` +
          `baseline could not be saved: ${e instanceof Error ? e.message : 'unknown error'}`
      )
    }
  }

  async execute(): Promise<void> {
    const [, repoName] = this.link.remote.split('/')
    const source: WorkspaceSource = {
      owner: this.newOwner,
      repo: repoName,
      branch: this.link.branch,
      path: '',
      // The copy is complete, so nothing is outstanding to fetch any more.
      manifest: [],
      truncated: false,
      canPush: true
    }

    // Desktop: the workspace is already a real folder the user owns. Nothing
    // moves — just record the link and that it is now writable.
    if (!isVirtualPath(this.workspace.path)) {
      this.dispatch(openWorkspace({ ...this.workspace, source }))
      this.persistLink(this.workspace.path)
      return
    }

    const oldRoot = this.workspace.path
    const newRoot = `${VIRTUAL_PREFIX}${this.newOwner}/${repoName}`

    const openPaths = selectOpenFiles(store.getState()).map((f) => f.path)
    const viewingPath = selectOpenFiles(store.getState()).find(
      (f) => f.id === store.getState().file.viewingFileId
    )?.path

    await virtualFileSystem.rerootTo(oldRoot, newRoot)
    fileSystem.setCurrentWorkspace(newRoot)
    this.dispatch(rebaseOpenFiles({ from: oldRoot, to: newRoot }))

    const fsItems = await fileSystem.readDirectory(newRoot, true)
    const workspace: Workspace = {
      ...this.workspace,
      name: repoName,
      path: newRoot,
      root: buildNestedStructure(fsItems),
      source
    }
    this.dispatch(openWorkspace(workspace))
    this.persistLink(newRoot)

    // Re-open each tab against the rebuilt tree so tab ids line up with tree ids
    // again (that is what keeps highlighting and close-from-tree working).
    const rebased = openPaths.map((p) =>
      p.startsWith(oldRoot) ? newRoot + p.slice(oldRoot.length) : p
    )
    for (const path of rebased) {
      const item = findFileInTree(workspace.root, (i) => i.path === path)
      if (item) await new OpenFileCommand(item).execute()
    }
    if (viewingPath) {
      const want = viewingPath.startsWith(oldRoot)
        ? newRoot + viewingPath.slice(oldRoot.length)
        : viewingPath
      const item = findFileInTree(workspace.root, (i) => i.path === want)
      if (item) this.dispatch(setViewingFile(item.id))
    }

    // A refresh should land on the user's own project from here on. The URL is
    // built inline rather than imported from projectRouting, which imports this
    // module — keeping that dependency one-way.
    const url = `/${encodeURIComponent(this.newOwner)}/${encodeURIComponent(repoName)}`
    if (typeof window !== 'undefined' && window.location.pathname !== url) {
      window.history.pushState({ owner: this.newOwner, repo: repoName, path: '' }, '', url)
    }
  }
}

/**
 * A local folder has no URL of its own. If the address bar still shows the
 * example or repo that was open before, a reload would bring *that* back instead
 * of this folder — so step off the project route.
 */
function leaveProjectRoute(): void {
  if (fileSystem.isElectron() || typeof window === 'undefined') return
  if (window.location.pathname !== '/') window.history.pushState(null, '', '/')
}

const base64ToBytes = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

/**
 * Called after an explicit Save. A project that only lives in the browser goes
 * straight to the folder picker, so it can be kept for real. Cancelling the
 * picker means "not yet": Save stops opening it for this project, and the
 * banner still offers it. Returns true when the save to computer was started.
 */
export function promptSaveToComputer(): boolean {
  const state = store.getState()
  const path = state.file.workspace?.path
  if (!path || !isVirtualPath(path) || fileSystem.isElectron() || !canSaveToComputer()) return false
  if (state.editor.savePromptSnoozedFor === path || state.editor.projectDialog) return false
  void saveProjectToComputer()
  return true
}

/**
 * Save the open browser-only project to the computer and report how it went.
 * Shared by Save and the banner's "Save to computer" button. Call it straight
 * from a click or key press: that's the only time the browser will show its
 * folder picker.
 */
export async function saveProjectToComputer(): Promise<void> {
  const state = store.getState()
  const path = state.file.workspace?.path
  if (!path || state.editor.savingToComputer) return
  if (!canSaveToComputer()) {
    toast.info("This browser can't save projects to folders", {
      description:
        'Open tinyStudio in Chrome or Edge, or use the desktop app. Until then, your changes are kept in this browser.'
    })
    return
  }

  store.dispatch(setSavingToComputer(true))
  try {
    const saved = await new SaveProjectToComputerCommand().execute()
    if (!saved) {
      store.dispatch(snoozeSavePrompt(path))
      return
    }
    const where = saved.inPlace ? '' : `Created inside ${saved.parent}. `
    const linked = saved.linkedTo ? ` Still linked to ${saved.linkedTo} for Push and Pull.` : ''
    toast.success(`Saved to ${saved.folder}`, {
      description: `${where}From now on, Save writes straight to this folder.${linked}`
    })
  } catch (e) {
    console.error('Save to computer failed:', e)
    toast.error('Could not save to your computer', {
      description: e instanceof Error ? e.message : String(e)
    })
  } finally {
    store.dispatch(setSavingToComputer(false))
  }
}

export interface SavedToComputer {
  /** the new project folder's name */
  folder: string
  /** the folder the user picked, which now holds the project folder */
  parent: string
  /** the user picked the (empty) project folder itself, so nothing was nested */
  inPlace: boolean
  /** the repo the project stays linked to, if any */
  linkedTo?: string
}

/**
 * Give a project that has only lived in the browser — an example, a GitHub
 * repo, a scratch project — a permanent home: a new folder named after the
 * project, inside whichever folder the user picks, laid out the way the Arduino
 * IDE expects (see projectLayout). The workspace then switches to that folder,
 * so every later Save writes to it.
 *
 * Asks for the location before doing anything else: the browser only shows its
 * folder picker straight off a click, and awaiting writes first can use that up.
 */
export class SaveProjectToComputerCommand {
  private get dispatch(): Dispatch {
    return store.dispatch
  }

  /** Resolves to where the project went, or null if the user cancelled. */
  async execute(): Promise<SavedToComputer | null> {
    const workspace = store.getState().file.workspace
    if (!workspace) return null
    const parent = await pickParentFolder()
    if (!parent) return null

    const oldRoot = workspace.path
    const source = workspace.source

    // Flush unsaved buffers: the snapshot below reads the files, not the editor.
    const openFiles = selectOpenFiles(store.getState())
    for (const f of openFiles.filter((f) => f.modified && f.path)) {
      await fileSystem.writeFile(f.path, f.content)
      this.dispatch(saveFileWithContent({ id: f.id, content: f.content }))
    }

    const files: Record<string, string | Uint8Array> = {}
    for (const item of await fileSystem.readDirectory(oldRoot, true)) {
      if (item.isDirectory) continue
      files[item.path.slice(oldRoot.length + 1)] = await fileSystem.readFile(item.path)
    }
    // Images and other binaries were listed but never downloaded when the
    // project opened. Fetch them now, or the saved folder would be missing them.
    const missing = source?.manifest.filter((m) => m.skipped && !(m.rel in files)) ?? []
    if (source && missing.length > 0 && !fileSystem.isElectron()) {
      const blobs = await fetchBlobs(source, missing, loadAccount()?.token)
      for (const b of blobs) {
        files[b.rel] = b.encoding === 'base64' ? base64ToBytes(b.data) : b.data
      }
    }

    // A repo-linked project keeps its paths, or pushes would stop lining up.
    const link = loadLink(oldRoot)
    const keepPaths = !!link || !!source?.canPush
    // The folder is named after the project — no questions asked. Its main
    // sketch decides the name, since the Arduino IDE needs the two to match.
    const name = suggestProjectName(Object.keys(files), workspace.name)
    const target = await chooseProjectTarget(parent, name)
    const layout = flattenSketchLayout(files, target.name, { keepPaths })
    const newRoot = await writeProjectFolder(parent, target, layout.files)
    if (link) {
      try {
        saveLink(newRoot, link)
      } catch (e) {
        console.warn('Could not carry the repo link to the saved folder:', e)
      }
    }

    // Note which tabs were open, so they can reopen at their new paths.
    const relOf = (p: string): string | null =>
      p.startsWith(oldRoot + '/') ? p.slice(oldRoot.length + 1) : null
    const newPathOf = (p: string): string | null => {
      const rel = relOf(p)
      return rel === null ? null : `${newRoot}/${layout.moved[rel] ?? rel}`
    }
    const tabPaths = openFiles
      .filter((f) => !f.hidden)
      .map((f) => newPathOf(f.path))
      .filter((p): p is string => p !== null)
    const viewing = openFiles.find((f) => f.id === store.getState().file.viewingFileId)
    const viewingPath = viewing ? newPathOf(viewing.path) : null

    await new OpenWorkspaceCommand(newRoot, source).execute()

    const opened = store.getState().file.workspace
    if (opened) {
      for (const path of tabPaths) {
        const item = findFileInTree(opened.root, (i) => i.path === path)
        if (item) await new OpenFileCommand(item).execute()
      }
      const focus = viewingPath && findFileInTree(opened.root, (i) => i.path === viewingPath)
      if (focus) this.dispatch(setViewingFile(focus.id))
    }

    // The project lives on disk now. Drop the browser copy and its cached edits,
    // or they'd resurface over the original the next time it's opened.
    if (isVirtualPath(oldRoot)) {
      try {
        saveLink(oldRoot, null)
      } catch {
        /* ignore */
      }
      await virtualFileSystem.discard(oldRoot)
    }
    this.dispatch(snoozeSavePrompt(null))
    return {
      folder: target.name,
      parent: folderLabel(parent),
      inPlace: target.inPlace,
      linkedTo: link?.remote
    }
  }
}

/**
 * Start a brand-new project that lives only in the browser — the fallback for
 * browsers that can't write folders (Firefox, Safari). It behaves like an
 * opened example: edits persist in browser storage, and the banner explains
 * how to keep it.
 */
export class OpenScratchProjectCommand implements Command {
  constructor(
    private name: string,
    private files: Record<string, string>
  ) {}

  async execute(): Promise<void> {
    const root = `${VIRTUAL_PREFIX}local/${this.name}`
    await virtualFileSystem.discard(root)
    await virtualFileSystem.seed(root, this.files)
    fileSystem.setCurrentWorkspace(root)
    const items = await fileSystem.readDirectory(root, true)
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: this.name,
      path: root,
      root: buildNestedStructure(items)
    }
    await activateWorkspace(workspace, store.dispatch)
  }
}

/**
 * Reopen a folder from the recent list.
 *
 * In the browser that means re-granting access to its stored handle: a
 * permission prompt, which the browser only allows from a click — so a
 * launch-time restore passes `prompt: false` and quietly does nothing if access
 * has lapsed.
 */
export class OpenRecentFolderCommand {
  constructor(
    private entry: RecentProject,
    private opts: { prompt: boolean } = { prompt: true }
  ) {}

  async execute(): Promise<'opened' | 'missing' | 'denied'> {
    if (fileSystem.isElectron()) {
      if (!(await fileSystem.pathExists(this.entry.location))) return 'missing'
      await new OpenWorkspaceCommand(this.entry.location).execute()
      return 'opened'
    }
    const handle = await recentFolderHandle(this.entry.id)
    if (!handle) return 'missing'
    if (!(await ensureFolderAccess(handle, this.opts.prompt))) return 'denied'
    webFileSystem.setRoot(handle)
    try {
      await new OpenWorkspaceCommand(handle.name).execute()
    } catch (e) {
      // A handle outlives its folder: listing a deleted one throws NotFoundError.
      console.warn('Recent folder could not be read:', e)
      return 'missing'
    }
    return 'opened'
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
    // Without this the open tab keeps the old path and the next save recreates
    // the file under its former name.
    this.dispatch(rebaseOpenFiles({ from: oldPath, to: newPath }))
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
    this.dispatch(rebaseOpenFiles({ from: newPath, to: originalPath }))
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
