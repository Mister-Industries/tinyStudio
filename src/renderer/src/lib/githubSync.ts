/**
 * githubSync — Push and Pull for a workspace linked to a GitHub repo.
 *
 * Push makes one commit through GitHub's Git Data API: a tree built on the
 * branch's current tree, a commit on top of its head, then a fast-forward of the
 * branch. Deleted files go in the same commit. Before anything is written, each
 * file's blob id on GitHub is compared with the id recorded at the last sync, so
 * a file someone changed on GitHub since then is never silently overwritten.
 *
 * Pull brings in GitHub's version of every file this project hasn't changed.
 * A file changed both here and on GitHub keeps the local edit and is reported.
 *
 * Like the baseline in lib/github.ts, both work on text files only.
 */

import type { Workspace } from '@renderer/redux/fileSlice'
import { fileSystem } from './fileSystem'
import {
  changedPaths,
  clearRepoCache,
  collectWorkspaceFiles,
  deletedPaths,
  isTextPath,
  MAX_PROJECT_FILES,
  MAX_TEXT_BYTES,
  toRepoPath,
  toWorkspaceRel,
  type RepoLink
} from './github'

const GH_API = 'https://api.github.com'

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

const encodeSegments = (path: string): string => path.split('/').map(encodeURIComponent).join('/')

/** A GitHub request that failed, with its HTTP status. */
export class GitHubRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'GitHubRequestError'
  }
}

async function requestError(r: Response, what: string): Promise<GitHubRequestError> {
  const j = (await r.json().catch(() => ({}))) as { message?: string }
  return new GitHubRequestError(`${what}: ${j.message || 'GitHub error'} (${r.status})`, r.status)
}

function sendJson(
  method: 'POST' | 'PATCH',
  path: string,
  token: string,
  body: unknown
): Promise<Response> {
  return fetch(`${GH_API}${path}`, {
    method,
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

async function inBatches<T>(
  items: T[],
  size: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(work))
  }
}

/** Git's id for a file's contents: SHA-1 over `blob <byte length>\0` and the bytes. */
export async function gitBlobSha(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(content)
  const header = encoder.encode(`blob ${bytes.length}\0`)
  const data = new Uint8Array(header.length + bytes.length)
  data.set(header)
  data.set(bytes, header.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface RemoteFile {
  sha: string
  size: number
  mode: string
}

/** Every file in a repo at one commit. */
export interface RemoteSnapshot {
  commit: string
  /** the commit's root tree */
  tree: string
  /** repo path -> file */
  files: Map<string, RemoteFile>
  truncated: boolean
}

/** The branch's current commit. Never cached: it's the thing that moves. */
export async function branchHead(
  owner: string,
  repo: string,
  branch: string,
  token?: string
): Promise<string> {
  const r = await fetch(
    `${GH_API}/repos/${owner}/${repo}/git/ref/heads/${encodeSegments(branch)}`,
    {
      headers: headers(token)
    }
  )
  if (!r.ok) throw await requestError(r, `Could not read ${owner}/${repo}@${branch}`)
  return ((await r.json()) as { object: { sha: string } }).object.sha
}

export async function snapshotAt(
  owner: string,
  repo: string,
  commit: string,
  token?: string
): Promise<RemoteSnapshot> {
  const c = await fetch(`${GH_API}/repos/${owner}/${repo}/git/commits/${commit}`, {
    headers: headers(token)
  })
  if (!c.ok) throw await requestError(c, `Could not read commit ${commit.slice(0, 7)}`)
  const tree = ((await c.json()) as { tree: { sha: string } }).tree.sha

  const t = await fetch(`${GH_API}/repos/${owner}/${repo}/git/trees/${tree}?recursive=1`, {
    headers: headers(token)
  })
  if (!t.ok) throw await requestError(t, 'Could not read the list of files')
  const data = (await t.json()) as {
    truncated?: boolean
    tree?: Array<{ path: string; mode: string; type: string; sha: string; size?: number }>
  }
  const files = new Map<string, RemoteFile>()
  for (const e of data.tree ?? []) {
    if (e.type === 'blob') files.set(e.path, { sha: e.sha, size: e.size ?? 0, mode: e.mode })
  }
  return { commit, tree, files, truncated: !!data.truncated }
}

/**
 * One file's text at a commit. raw.githubusercontent doesn't count against the
 * API rate limit; private repos 404 there, so a token retries through the API.
 */
async function fileAt(
  owner: string,
  repo: string,
  repoPath: string,
  commit: string,
  token?: string
): Promise<string> {
  const raw = await fetch(
    `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${encodeSegments(repoPath)}`
  )
  if (raw.ok) return raw.text()
  if (!token) throw new Error(`Could not read ${repoPath} (${raw.status})`)
  const api = await fetch(
    `${GH_API}/repos/${owner}/${repo}/contents/${encodeSegments(repoPath)}?ref=${commit}`,
    { headers: { ...headers(token), Accept: 'application/vnd.github.raw' } }
  )
  if (!api.ok) throw new Error(`Could not read ${repoPath} (${api.status})`)
  return api.text()
}

/** The blob id a workspace file had at the last sync, or undefined if it wasn't there. */
async function syncedId(link: RepoLink, rel: string): Promise<string | undefined> {
  if (!(rel in link.base)) return undefined
  return link.baseSha?.[rel] ?? gitBlobSha(link.base[rel])
}

/**
 * Paths GitHub changed since the last sync to something other than ours: pushing
 * them would overwrite someone else's work. Ids are blob ids, undefined for a
 * file that doesn't exist on that side.
 */
export function conflictingPaths(
  paths: string[],
  ids: {
    remote: Record<string, string | undefined>
    synced: Record<string, string | undefined>
    ours: Record<string, string | undefined>
  }
): string[] {
  return paths.filter((p) => ids.remote[p] !== ids.synced[p] && ids.remote[p] !== ids.ours[p])
}

/** The commit message Push uses when none is typed. */
export function defaultPushMessage(changed: string[], deleted: string[]): string {
  const name = (p: string): string => p.split('/').pop() || p
  if (changed.length + deleted.length === 1) {
    return changed.length ? `Update ${name(changed[0])}` : `Delete ${name(deleted[0])}`
  }
  if (deleted.length === 0 && changed.length === 2) {
    return `Update ${name(changed[0])} and ${name(changed[1])}`
  }
  if (changed.length === 0) return `Delete ${deleted.length} files`
  const updates = `Update ${changed.length} file${changed.length === 1 ? '' : 's'}`
  return deleted.length ? `${updates}, delete ${deleted.length}` : updates
}

const conflictMessage = (paths: string[]): string =>
  `GitHub has newer changes to ${paths.slice(0, 3).join(', ')}${
    paths.length > 3 ? ` and ${paths.length - 3} more` : ''
  }.`

/** Push refused because GitHub changed files this push would overwrite. */
export class PushConflictError extends Error {
  constructor(readonly paths: string[]) {
    super(conflictMessage(paths))
    this.name = 'PushConflictError'
  }
}

export interface PushResult {
  /** files the commit changed on GitHub */
  pushed: number
  /** the link with its baseline moved to what was pushed */
  link: RepoLink
}

/** Push `current` (workspace-relative text files) as one commit. */
export async function pushFiles(
  link: RepoLink,
  current: Record<string, string>,
  token: string,
  message?: string,
  onProgress?: (msg: string) => void
): Promise<PushResult> {
  const [owner, repo] = link.remote.split('/')
  const changed = changedPaths(current, link.base)
  const deleted = deletedPaths(current, link.base)
  if (changed.length === 0 && deleted.length === 0) return { pushed: 0, link }

  onProgress?.('Checking GitHub for newer changes…')
  const head = await branchHead(owner, repo, link.branch, token)
  const remote = await snapshotAt(owner, repo, head, token)

  const paths = [...changed, ...deleted]
  const ids = {
    remote: {} as Record<string, string | undefined>,
    synced: {} as Record<string, string | undefined>,
    ours: {} as Record<string, string | undefined>
  }
  for (const p of paths) {
    ids.remote[p] = remote.files.get(toRepoPath(link, p))?.sha
    ids.synced[p] = await syncedId(link, p)
    ids.ours[p] = p in current ? await gitBlobSha(current[p]) : undefined
  }
  const conflicts = conflictingPaths(paths, ids)
  if (conflicts.length > 0) throw new PushConflictError(conflicts)

  // A file GitHub already has exactly as ours needs nothing sent.
  const entries = paths
    .filter((p) => ids.remote[p] !== ids.ours[p])
    .map((p) => {
      const path = toRepoPath(link, p)
      const mode = remote.files.get(path)?.mode ?? '100644'
      return p in current
        ? { path, mode, type: 'blob', content: current[p] }
        : { path, mode, type: 'blob', sha: null }
    })

  let commit = head
  if (entries.length > 0) {
    onProgress?.(`Pushing ${entries.length} file${entries.length === 1 ? '' : 's'}…`)
    const base = `/repos/${owner}/${repo}/git`
    const t = await sendJson('POST', `${base}/trees`, token, {
      base_tree: remote.tree,
      tree: entries
    })
    if (!t.ok) throw await requestError(t, 'Push failed')
    const tree = ((await t.json()) as { sha: string }).sha

    const c = await sendJson('POST', `${base}/commits`, token, {
      message: message?.trim() || defaultPushMessage(changed, deleted),
      tree,
      parents: [head]
    })
    if (!c.ok) throw await requestError(c, 'Push failed')
    const created = ((await c.json()) as { sha: string }).sha

    const moved = await sendJson(
      'PATCH',
      `${base}/refs/heads/${encodeSegments(link.branch)}`,
      token,
      {
        sha: created,
        force: false
      }
    )
    if (!moved.ok) {
      // Someone pushed between our read of the branch and this update.
      if (moved.status === 422 || moved.status === 409) {
        throw new Error(`${link.branch} changed on GitHub while pushing. Push again.`)
      }
      throw await requestError(moved, 'Push failed')
    }
    commit = created
    clearRepoCache()
  }

  const baseSha: Record<string, string> = {}
  for (const [rel, id] of Object.entries(link.baseSha ?? {})) if (rel in current) baseSha[rel] = id
  for (const p of paths) {
    const id = ids.ours[p]
    if (id) baseSha[p] = id
  }
  return { pushed: entries.length, link: { ...link, base: { ...current }, baseSha, commit } }
}

/**
 * What Pull does with one file. `ours` is the file in the workspace now, `synced`
 * at the last sync and `theirs` on GitHub; undefined means it doesn't exist there.
 *  - same: nothing to do
 *  - ours: only this project changed it; keep it
 *  - take: only GitHub changed it (or this is the first sync); write GitHub's
 *  - conflict: both changed it; keep ours and report it
 */
export function pullDecision(
  ours: string | undefined,
  synced: string | undefined,
  theirs: string | undefined,
  firstSync: boolean
): 'same' | 'ours' | 'take' | 'conflict' {
  if (ours === theirs) return 'same'
  if (!firstSync && theirs === synced) return 'ours'
  if (firstSync || ours === synced) return 'take'
  return 'conflict'
}

export interface PullResult {
  /** the link with its baseline moved to GitHub's current commit */
  link: RepoLink
  /** workspace-relative path -> content to write */
  writes: Record<string, string>
  /** files GitHub deleted that this project hadn't changed */
  removes: string[]
  /** files changed both here and on GitHub, kept as they are here */
  kept: string[]
}

/** Work out a pull of the link's branch against `current` (workspace-relative text files). */
export async function pullFiles(
  link: RepoLink,
  current: Record<string, string>,
  token?: string,
  onProgress?: (msg: string) => void
): Promise<PullResult> {
  const [owner, repo] = link.remote.split('/')
  onProgress?.('Reading GitHub…')
  const head = await branchHead(owner, repo, link.branch, token)
  const remote = await snapshotAt(owner, repo, head, token)
  const firstSync = Object.keys(link.base).length === 0

  const wanted: Array<{ rel: string; repoPath: string; file: RemoteFile }> = []
  for (const [repoPath, file] of remote.files) {
    const rel = toWorkspaceRel(link, repoPath)
    if (rel === null || !isTextPath(repoPath) || file.size > MAX_TEXT_BYTES) continue
    wanted.push({ rel, repoPath, file })
  }
  if (wanted.length > MAX_PROJECT_FILES) {
    throw new Error(
      `That folder has ${wanted.length} text files, over the ${MAX_PROJECT_FILES}-file limit for a single sync.`
    )
  }

  const theirs: Record<string, string> = {}
  let done = 0
  await inBatches(wanted, 6, async (w) => {
    // Unchanged on GitHub since the last sync: the baseline already has its text.
    theirs[w.rel] =
      link.baseSha?.[w.rel] === w.file.sha && w.rel in link.base
        ? link.base[w.rel]
        : await fileAt(owner, repo, w.repoPath, head, token)
    onProgress?.(`Pulling ${++done}/${wanted.length} · ${w.rel}`)
  })

  const writes: Record<string, string> = {}
  const kept: string[] = []
  const base: Record<string, string> = {}
  const baseSha: Record<string, string> = {}
  for (const w of wanted) {
    const decision = pullDecision(current[w.rel], link.base[w.rel], theirs[w.rel], firstSync)
    if (decision === 'take') writes[w.rel] = theirs[w.rel]
    if (decision === 'conflict') kept.push(w.rel)
    base[w.rel] = theirs[w.rel]
    baseSha[w.rel] = w.file.sha
  }

  const removes: string[] = []
  if (!firstSync) {
    for (const rel of Object.keys(link.base)) {
      if (rel in theirs || !(rel in current)) continue
      if (pullDecision(current[rel], link.base[rel], undefined, false) === 'take') removes.push(rel)
      else kept.push(rel)
    }
  }

  return { link: { ...link, base, baseSha, commit: head }, writes, removes, kept }
}

/** Push the workspace's working tree. */
export async function pushWorkspace(
  workspace: Workspace,
  link: RepoLink,
  token: string,
  message?: string,
  onProgress?: (msg: string) => void
): Promise<PushResult> {
  return pushFiles(link, await collectWorkspaceFiles(workspace), token, message, onProgress)
}

/** Pull into the workspace: writes GitHub's changes and removes what GitHub deleted. */
export async function pullWorkspace(
  workspace: Workspace,
  link: RepoLink,
  token?: string,
  onProgress?: (msg: string) => void
): Promise<PullResult> {
  const result = await pullFiles(link, await collectWorkspaceFiles(workspace), token, onProgress)
  for (const [rel, content] of Object.entries(result.writes)) {
    await fileSystem.writeFile(`${workspace.path}/${rel}`, content)
  }
  for (const rel of result.removes) {
    await fileSystem.deleteFile(`${workspace.path}/${rel}`)
  }
  return result
}

export type CloneLinkResult =
  | { link: RepoLink }
  | { problem: 'not-on-github' | 'too-big'; message: string }

/**
 * A link for a folder cloned from GitHub, synced to the commit the clone has
 * checked out, so changes are measured the way `git status` would measure them.
 */
export async function linkForClone(
  clone: { owner: string; repo: string; branch: string; head: string },
  token?: string
): Promise<CloneLinkResult> {
  const { owner, repo, branch, head } = clone
  let snapshot: RemoteSnapshot
  try {
    snapshot = await snapshotAt(owner, repo, head, token)
  } catch (e) {
    if (e instanceof GitHubRequestError && [404, 409, 422].includes(e.status)) {
      return {
        problem: 'not-on-github',
        message: `This folder's commit ${head.slice(0, 7)} isn't on GitHub${
          token ? '' : ', or the repo is private and you are not signed in'
        }.`
      }
    }
    throw e
  }

  const wanted = [...snapshot.files].filter(
    ([path, file]) => isTextPath(path) && file.size <= MAX_TEXT_BYTES
  )
  if (snapshot.truncated || wanted.length > MAX_PROJECT_FILES) {
    return {
      problem: 'too-big',
      message: `${owner}/${repo} has more than ${MAX_PROJECT_FILES} text files, too many to track.`
    }
  }

  const base: Record<string, string> = {}
  const baseSha: Record<string, string> = {}
  await inBatches(wanted, 6, async ([path, file]) => {
    base[path] = await fileAt(owner, repo, path, head, token)
    baseSha[path] = file.sha
  })
  return {
    link: {
      remote: `${owner}/${repo}`,
      branch,
      path: '',
      base,
      baseSha,
      commit: head,
      clone: { head }
    }
  }
}
