/**
 * fileCommands — what the app does when someone opens, saves, creates, renames
 * or deletes a project or file. Each action is a plain async function that
 * talks to the file system and the redux store; components call them directly.
 */

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
import { notify as toast, reportError } from '@renderer/lib/notify'
import { STORAGE_KEYS } from '@renderer/lib/storageKeys'
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

const dispatch = store.dispatch

// ── Building the file tree ──────────────────────────────────────────────────

const convertToBaseFileItem = (item: FileSystemItem): BaseFileItem => {
  // The name is the last path segment, whichever slash the platform uses.
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

/**
 * Build the nested tree from a flat directory listing. Items that were already
 * in `existingStructure` keep their ids, so open tabs and expanded folders
 * survive a refresh.
 */
const buildNestedStructure = (
  items: FileSystemItem[],
  existingStructure?: BaseFileItem[]
): BaseFileItem[] => {
  const itemMap = new Map<string, BaseFileItem>()
  const rootItems: BaseFileItem[] = []

  const normalizedPathMap = new Map<string, FileSystemItem>()
  items.forEach((item) => {
    normalizedPathMap.set(item.path.replace(/\\/g, '/'), item)
  })

  // First pass: create every item, reusing an existing id where the path matches.
  normalizedPathMap.forEach((originalItem, normalizedPath) => {
    const existingItem = existingStructure
      ? findExistingItemByPath(existingStructure, normalizedPath)
      : null
    const fresh = convertToBaseFileItem({ ...originalItem, path: normalizedPath })
    const baseItem =
      existingItem && existingItem.type === fresh.type
        ? { ...fresh, id: existingItem.id, parentId: existingItem.parentId }
        : fresh
    itemMap.set(normalizedPath, baseItem)
  })

  // Second pass: attach each item to its parent folder, or to the root.
  normalizedPathMap.forEach((_originalItem, normalizedPath) => {
    const baseItem = itemMap.get(normalizedPath)!
    const lastSlashIndex = normalizedPath.lastIndexOf('/')
    const parentPath = lastSlashIndex > 0 ? normalizedPath.substring(0, lastSlashIndex) : ''
    const parent = parentPath ? itemMap.get(parentPath) : undefined

    if (parent) {
      baseItem.parentId = parent.id
      parent.children?.push(baseItem)
    } else {
      baseItem.parentId = 'root'
      rootItems.push(baseItem)
    }
  })

  // Folders first, then files, each in natural order (file2 before file10).
  const sortRecursively = (level: BaseFileItem[]): BaseFileItem[] => {
    level.sort((a, b) =>
      a.type !== b.type
        ? a.type === 'folder'
          ? -1
          : 1
        : a.name!.localeCompare(b.name!, undefined, { numeric: true })
    )
    for (const item of level) {
      if (item.children && item.children.length > 0) {
        item.children = sortRecursively(item.children)
      }
    }
    return level
  }

  return sortRecursively(rootItems)
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

// ── Opening projects ────────────────────────────────────────────────────────

/**
 * Swap the open workspace to `workspace` and run the standard "just opened a
 * project" side effects: load the README and diagram.svg into their panels, and
 * auto-open the main .ino (or README) so the editor lands on real content.
 */
async function activateWorkspace(workspace: Workspace): Promise<void> {
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
      .catch((e) => console.warn('README not read for the Docs tab:', readme.path, e))
  }

  const diagram = fileItems.find((file) => file.name === 'diagram.svg')
  if (diagram) {
    fileSystem
      .readFile(diagram.path)
      .then((content) => dispatch(updateDiagramSvgContent(content)))
      .catch((e) => console.warn('diagram.svg not read for the README preview:', diagram.path, e))
  }

  const sketch =
    findFileInTree(fileItems, (i) => /\.ino$/i.test(i.name!)) ||
    findFileInTree(fileItems, (i) => i.name === 'README.md')
  if (sketch) await openFileItem(sketch)
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

/**
 * Open a folder as the workspace, asking for one when `folder` is undefined (a
 * cancelled picker does nothing). `source` is set when the folder was
 * materialized from a GitHub repo, so the workspace still knows where it came
 * from and what else lives there.
 */
export async function openFolder(folder?: string, source?: WorkspaceSource): Promise<void> {
  let folderPath = folder
  if (!folderPath) {
    const selected = await fileSystem.selectFolder()
    if (!selected) return
    folderPath = selected
  }

  // The workspace path is the folder itself, with forward slashes like the tree.
  const workspacePath = folderPath.replace(/\\/g, '/').replace(/\/+$/, '')
  fileSystem.setCurrentWorkspace(workspacePath)
  const fileSystemItems = await fileSystem.readDirectory(workspacePath, true)

  if (!isVirtualPath(workspacePath)) {
    // Remember the folder so the app can reopen it on next launch.
    try {
      localStorage.setItem(STORAGE_KEYS.lastWorkspace, workspacePath)
    } catch {
      /* ignore */
    }
    void rememberFolder(workspacePath)
    leaveProjectRoute()
  }

  await activateWorkspace({
    id: crypto.randomUUID(),
    name: workspacePath.split('/').pop() || 'Workspace',
    path: workspacePath,
    root: buildNestedStructure(fileSystemItems),
    source
  })
}

/**
 * Open a project that lives in a GitHub repo folder, without a local folder
 * pick. Powers `/<owner>/<repo>/<path>` deep links and the Examples browser.
 */
export async function loadGitHubProject(
  owner: string,
  repo: string,
  path = '',
  branch?: string
): Promise<void> {
  // A signed-in token raises the rate limit, unlocks private repos, and is
  // what lets us tell whether this user can push to the source repo.
  const token = loadAccount()?.token
  const project = await fetchRepoProject(owner, repo, path, branch, token)
  if (project.manifest.length === 0) {
    throw new Error(`No files found at ${owner}/${repo}${path ? '/' + path : ''}`)
  }

  const source: WorkspaceSource = {
    owner,
    repo,
    branch: project.branch,
    path: project.path,
    manifest: project.manifest,
    truncated: project.truncated,
    canPush: await canPushTo(owner, repo, token)
  }

  // Desktop: materialize the project to a real folder so arduino-cli (via
  // tinyService) can read it from disk. The browser has no disk to write to,
  // so it opens an in-memory `mem://` workspace instead (view and edit only;
  // the Arduino service refuses to compile mem:// paths with a clear message).
  if (fileSystem.isElectron()) {
    // Namespaced by owner/repo, so two repos that each have a `blink/` don't
    // overwrite each other.
    const examplesDir = await window.api.app.getExamplesDir()
    const dir = [examplesDir, owner, repo, path].filter(Boolean).join('/')
    for (const [rel, content] of Object.entries(project.files)) {
      await fileSystem.writeFile(`${dir}/${rel}`, content)
    }
    await openFolder(dir, source)
    return
  }

  const root = `${VIRTUAL_PREFIX}${owner}/${repo}${path ? '/' + path : ''}`
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
        remote: `${owner}/${repo}`,
        branch: project.branch,
        path: project.path,
        base: project.files
      })
    } catch (e) {
      console.warn('Could not save repo link:', e)
    }
  }

  const fsItems = await fileSystem.readDirectory(root, true)
  await activateWorkspace({
    id: crypto.randomUUID(),
    name: path ? path.split('/').pop()! : repo,
    path: root,
    root: buildNestedStructure(fsItems),
    source
  })
}

/**
 * Start a brand-new project that lives only in the browser — the fallback for
 * browsers that can't write folders (Firefox, Safari). It behaves like an
 * opened example: edits persist in browser storage, and the banner explains
 * how to keep it.
 */
export async function openScratchProject(
  name: string,
  files: Record<string, string>
): Promise<void> {
  const root = `${VIRTUAL_PREFIX}local/${name}`
  await virtualFileSystem.discard(root)
  await virtualFileSystem.seed(root, files)
  fileSystem.setCurrentWorkspace(root)
  const items = await fileSystem.readDirectory(root, true)
  await activateWorkspace({
    id: crypto.randomUUID(),
    name,
    path: root,
    root: buildNestedStructure(items)
  })
}

/**
 * Reopen a folder from the recent list.
 *
 * In the browser that means re-granting access to its stored handle: a
 * permission prompt, which the browser only allows from a click — so a
 * launch-time restore passes `prompt: false` and quietly does nothing if access
 * has lapsed. The desktop app has the same rule for folders it has no grant for.
 */
export async function openRecentFolder(
  entry: RecentProject,
  opts: { prompt: boolean } = { prompt: true }
): Promise<'opened' | 'missing' | 'denied'> {
  if (fileSystem.isElectron()) {
    if (!(await fileSystem.pathExists(entry.location))) return 'missing'
    // Folders opened before access was tracked have to be chosen once more.
    if (!(await window.api.fs.hasAccess(entry.location))) {
      if (!opts.prompt) return 'denied'
      const picked = await window.api.fs.selectFolder(entry.location)
      if (!picked) return 'denied'
      await openFolder(picked)
      return 'opened'
    }
    await openFolder(entry.location)
    return 'opened'
  }
  const handle = await recentFolderHandle(entry.id)
  if (!handle) return 'missing'
  if (!(await ensureFolderAccess(handle, opts.prompt))) return 'denied'
  webFileSystem.setRoot(handle)
  try {
    await openFolder(handle.name)
  } catch (e) {
    // A handle outlives its folder: listing a deleted one throws NotFoundError.
    console.warn('Recent folder could not be read:', e)
    return 'missing'
  }
  return 'opened'
}

/** Re-read the workspace folder and rebuild the tree, keeping existing ids. */
export async function refreshWorkspace(workspace: Workspace): Promise<void> {
  const fileSystemItems = await fileSystem.readDirectory(workspace.path, true)
  dispatch(
    openWorkspace({ ...workspace, root: buildNestedStructure(fileSystemItems, workspace.root) })
  )
}

export function closeProject(): void {
  dispatch(closeWorkspace())

  // Forget the remembered folder so the app starts on the empty state next
  // launch instead of silently reopening the project the user just closed.
  try {
    localStorage.removeItem(STORAGE_KEYS.lastWorkspace)
  } catch {
    /* ignore */
  }
}

// ── Making a project the user's own ─────────────────────────────────────────

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
export async function adoptCopiedProject(
  current: Workspace,
  link: RepoLink,
  newOwner: string
): Promise<void> {
  // The repo already exists on GitHub by the time we get here, so a failure to
  // write the local baseline must not read as "the copy failed" — that sends
  // people looking for a repo that is sitting there fine.
  const persistLink = (workspacePath: string): void => {
    try {
      saveLink(workspacePath, link)
    } catch (e) {
      throw new Error(
        `${link.remote} was created and your files were copied, but the local sync ` +
          `baseline could not be saved: ${e instanceof Error ? e.message : 'unknown error'}`
      )
    }
  }

  const [, repoName] = link.remote.split('/')
  const source: WorkspaceSource = {
    owner: newOwner,
    repo: repoName,
    branch: link.branch,
    path: '',
    // The copy is complete, so nothing is outstanding to fetch any more.
    manifest: [],
    truncated: false,
    canPush: true
  }

  // Desktop: the workspace is already a real folder the user owns. Nothing
  // moves — just record the link and that it is now writable.
  if (!isVirtualPath(current.path)) {
    dispatch(openWorkspace({ ...current, source }))
    persistLink(current.path)
    return
  }

  const oldRoot = current.path
  const newRoot = `${VIRTUAL_PREFIX}${newOwner}/${repoName}`

  const openPaths = selectOpenFiles(store.getState()).map((f) => f.path)
  const viewingPath = selectOpenFiles(store.getState()).find(
    (f) => f.id === store.getState().file.viewingFileId
  )?.path

  await virtualFileSystem.rerootTo(oldRoot, newRoot)
  fileSystem.setCurrentWorkspace(newRoot)
  dispatch(rebaseOpenFiles({ from: oldRoot, to: newRoot }))

  const fsItems = await fileSystem.readDirectory(newRoot, true)
  const workspace: Workspace = {
    ...current,
    name: repoName,
    path: newRoot,
    root: buildNestedStructure(fsItems),
    source
  }
  dispatch(openWorkspace(workspace))
  persistLink(newRoot)

  // Re-open each tab against the rebuilt tree so tab ids line up with tree ids
  // again (that is what keeps highlighting and close-from-tree working).
  const rebase = (p: string): string =>
    p.startsWith(oldRoot) ? newRoot + p.slice(oldRoot.length) : p
  for (const path of openPaths.map(rebase)) {
    const item = findFileInTree(workspace.root, (i) => i.path === path)
    if (item) await openFileItem(item)
  }
  if (viewingPath) {
    const want = rebase(viewingPath)
    const item = findFileInTree(workspace.root, (i) => i.path === want)
    if (item) dispatch(setViewingFile(item.id))
  }

  // A refresh should land on the user's own project from here on. The URL is
  // built inline rather than imported from projectRouting, which imports this
  // module — keeping that dependency one-way.
  const url = `/${encodeURIComponent(newOwner)}/${encodeURIComponent(repoName)}`
  if (typeof window !== 'undefined' && window.location.pathname !== url) {
    window.history.pushState({ owner: newOwner, repo: repoName, path: '' }, '', url)
  }
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

  dispatch(setSavingToComputer(true))
  try {
    const saved = await moveProjectToFolder()
    if (!saved) {
      dispatch(snoozeSavePrompt(path))
      return
    }
    const where = saved.inPlace ? '' : `Created inside ${saved.parent}. `
    const linked = saved.linkedTo ? ` Still linked to ${saved.linkedTo} for Push and Pull.` : ''
    toast.success(`Saved to ${saved.folder}`, {
      description: `${where}From now on, Save writes straight to this folder.${linked}`
    })
  } catch (e) {
    reportError('Could not save to your computer', e)
  } finally {
    dispatch(setSavingToComputer(false))
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
 * Resolves to where the project went, or null if the user cancelled.
 */
async function moveProjectToFolder(): Promise<SavedToComputer | null> {
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
    dispatch(saveFileWithContent({ id: f.id, content: f.content }))
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
  const newPathOf = (p: string): string | null => {
    if (!p.startsWith(oldRoot + '/')) return null
    const rel = p.slice(oldRoot.length + 1)
    return `${newRoot}/${layout.moved[rel] ?? rel}`
  }
  const tabPaths = openFiles
    .filter((f) => !f.hidden)
    .map((f) => newPathOf(f.path))
    .filter((p): p is string => p !== null)
  const viewing = openFiles.find((f) => f.id === store.getState().file.viewingFileId)
  const viewingPath = viewing ? newPathOf(viewing.path) : null

  await openFolder(newRoot, source)

  const opened = store.getState().file.workspace
  if (opened) {
    for (const path of tabPaths) {
      const item = findFileInTree(opened.root, (i) => i.path === path)
      if (item) await openFileItem(item)
    }
    const focus = viewingPath && findFileInTree(opened.root, (i) => i.path === viewingPath)
    if (focus) dispatch(setViewingFile(focus.id))
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
  dispatch(snoozeSavePrompt(null))
  return {
    folder: target.name,
    parent: folderLabel(parent),
    inPlace: target.inPlace,
    linkedTo: link?.remote
  }
}

// ── Files and folders in the tree ───────────────────────────────────────────

/**
 * Load a file into an editor buffer. `hidden` loads it as a background buffer
 * for a full-window view (Circuit/Visual) without surfacing it as a code tab —
 * see EditorFile.hidden.
 */
export async function openFileItem(item: BaseFileItem, opts?: { hidden?: boolean }): Promise<void> {
  if (item.type !== 'file' || !item.name) return
  const content = await fileSystem.readFile(item.path)
  const file: EditorFile = {
    id: item.id,
    name: item.name,
    content,
    path: item.path,
    modified: false,
    createdAt: '',
    updatedAt: '',
    hidden: opts?.hidden ?? false
  }
  dispatch(openFile(file))
}

export function setFolderExpanded(item: BaseFileItem, isOpen: boolean): void {
  if (item.type !== 'folder') return
  dispatch(setFolderOpen({ id: item.id, isOpen }))
}

/** Create `name` inside `placeholder.path`, then clear the tree's naming row. */
export async function createFile(placeholder: BaseFileItem, name: string): Promise<void> {
  await fileSystem.createFile(`${placeholder.path}/${name}`)
  dispatch(finishCreateItem(placeholder))
}

export async function createFolder(placeholder: BaseFileItem, name: string): Promise<void> {
  await fileSystem.createFolder(`${placeholder.path}/${name}`)
  dispatch(finishCreateItem(placeholder))
}

export async function renameItem(item: BaseFileItem, newName: string): Promise<void> {
  const oldPath = item.path
  const lastSlashIndex = oldPath.lastIndexOf('/')
  const directoryPath = lastSlashIndex >= 0 ? oldPath.substring(0, lastSlashIndex) : ''
  const newPath = directoryPath ? `${directoryPath}/${newName}` : newName

  await fileSystem.renameFile(oldPath, newPath)
  // Without this the open tab keeps the old path and the next save recreates
  // the file under its former name.
  dispatch(rebaseOpenFiles({ from: oldPath, to: newPath }))
  dispatch(finishCreateItem(item))
}

export async function deleteItem(item: BaseFileItem): Promise<void> {
  await fileSystem.deleteFile(item.path)
  dispatch(closeFile(item.id))
}
