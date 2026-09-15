/**
 * repoSync — one shared view of the open project's GitHub link: what changed
 * since the last sync, whether this account can push, and Push and Pull.
 *
 * The GitHub tab and the push reminder both read it, so the project's files are
 * read once after a change rather than once per view. It refreshes shortly
 * after any file write (FILES_CHANGED_EVENT) and whenever the workspace or the
 * signed-in account changes (track, called by useRepoSync).
 */

import type { Workspace } from '@renderer/redux/fileSlice'
import { FILES_CHANGED_EVENT } from './fileSystem'
import {
  canPushTo,
  changedPaths,
  collectWorkspaceFiles,
  deletedPaths,
  loadLink,
  saveLink,
  type RepoLink
} from './github'
import { pullWorkspace, PushConflictError, pushWorkspace } from './githubSync'
import { notify as toast } from './notify'

export interface RepoSyncState {
  link: RepoLink | null
  /** workspace-relative paths edited or added since the last sync */
  changed: string[]
  /** workspace-relative paths deleted since the last sync */
  deleted: string[]
  /** whether this account can push; null when not linked or not known yet */
  writable: boolean | null
  /** progress text while pushing or pulling */
  busy: string | null
}

const EMPTY: RepoSyncState = { link: null, changed: [], deleted: [], writable: null, busy: null }

let state: RepoSyncState = EMPTY
let workspace: Workspace | null = null
let token: string | undefined
let generation = 0
let pending: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

function update(next: Partial<RepoSyncState>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

export const getRepoSync = (): RepoSyncState => state

export function subscribeRepoSync(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener(FILES_CHANGED_EVENT, scheduleRefresh)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener(FILES_CHANGED_EVENT, scheduleRefresh)
    }
  }
}

/** Saves come in bursts (a pull writes every file), so wait for them to settle. */
function scheduleRefresh(): void {
  clearTimeout(pending)
  pending = setTimeout(() => void refreshRepoSync(), 400)
}

/** Follow this workspace and account. Cheap when nothing changed. */
export function trackRepoSync(ws: Workspace | null, accountToken: string | undefined): void {
  const switched = ws?.path !== workspace?.path || accountToken !== token
  const same = ws === workspace && !switched
  workspace = ws
  token = accountToken
  if (same) return
  if (switched) {
    update({ ...EMPTY })
    void refreshRepoSync()
  } else {
    scheduleRefresh()
  }
}

export async function refreshRepoSync(): Promise<void> {
  const ws = workspace
  const run = ++generation
  const link = ws ? loadLink(ws.path) : null
  if (!ws || !link) {
    update({ link: null, changed: [], deleted: [], writable: null })
    return
  }
  const current = await collectWorkspaceFiles(ws)
  const [owner, repo] = link.remote.split('/')
  const writable = await canPushTo(owner, repo, token)
  if (run !== generation) return
  update({
    link,
    changed: changedPaths(current, link.base),
    deleted: deletedPaths(current, link.base),
    writable
  })
}

const listFiles = (paths: string[]): string =>
  paths.slice(0, 3).join(', ') + (paths.length > 3 ? ` and ${paths.length - 3} more` : '')

/** Push the open project, reporting the outcome. Resolves true when it pushed. */
export async function pushRepo(message?: string): Promise<boolean> {
  const ws = workspace
  const link = state.link
  if (!ws || !link || !token) return false
  update({ busy: 'Pushing…' })
  try {
    const result = await pushWorkspace(ws, link, token, message, (msg) => update({ busy: msg }))
    try {
      saveLink(ws.path, result.link)
    } catch (e) {
      // The commit is on GitHub; only the local record of it failed.
      toast.error(`Pushed to ${link.remote}, but the sync record could not be saved`, {
        description: e instanceof Error ? e.message : String(e)
      })
      return true
    }
    toast.success(
      result.pushed > 0
        ? `Pushed ${result.pushed} file${result.pushed === 1 ? '' : 's'} to ${link.remote}`
        : `${link.remote} already has these changes`
    )
    return true
  } catch (e) {
    if (e instanceof PushConflictError) {
      toast.error(e.message, {
        description:
          'Pull first. Pull keeps your version of those files, so pushing afterwards replaces the version on GitHub.'
      })
    } else {
      toast.error('Push failed', { description: e instanceof Error ? e.message : String(e) })
    }
    return false
  } finally {
    update({ busy: null })
    await refreshRepoSync()
  }
}

/**
 * Pull into the open project, reporting the outcome. `afterWrite` rebuilds the
 * file tree once files have changed on disk.
 */
export async function pullRepo(afterWrite?: (ws: Workspace) => Promise<void>): Promise<boolean> {
  const ws = workspace
  const link = state.link
  if (!ws || !link) return false
  update({ busy: 'Pulling…' })
  try {
    const result = await pullWorkspace(ws, link, token, (msg) => update({ busy: msg }))
    saveLink(ws.path, result.link)
    await afterWrite?.(ws)
    if (result.kept.length > 0) {
      toast.warning(`Pulled ${link.remote}, keeping your version of ${listFiles(result.kept)}`, {
        description: 'GitHub changed those files too. Pushing replaces the version on GitHub.'
      })
    } else {
      toast.success(`Pulled the latest from ${link.remote}`)
    }
    return true
  } catch (e) {
    toast.error('Pull failed', { description: e instanceof Error ? e.message : String(e) })
    return false
  } finally {
    update({ busy: null })
    await refreshRepoSync()
  }
}
