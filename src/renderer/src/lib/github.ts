/**
 * GitHub integration (ported from the tinyStudio prototype, adapted to the
 * real workspace filesystem). Public repos work unauthenticated; a Personal
 * Access Token with `repo` scope unlocks listing your repos and push/publish.
 *
 * Change tracking follows the prototype's design: the push set is the working
 * tree diffed against a baseline snapshot (taken at the last push/pull/clone),
 * NOT the editor's unsaved state. Saving does not stage; only Push/Pull do.
 */

import { fileSystem } from './fileSystem'
import type { Workspace, BaseFileItem } from '@renderer/redux/fileSlice'

const GH_API = 'https://api.github.com'
const TEXT_EXT = [
  'ino', 'cpp', 'cc', 'c', 'h', 'hpp', 'js', 'jsx', 'ts', 'json', 'md', 'txt', 'cfg', 'ini', 'yml', 'yaml', 'py'
]

export interface GitHubAccount {
  login: string
  name: string
  avatarUrl: string
  token: string
}
export interface RepoLink {
  remote: string // "owner/name"
  branch: string
  base: Record<string, string> // relpath -> content at last sync
}

const extOf = (p: string): string => (p.includes('.') ? p.split('.').pop()!.toLowerCase() : '')

function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token) h.Authorization = 'Bearer ' + token
  return h
}

export async function ghUser(token: string): Promise<GitHubAccount> {
  const r = await fetch(GH_API + '/user', { headers: ghHeaders(token) })
  if (!r.ok)
    throw new Error(r.status === 401 ? "Invalid token — check it has 'repo' scope." : 'GitHub error ' + r.status)
  const u = await r.json()
  return { login: u.login, name: u.name || u.login, avatarUrl: u.avatar_url, token }
}

export interface RepoSummary {
  fullName: string
  name: string
  owner: string
  desc: string
  branch: string
  private: boolean
  updatedAt: number
}

export async function ghRepos(token: string): Promise<RepoSummary[]> {
  const r = await fetch(GH_API + '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator', {
    headers: ghHeaders(token)
  })
  if (!r.ok) throw new Error('Could not list repos (' + r.status + ')')
  const list = await r.json()
  return list.map((x: any) => ({
    fullName: x.full_name,
    name: x.name,
    owner: x.owner.login,
    desc: x.description || '',
    branch: x.default_branch,
    private: x.private,
    updatedAt: new Date(x.updated_at).getTime()
  }))
}

async function ghRepoMeta(owner: string, repo: string, token?: string): Promise<{ fullName: string; branch: string }> {
  const r = await fetch(`${GH_API}/repos/${owner}/${repo}`, { headers: ghHeaders(token) })
  if (!r.ok)
    throw new Error(r.status === 404 ? 'Repo not found (private repos need a token).' : 'GitHub error ' + r.status)
  const x = await r.json()
  return { fullName: x.full_name, branch: x.default_branch }
}

async function ghTree(
  owner: string,
  repo: string,
  branch: string,
  token?: string
): Promise<Array<{ path: string; size: number }>> {
  const r = await fetch(`${GH_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, {
    headers: ghHeaders(token)
  })
  if (!r.ok) throw new Error('Could not read repo tree (' + r.status + ')')
  const data = await r.json()
  return (data.tree || []).filter((t: any) => t.type === 'blob')
}

async function ghFile(owner: string, repo: string, path: string, branch: string): Promise<string> {
  const r = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`)
  if (!r.ok) throw new Error('fetch failed ' + path)
  return r.text()
}

/**
 * Fetch a single folder (a project) out of a public repo as a flat
 * { relpath: content } map, where relpath is relative to `folder`. Used to open
 * `/<owner>/<repo>/<path>` deep links and Examples in the editor without a local
 * folder pick. Only text files (TEXT_EXT) under ~200 KB are pulled; content
 * comes from raw.githubusercontent to stay off the GitHub API rate limit.
 */
export async function fetchRepoFolder(
  owner: string,
  repo: string,
  folder = '',
  branch?: string,
  token?: string
): Promise<Record<string, string>> {
  const resolvedBranch = branch || (await ghRepoMeta(owner, repo, token)).branch
  const base = folder.replace(/^\/+|\/+$/g, '') // normalize, no leading/trailing slash
  const prefix = base ? base + '/' : ''
  const blobs = await ghTree(owner, repo, resolvedBranch, token)
  const wanted = blobs.filter(
    (b) =>
      (base === '' || b.path === base || b.path.startsWith(prefix)) &&
      TEXT_EXT.includes(extOf(b.path)) &&
      b.size < 200000
  )
  const out: Record<string, string> = {}
  for (const b of wanted) {
    const rel = base ? b.path.slice(prefix.length) : b.path
    if (!rel) continue
    try {
      out[rel] = await ghFile(owner, repo, b.path, resolvedBranch)
    } catch {
      /* skip unreadable blob */
    }
  }
  return out
}

function b64encode(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
}

async function ghGetSha(owner: string, repo: string, path: string, branch: string, token: string): Promise<string | null> {
  const r = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`, {
    headers: ghHeaders(token)
  })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('read ' + path + ' failed (' + r.status + ')')
  return (await r.json()).sha
}

async function ghPutFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  branch: string,
  token: string,
  message: string
): Promise<void> {
  const sha = await ghGetSha(owner, repo, path, branch, token)
  const body: Record<string, unknown> = { message, content: b64encode(content), branch }
  if (sha) body.sha = sha
  const r = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error((e.message || 'push failed') + ' (' + r.status + ')')
  }
}

export async function ghCreateRepo(
  name: string,
  token: string,
  isPrivate: boolean,
  desc?: string
): Promise<{ fullName: string; branch: string }> {
  const r = await fetch(`${GH_API}/user/repos`, {
    method: 'POST',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      private: !!isPrivate,
      description: desc || 'Built with tinyStudio',
      auto_init: true
    })
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error((e.message || 'create failed') + ' (' + r.status + ')')
  }
  const j = await r.json()
  return { fullName: j.full_name, branch: j.default_branch || 'main' }
}

// ── workspace ⇄ disk helpers ─────────────────────────────────────────────────

const rel = (workspace: Workspace, absPath: string): string =>
  absPath.replace(/\\/g, '/').slice(workspace.path.replace(/\\/g, '/').length + 1)

/** Walk the workspace tree, reading every text file into a { relpath: content } map. */
export async function collectWorkspaceFiles(workspace: Workspace): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (items: BaseFileItem[]): Promise<void> => {
    for (const item of items) {
      if (item.type === 'folder' && item.children) await walk(item.children)
      else if (item.type === 'file' && item.name && TEXT_EXT.includes(extOf(item.name))) {
        try {
          out[rel(workspace, item.path)] = await fileSystem.readFile(item.path)
        } catch {
          /* unreadable — skip */
        }
      }
    }
  }
  await walk(workspace.root)
  return out
}

export function changedPaths(current: Record<string, string>, base: Record<string, string>): string[] {
  return Object.keys(current).filter((p) => current[p] !== (base[p] ?? null))
}

/** Push the working-tree diff against the baseline; returns the count pushed. */
export async function pushWorkspace(
  workspace: Workspace,
  link: RepoLink,
  token: string,
  message: string,
  onProgress?: (msg: string) => void
): Promise<{ pushed: number; base: Record<string, string> }> {
  const [owner, repo] = link.remote.split('/')
  const current = await collectWorkspaceFiles(workspace)
  const paths = changedPaths(current, link.base)
  let i = 0
  for (const p of paths) {
    i++
    onProgress?.(`Pushing ${i}/${paths.length} · ${p}`)
    await ghPutFile(owner, repo, p, current[p], link.branch, token, message || `Update ${p} via tinyStudio`)
  }
  return { pushed: paths.length, base: current }
}

/** Pull the repo tree to disk, then return the new baseline snapshot. */
export async function pullWorkspace(
  workspace: Workspace,
  link: RepoLink,
  token: string | undefined,
  onProgress?: (msg: string) => void
): Promise<Record<string, string>> {
  const [owner, repo] = link.remote.split('/')
  onProgress?.('Reading tree…')
  const blobs = await ghTree(owner, repo, link.branch, token)
  const text = blobs.filter((b) => TEXT_EXT.includes(extOf(b.path)) && b.size < 200000).slice(0, 200)
  const base: Record<string, string> = {}
  let i = 0
  for (const b of text) {
    i++
    onProgress?.(`Pulling ${i}/${text.length} · ${b.path}`)
    try {
      const content = await ghFile(owner, repo, b.path, link.branch)
      base[b.path] = content
      await fileSystem.writeFile(`${workspace.path}/${b.path}`, content)
    } catch {
      /* skip */
    }
  }
  return base
}

/**
 * Push a single file to the repo (used by Publish to drop index.html in).
 */
export async function pushFile(
  remote: string,
  branch: string,
  path: string,
  content: string,
  token: string,
  message: string
): Promise<void> {
  const [owner, repo] = remote.split('/')
  await ghPutFile(owner, repo, path, content, branch, token, message)
}

/**
 * Enable GitHub Pages for the repo (served from the branch root) and return the
 * site URL. Safe to call repeatedly — a 409 means it's already enabled.
 */
export async function enablePages(remote: string, branch: string, token: string): Promise<string> {
  const [owner, repo] = remote.split('/')
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}/pages`, {
    method: 'POST',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: { branch, path: '/' } })
  })
  if (!res.ok && res.status !== 409 && res.status !== 201) {
    const e = await res.json().catch(() => ({}))
    // 422 here is almost always: Pages on a private repo isn't available on the
    // free plan. Make the repo public (or upgrade) and try again.
    if (res.status === 422) {
      throw new Error(
        'GitHub Pages needs a public repo on the free plan. Make this repository public on GitHub, then publish again.'
      )
    }
    throw new Error((e.message || 'Could not enable Pages') + ' (' + res.status + ')')
  }
  // Fetch the site to get its canonical URL (falls back to the conventional one).
  try {
    const get = await fetch(`${GH_API}/repos/${owner}/${repo}/pages`, { headers: ghHeaders(token) })
    if (get.ok) {
      const j = await get.json()
      if (j.html_url) return j.html_url as string
    }
  } catch {
    /* fall through */
  }
  return `https://${owner}.github.io/${repo}/`
}

export { ghRepoMeta }

// ── persistence (localStorage) ───────────────────────────────────────────────

const ACCOUNT_KEY = 'tinystudio.github.account'
const linkKey = (workspacePath: string): string => `tinystudio.github.link.${workspacePath}`

export function loadAccount(): GitHubAccount | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY)
    return raw ? (JSON.parse(raw) as GitHubAccount) : null
  } catch {
    return null
  }
}
export function saveAccount(account: GitHubAccount | null): void {
  if (account) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account))
  else localStorage.removeItem(ACCOUNT_KEY)
}

export function loadLink(workspacePath: string): RepoLink | null {
  try {
    const raw = localStorage.getItem(linkKey(workspacePath))
    return raw ? (JSON.parse(raw) as RepoLink) : null
  } catch {
    return null
  }
}
export function saveLink(workspacePath: string, link: RepoLink | null): void {
  if (link) localStorage.setItem(linkKey(workspacePath), JSON.stringify(link))
  else localStorage.removeItem(linkKey(workspacePath))
}
