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
import type { Workspace, BaseFileItem, WorkspaceSource } from '@renderer/redux/fileSlice'
import { githubLinkKey, STORAGE_KEYS } from './storageKeys'

const GH_API = 'https://api.github.com'

/**
 * Extensions we know are text and can hand to the editor. Anything NOT listed
 * here (and without a known bare filename) is treated as **binary** and carried
 * as base64. That default is deliberate: an unknown type round-trips losslessly
 * as base64, whereas guessing "text" and decoding as UTF-8 corrupts it silently.
 *
 * This used to be the gate on whether a file was fetched at all, which meant
 * diagram.svg, index.html and every image simply did not exist as far as the
 * app was concerned. Now it only decides *how* a file is carried.
 */
const TEXT_EXT = [
  // sketches / firmware
  'ino',
  'pde',
  'c',
  'cc',
  'cpp',
  'cxx',
  'h',
  'hh',
  'hpp',
  'hxx',
  's',
  'asm',
  'ld',
  // web + scripting
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'html',
  'htm',
  'css',
  'scss',
  'py',
  'rb',
  'sh',
  'bat',
  'ps1',
  // data + docs
  'json',
  'jsonc',
  'yml',
  'yaml',
  'toml',
  'xml',
  'svg',
  'csv',
  'tsv',
  'md',
  'markdown',
  'txt',
  'rst',
  // config
  'cfg',
  'ini',
  'conf',
  'properties',
  'editorconfig',
  'gitignore',
  'gitattributes'
]

/** Extension-less files that are still text (LICENSE, Makefile, …). */
const TEXT_BARE = [
  'readme',
  'license',
  'licence',
  'notice',
  'authors',
  'changelog',
  'makefile',
  'dockerfile'
]

/** Per-file ceilings. Text is what the editor loads; binaries only ride along on copy. */
const MAX_TEXT_BYTES = 1_000_000
const MAX_BINARY_BYTES = 5_000_000
/** Ceilings for one project fetch, so a mis-aimed deep link can't hang the tab. */
const MAX_PROJECT_FILES = 300
const MAX_PROJECT_BYTES = 25_000_000

export interface GitHubAccount {
  login: string
  name: string
  avatarUrl: string
  token: string
}

export interface RepoLink {
  remote: string // "owner/name"
  branch: string
  /**
   * Folder inside the repo this workspace maps onto; '' means the repo root.
   * Examples and `/<owner>/<repo>/<path>` deep links open a SUBFOLDER, so
   * without this every push flattens the project onto the repo root.
   */
  path: string
  base: Record<string, string> // workspace-relative path -> content at last sync
}

/** What the *authenticated viewer* may do with a repo. */
export interface RepoPermissions {
  admin: boolean
  push: boolean
  pull: boolean
}

export interface RepoMeta {
  fullName: string
  branch: string
  private: boolean
  /**
   * GitHub omits `permissions` for anonymous requests, so every field defaults
   * to false — which is the correct read-only answer for a signed-out user.
   * This is what decides read-only vs writable in the UI: access is a property
   * of the repo + token, never of who we think the user is.
   */
  permissions: RepoPermissions
}

const extOf = (p: string): string => (p.includes('.') ? p.split('.').pop()!.toLowerCase() : '')

const baseNameOf = (p: string): string => p.split('/').pop() || p

/** True when a repo path should be carried as UTF-8 text rather than base64. */
export function isTextPath(p: string): boolean {
  const ext = extOf(p)
  if (ext) return TEXT_EXT.includes(ext)
  return TEXT_BARE.includes(baseNameOf(p).toLowerCase())
}

/** Join a workspace-relative path onto a link's repo folder. */
export function toRepoPath(link: Pick<RepoLink, 'path'>, rel: string): string {
  const base = (link.path || '').replace(/^\/+|\/+$/g, '')
  return base ? `${base}/${rel}` : rel
}

/**
 * Map a repo path back to a workspace-relative one, or null when it falls
 * outside this link's folder (so a pull of a subfolder project ignores the
 * rest of the repo instead of dumping it into the workspace).
 */
export function toWorkspaceRel(link: Pick<RepoLink, 'path'>, repoPath: string): string | null {
  const base = (link.path || '').replace(/^\/+|\/+$/g, '')
  if (!base) return repoPath
  if (repoPath === base) return null
  if (!repoPath.startsWith(base + '/')) return null
  return repoPath.slice(base.length + 1)
}

export interface RepoRef {
  owner: string
  repo: string
  /** folder within the repo ('' = root) */
  path: string
  branch?: string
}

const decodeSegments = (p: string): string => {
  try {
    return p.split('/').map(decodeURIComponent).join('/')
  } catch {
    return p
  }
}

/**
 * Read what someone pasted as "a repo": `owner/repo`, `owner/repo/some/folder`,
 * or a github.com URL — including `/tree/<branch>/<folder>` links copied from
 * the browser, and `/blob/…` links to a file, which open the folder holding it.
 * Null for anything that isn't recognisably a GitHub repo.
 */
export function parseRepoRef(input: string): RepoRef | null {
  const s = input
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
  if (!s) return null

  const url = s.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/(tree|blob)\/([^/\s]+)(?:\/(.*))?)?$/i
  )
  if (url) {
    const [, owner, repo, kind, branch, rest = ''] = url
    let path = rest.replace(/^\/+|\/+$/g, '')
    if (kind === 'blob') path = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    return { owner, repo, path: decodeSegments(path), branch }
  }
  if (/^[a-z]+:\/\//i.test(s) || /\.(com|org|net|io)\//i.test(s)) return null

  const [owner, repo, ...rest] = s.replace(/^\/+/, '').split('/')
  if (!owner || !repo) return null
  if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) return null
  return { owner, repo: repo.replace(/\.git$/, ''), path: rest.filter(Boolean).join('/') }
}

function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token) h.Authorization = 'Bearer ' + token
  return h
}

export async function ghUser(token: string): Promise<GitHubAccount> {
  const r = await fetch(GH_API + '/user', { headers: ghHeaders(token) })
  if (!r.ok)
    throw new Error(
      r.status === 401 ? "Invalid token — check it has 'repo' scope." : 'GitHub error ' + r.status
    )
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
  const r = await fetch(
    GH_API + '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator',
    {
      headers: ghHeaders(token)
    }
  )
  if (!r.ok) throw new Error('Could not list repos (' + r.status + ')')
  const list = (await r.json()) as Array<{
    full_name: string
    name: string
    owner: { login: string }
    description: string | null
    default_branch: string
    private: boolean
    updated_at: string
  }>
  return list.map((x) => ({
    fullName: x.full_name,
    name: x.name,
    owner: x.owner.login,
    desc: x.description || '',
    branch: x.default_branch,
    private: x.private,
    updatedAt: new Date(x.updated_at).getTime()
  }))
}

/**
 * Per-session memo for the two GitHub *API* calls behind fetchRepoFolder.
 * File contents come from raw.githubusercontent (not rate limited), but repo
 * metadata and the tree do count against the anonymous 60 req/hr/IP budget —
 * and the Examples manifest now holds ~70 projects across a handful of repos.
 * Without this, downloading the example set would spend ~140 API calls and get
 * throttled; with it, it costs two per repo.
 */
export interface TreeBlob {
  path: string
  size: number
  sha: string
}

const repoMetaCache = new Map<string, Promise<RepoMeta>>()
const repoTreeCache = new Map<string, Promise<TreeBlob[]>>()

/**
 * Cache keys carry whether the request was authenticated. Permissions and
 * visibility both depend on the token, so an anonymous lookup must never be
 * served back to a signed-in caller — that would report a repo the user can
 * push to as read-only for the rest of the session.
 */
const authTag = (token?: string): string => (token ? 'auth' : 'anon')

/** Drop cached repo metadata/trees (call after a push, or on sign-in/out). */
export function clearRepoCache(): void {
  repoMetaCache.clear()
  repoTreeCache.clear()
}

const NO_PERMISSIONS: RepoPermissions = { admin: false, push: false, pull: false }

async function ghRepoMetaUncached(owner: string, repo: string, token?: string): Promise<RepoMeta> {
  const r = await fetch(`${GH_API}/repos/${owner}/${repo}`, { headers: ghHeaders(token) })
  if (!r.ok)
    throw new Error(
      r.status === 404 ? 'Repo not found (private repos need a token).' : 'GitHub error ' + r.status
    )
  const x = await r.json()
  return {
    fullName: x.full_name,
    branch: x.default_branch,
    private: !!x.private,
    permissions: x.permissions
      ? {
          admin: !!x.permissions.admin,
          push: !!x.permissions.push,
          pull: !!x.permissions.pull
        }
      : NO_PERMISSIONS
  }
}

async function ghRepoMeta(owner: string, repo: string, token?: string): Promise<RepoMeta> {
  const key = `${owner}/${repo}@${authTag(token)}`
  let p = repoMetaCache.get(key)
  if (!p) {
    p = ghRepoMetaUncached(owner, repo, token)
    repoMetaCache.set(key, p)
    // a failed lookup shouldn't be cached — let the next call retry
    p.catch(() => repoMetaCache.delete(key))
  }
  return p
}

/**
 * Can the signed-in user write to this repo? This is the single check that
 * separates "this is my example, push straight to it" from "this is read-only,
 * offer to make a copy" — and it works for collaborators without any extra
 * wiring, because GitHub answers it per-token.
 */
export async function canPushTo(owner: string, repo: string, token?: string): Promise<boolean> {
  if (!token) return false
  try {
    return (await ghRepoMeta(owner, repo, token)).permissions.push
  } catch {
    return false
  }
}

/** Set when the last tree read came back truncated (repo too large to list). */
const truncatedTrees = new Set<string>()

async function ghTreeUncached(
  owner: string,
  repo: string,
  branch: string,
  token?: string
): Promise<TreeBlob[]> {
  const r = await fetch(`${GH_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, {
    headers: ghHeaders(token)
  })
  if (!r.ok) throw new Error('Could not read repo tree (' + r.status + ')')
  const data = await r.json()
  if (data.truncated) truncatedTrees.add(`${owner}/${repo}@${branch}`)
  return (data.tree || [])
    .filter((t: { type?: string }) => t.type === 'blob')
    .map((t: { path: string; size?: number; sha: string }) => ({
      path: t.path,
      size: t.size ?? 0,
      sha: t.sha
    }))
}

async function ghTree(
  owner: string,
  repo: string,
  branch: string,
  token?: string
): Promise<TreeBlob[]> {
  const key = `${owner}/${repo}@${branch}@${authTag(token)}`
  let p = repoTreeCache.get(key)
  if (!p) {
    p = ghTreeUncached(owner, repo, branch, token)
    repoTreeCache.set(key, p)
    p.catch(() => repoTreeCache.delete(key))
  }
  return p
}

const rawUrl = (owner: string, repo: string, branch: string, path: string): string =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`

/**
 * Fetch one blob. Public content comes from raw.githubusercontent, which does
 * not count against the API rate limit; private repos 404 there, so with a
 * token in hand we retry through the API's raw media type.
 */
async function ghBlobResponse(
  owner: string,
  repo: string,
  path: string,
  branch: string,
  token?: string
): Promise<Response> {
  const raw = await fetch(rawUrl(owner, repo, branch, path))
  if (raw.ok) return raw
  if (!token) throw new Error('fetch failed ' + path + ' (' + raw.status + ')')
  const api = await fetch(
    `${GH_API}/repos/${owner}/${repo}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?ref=${encodeURIComponent(branch)}`,
    { headers: { ...ghHeaders(token), Accept: 'application/vnd.github.raw' } }
  )
  if (!api.ok) throw new Error('fetch failed ' + path + ' (' + api.status + ')')
  return api
}

async function ghFile(
  owner: string,
  repo: string,
  path: string,
  branch: string,
  token?: string
): Promise<string> {
  return (await ghBlobResponse(owner, repo, path, branch, token)).text()
}

/** Fetch a blob as base64 — the encoding the Contents API wants on the way back out. */
async function ghFileBase64(
  owner: string,
  repo: string,
  path: string,
  branch: string,
  token?: string
): Promise<string> {
  const buf = await (await ghBlobResponse(owner, repo, path, branch, token)).arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  // Chunked so a multi-MB file doesn't blow the argument limit on String.fromCharCode.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export interface RepoFileEntry {
  /** path relative to the requested folder — how the workspace sees it */
  rel: string
  /** full path within the repo */
  repoPath: string
  size: number
  /** carried as base64 rather than UTF-8 text */
  binary: boolean
  /** bytes were not fetched at open time (binary, oversized, or over budget) */
  skipped: boolean
  /** why it was skipped, for the UI to explain rather than silently drop it */
  skipReason?: 'binary' | 'too-large' | 'budget'
  sha: string
}

export interface RepoProject {
  owner: string
  repo: string
  branch: string
  /** folder within the repo ('' = root) */
  path: string
  /** text files only: rel -> content. This is what the editor opens. */
  files: Record<string, string>
  /** EVERY file in the folder, fetched or not — what a faithful copy must reproduce. */
  manifest: RepoFileEntry[]
  /** the repo tree came back truncated; the manifest may be incomplete */
  truncated: boolean
}

/** Run `work` over `items` with a small concurrency window, preserving order. */
async function pooled<T, R>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await work(items[i], i)
    }
  })
  await Promise.all(runners)
  return out
}

/**
 * Fetch one folder of a repo as an openable project.
 *
 * Text files are downloaded now (that's what the editor needs). Binaries are
 * *listed but not downloaded* — their bytes are only needed when the project is
 * copied to a new repo, and pulling them at open time would cost load speed and
 * browser memory for files nobody is going to look at. `manifest` is the record
 * of what exists, so a later copy can fetch the rest and still be complete.
 *
 * This replaces the old behaviour where a non-text extension meant the file was
 * never fetched AND never recorded — which is why diagram.svg silently vanished
 * from examples.
 */
export async function fetchRepoProject(
  owner: string,
  repo: string,
  folder = '',
  branch?: string,
  token?: string,
  onProgress?: (msg: string) => void
): Promise<RepoProject> {
  const resolvedBranch = branch || (await ghRepoMeta(owner, repo, token)).branch
  const base = folder.replace(/^\/+|\/+$/g, '') // normalize, no leading/trailing slash
  const prefix = base ? base + '/' : ''
  const blobs = await ghTree(owner, repo, resolvedBranch, token)

  const inFolder = blobs.filter((b) => base === '' || b.path === base || b.path.startsWith(prefix))
  if (inFolder.length === 0)
    return {
      owner,
      repo,
      branch: resolvedBranch,
      path: base,
      files: {},
      manifest: [],
      truncated: false
    }

  const manifest: RepoFileEntry[] = []
  let budget = MAX_PROJECT_BYTES
  for (const b of inFolder.slice(0, MAX_PROJECT_FILES)) {
    const rel = base ? b.path.slice(prefix.length) : b.path
    if (!rel) continue
    const binary = !isTextPath(b.path)
    const cap = binary ? MAX_BINARY_BYTES : MAX_TEXT_BYTES
    let skipped = true
    let skipReason: RepoFileEntry['skipReason'] = 'binary'
    if (b.size > cap) skipReason = 'too-large'
    else if (!binary && b.size > budget) skipReason = 'budget'
    else if (!binary) {
      skipped = false
      skipReason = undefined
      budget -= b.size
    }
    manifest.push({ rel, repoPath: b.path, size: b.size, binary, skipped, skipReason, sha: b.sha })
  }

  const toFetch = manifest.filter((m) => !m.skipped)
  let done = 0
  const files: Record<string, string> = {}
  await pooled(toFetch, 6, async (m) => {
    try {
      files[m.rel] = await ghFile(owner, repo, m.repoPath, resolvedBranch, token)
    } catch {
      /* unreadable blob — leave it out of files; it stays in the manifest */
    }
    onProgress?.(`Loading ${++done}/${toFetch.length} · ${m.rel}`)
  })

  return {
    owner,
    repo,
    branch: resolvedBranch,
    path: base,
    files,
    manifest,
    truncated:
      truncatedTrees.has(`${owner}/${repo}@${resolvedBranch}`) ||
      inFolder.length > MAX_PROJECT_FILES
  }
}

export interface FetchedBlob {
  rel: string
  data: string
  encoding: 'utf-8' | 'base64'
}

/**
 * Pull the bytes for manifest entries that weren't loaded at open time. Used by
 * the copy flow so a new repo gets images, diagram.svg and anything else the
 * editor never needed to open.
 */
export async function fetchBlobs(
  project: Pick<RepoProject, 'owner' | 'repo' | 'branch'>,
  entries: RepoFileEntry[],
  token?: string,
  onProgress?: (msg: string) => void
): Promise<FetchedBlob[]> {
  const { owner, repo, branch } = project
  let done = 0
  const results = await pooled(entries, 4, async (m): Promise<FetchedBlob | null> => {
    try {
      const data = m.binary
        ? await ghFileBase64(owner, repo, m.repoPath, branch, token)
        : await ghFile(owner, repo, m.repoPath, branch, token)
      return { rel: m.rel, data, encoding: m.binary ? 'base64' : 'utf-8' }
    } catch {
      return null
    } finally {
      onProgress?.(`Copying ${++done}/${entries.length} · ${m.rel}`)
    }
  })
  return results.filter((r): r is FetchedBlob => r !== null)
}

function b64encode(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
}

/**
 * Percent-encode each path segment but keep the separators. Encoding the whole
 * path collapses '/' into %2F, which stops addressing a nested file — it only
 * went unnoticed while every push landed on the repo root.
 */
const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/')

async function ghGetSha(
  owner: string,
  repo: string,
  path: string,
  branch: string,
  token: string
): Promise<string | null> {
  const r = await fetch(
    `${GH_API}/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
    {
      headers: ghHeaders(token)
    }
  )
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
  message: string,
  /** content is ALREADY base64 (a binary carried through verbatim) */
  preEncoded = false
): Promise<void> {
  const sha = await ghGetSha(owner, repo, path, branch, token)
  const body: Record<string, unknown> = {
    message,
    content: preEncoded ? content : b64encode(content),
    branch
  }
  if (sha) body.sha = sha
  const r = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
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

/**
 * GitHub silently rewrites invalid repo names (spaces become hyphens, other
 * characters are dropped), so a user who types "Blink Example" gets a repo
 * called something they didn't ask for. Do the rewrite up front instead, where
 * they can see it before committing to it.
 */
export function sanitizeRepoName(input: string): string {
  return input
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100)
}

/** False when the name is already taken on that account. */
export async function ghRepoNameAvailable(
  login: string,
  name: string,
  token: string
): Promise<boolean> {
  const r = await fetch(`${GH_API}/repos/${login}/${encodeURIComponent(name)}`, {
    headers: ghHeaders(token)
  })
  if (r.status === 404) return true
  if (r.ok) return false
  // Anything else (rate limit, network) is not a definitive "taken" — let the
  // create call be the authority rather than blocking the user on a guess.
  return true
}

/** Suggest `name-2`, `name-3`… until one is free. */
export async function suggestRepoName(login: string, name: string, token: string): Promise<string> {
  const base = sanitizeRepoName(name)
  if (await ghRepoNameAvailable(login, base, token)) return base
  for (let n = 2; n <= 20; n++) {
    const candidate = `${base}-${n}`
    if (await ghRepoNameAvailable(login, candidate, token)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

export interface CopyResult {
  link: RepoLink
  /** files written to the new repo */
  copied: number
  /** workspace-relative paths that could not be copied */
  failed: string[]
}

/**
 * Create a new repo owned by the signed-in user and copy a project into it.
 *
 * The push set is the working tree PLUS any file the source project listed but
 * never downloaded — images, diagram.svg, firmware blobs. Without that second
 * half the copy silently loses whatever the editor didn't happen to need, and
 * the user only finds out later.
 *
 * The new repo is rooted at its own top level (`path: ''`) even when the source
 * lived in a subfolder of someone else's repo, so the copy is a project in its
 * own right rather than a fragment.
 */
export async function copyProjectToNewRepo(opts: {
  name: string
  token: string
  isPrivate?: boolean
  description?: string
  /** current working tree, workspace-relative — includes the user's edits */
  files: Record<string, string>
  /** where the project came from, for the files whose bytes were deferred */
  source?: WorkspaceSource
  onProgress?: (msg: string) => void
}): Promise<CopyResult> {
  const { name, token, isPrivate = false, description, files, source, onProgress } = opts

  onProgress?.('Creating repository…')
  const repo = await ghCreateRepo(sanitizeRepoName(name), token, isPrivate, description)
  const [owner, repoName] = repo.fullName.split('/')

  // Anything the source folder had that the working tree doesn't: binaries we
  // deliberately deferred, and files that were too large to open.
  const missing = (source?.manifest ?? []).filter((m) => m.skipped && !(m.rel in files))
  let extras: FetchedBlob[] = []
  if (missing.length > 0 && source) {
    onProgress?.(`Fetching ${missing.length} more file(s) from the original…`)
    extras = await fetchBlobs(
      { owner: source.owner, repo: source.repo, branch: source.branch },
      missing,
      token,
      onProgress
    )
  }

  const textEntries = Object.entries(files)
  const total = textEntries.length + extras.length
  const failed: string[] = []
  let done = 0

  for (const [rel, content] of textEntries) {
    onProgress?.(`Copying ${++done}/${total} · ${rel}`)
    try {
      await ghPutFile(owner, repoName, rel, content, repo.branch, token, 'Copy from tinyStudio')
    } catch {
      failed.push(rel)
    }
  }
  for (const blob of extras) {
    onProgress?.(`Copying ${++done}/${total} · ${blob.rel}`)
    try {
      await ghPutFile(
        owner,
        repoName,
        blob.rel,
        blob.data,
        repo.branch,
        token,
        'Copy from tinyStudio',
        blob.encoding === 'base64'
      )
    } catch {
      failed.push(blob.rel)
    }
  }

  // Baseline is the text working tree: that is exactly what a later diff reads
  // back off disk, so a fresh copy starts with nothing to push.
  const link: RepoLink = {
    remote: repo.fullName,
    branch: repo.branch,
    path: '',
    base: { ...files }
  }
  clearRepoCache()
  return { link, copied: total - failed.length, failed }
}

// ── workspace ⇄ disk helpers ────────────────────────────────────────

/** Folders we never sync or even walk into. */
const IGNORED_DIRS = ['.git', 'node_modules', 'dist', 'build', 'out', '.vscode', '.DS_Store']

const rel = (workspace: Workspace, absPath: string): string =>
  absPath.replace(/\\/g, '/').slice(workspace.path.replace(/\\/g, '/').length + 1)

/**
 * Walk the workspace tree, reading every text file into a { relpath: content }
 * map. Paths are workspace-relative; mapping them into the repo is the caller's
 * job (see toRepoPath) because the workspace may be a subfolder of the repo.
 */
export async function collectWorkspaceFiles(workspace: Workspace): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (items: BaseFileItem[]): Promise<void> => {
    for (const item of items) {
      if (item.type === 'folder') {
        // Skipping these is not just tidiness: walking .git on a real repo means
        // reading thousands of loose objects on every change refresh.
        if (item.name && IGNORED_DIRS.includes(item.name)) continue
        if (item.children) await walk(item.children)
      } else if (item.type === 'file' && item.name && isTextPath(item.name)) {
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

export function changedPaths(
  current: Record<string, string>,
  base: Record<string, string>
): string[] {
  return Object.keys(current).filter((p) => current[p] !== (base[p] ?? null))
}

/** Workspace-relative paths present at the last sync but gone from the working tree. */
export function deletedPaths(
  current: Record<string, string>,
  base: Record<string, string>
): string[] {
  return Object.keys(base).filter((p) => !(p in current))
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
    await ghPutFile(
      owner,
      repo,
      toRepoPath(link, p),
      current[p],
      link.branch,
      token,
      message || `Update ${p} via tinyStudio`
    )
  }
  return { pushed: paths.length, base: current }
}

/**
 * Pull the repo folder this link points at down to disk, then return the new
 * baseline snapshot. Keys are workspace-relative on both sides — mixing repo
 * paths into the baseline is what used to make every file read as changed the
 * moment a subfolder project was linked.
 */
export async function pullWorkspace(
  workspace: Workspace,
  link: RepoLink,
  token: string | undefined,
  onProgress?: (msg: string) => void
): Promise<Record<string, string>> {
  const [owner, repo] = link.remote.split('/')
  onProgress?.('Reading tree…')
  const blobs = await ghTree(owner, repo, link.branch, token)

  const wanted: Array<{ rel: string; repoPath: string }> = []
  for (const b of blobs) {
    const r = toWorkspaceRel(link, b.path)
    if (r === null) continue
    if (!isTextPath(b.path) || b.size > MAX_TEXT_BYTES) continue
    wanted.push({ rel: r, repoPath: b.path })
  }
  if (wanted.length > MAX_PROJECT_FILES) {
    throw new Error(
      `That folder has ${wanted.length} text files, over the ${MAX_PROJECT_FILES}-file limit for a single sync.`
    )
  }

  const base: Record<string, string> = {}
  let i = 0
  for (const w of wanted) {
    i++
    onProgress?.(`Pulling ${i}/${wanted.length} · ${w.rel}`)
    try {
      const content = await ghFile(owner, repo, w.repoPath, link.branch, token)
      base[w.rel] = content
      await fileSystem.writeFile(`${workspace.path}/${w.rel}`, content)
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

const ACCOUNT_KEY = STORAGE_KEYS.githubAccount
const linkKey = githubLinkKey

/** The desktop auth bridge, when running under Electron. */
const desktopAuth = (): typeof window.api.github | undefined =>
  typeof window !== 'undefined' ? window.api?.github : undefined

/**
 * The signed-in account for this session.
 *
 * On desktop the token is owned by the main process and kept in the OS keychain
 * (safeStorage); the renderer holds it in memory only. On web there is nowhere
 * safer than localStorage yet, so the PAT path still persists there until the
 * PKCE flow lands.
 *
 * Kept synchronous because callers reach for it mid-operation (opening a deep
 * link, publishing); `initAccount` hydrates it once at startup.
 */
let currentAccount: GitHubAccount | null = null

export function loadAccount(): GitHubAccount | null {
  return currentAccount
}

/** Hydrate the account at startup: from the keychain on desktop, storage on web. */
export async function initAccount(): Promise<GitHubAccount | null> {
  const bridge = desktopAuth()
  if (bridge) {
    try {
      currentAccount = await bridge.getAccount()
    } catch {
      currentAccount = null
    }
  } else {
    try {
      const raw = localStorage.getItem(ACCOUNT_KEY)
      currentAccount = raw ? (JSON.parse(raw) as GitHubAccount) : null
    } catch {
      currentAccount = null
    }
  }
  clearRepoCache()
  return currentAccount
}

export function saveAccount(account: GitHubAccount | null): void {
  currentAccount = account
  // Desktop persistence is the main process's job — writing the token here too
  // would put back the plaintext copy the keychain exists to avoid.
  if (!desktopAuth()) {
    try {
      if (account) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account))
      else localStorage.removeItem(ACCOUNT_KEY)
    } catch {
      /* storage unavailable — the in-memory account still works this session */
    }
  }
  // Permissions and repo visibility are token-dependent, so anything cached
  // under the previous auth state is now wrong.
  clearRepoCache()
}

export function loadLink(workspacePath: string): RepoLink | null {
  try {
    const raw = localStorage.getItem(linkKey(workspacePath))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RepoLink>
    if (!parsed.remote || !parsed.branch) return null
    // Links written before subfolder support have no `path`; they were all
    // repo-root links, so '' is the faithful migration.
    return {
      remote: parsed.remote,
      branch: parsed.branch,
      path: parsed.path ?? '',
      base: parsed.base ?? {}
    }
  } catch {
    return null
  }
}

/**
 * Persist a workspace's repo link. Throws on quota — the baseline is a full
 * copy of every text file, so a large project can exceed the ~5 MB localStorage
 * budget. Failing loudly matters: a silently dropped baseline makes the next
 * push re-upload the entire project.
 */
export function saveLink(workspacePath: string, link: RepoLink | null): void {
  if (!link) {
    localStorage.removeItem(linkKey(workspacePath))
    return
  }
  try {
    localStorage.setItem(linkKey(workspacePath), JSON.stringify(link))
  } catch (e) {
    const files = Object.keys(link.base).length
    throw new Error(
      `Could not save the sync baseline for this project (${files} files). ` +
        'Browser storage is full — clear site data or use a smaller project. ' +
        `(${e instanceof Error ? e.message : 'quota exceeded'})`
    )
  }
}
