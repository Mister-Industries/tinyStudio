/**
 * circuit/parts/tinypartsSync: keeps the bundled and installed packs current
 * with the tinyparts repo on GitHub, so pushing a part edit to tinyparts
 * reaches every copy of the app on its next launch, no app release.
 *
 * How it stays cheap:
 *  1. One GitHub API call asks for the branch's commit sha. Same as last time
 *     → done.
 *  2. Otherwise one more call lists the repo tree with each file's git blob
 *     sha. A file whose sha matches the bundled snapshot or the local cache is
 *     reused; only changed files are downloaded, from raw.githubusercontent.com
 *     at that exact commit (so a just-pushed change never mixes with stale CDN
 *     copies of its neighbours).
 *  3. If GitHub's pack matches what the app shipped with, the cached copy is
 *     dropped and the bundled one serves again.
 *
 * Failures (offline, rate limit) leave whatever is loaded untouched.
 * `localStorage["tinystudio.tinyparts.source"] = "owner/repo@branch"` points
 * the check at a fork or branch, handy for previewing a tinyparts PR.
 */

import { readBundled, SNAPSHOT } from './bundled'
import { joinPath, parsePackJson, parsePartJson, referencedFiles } from './folderPart'
import { getInstalledPacks, isBundledPack, registerCachedPack } from './packs'
import {
  deleteCachedPack,
  getCachedPack,
  listCachedPacks,
  putCachedPack,
  readCachedFile,
  touchCachedPack
} from './partsCache'
import { setLayerParts } from '../../lib/partsLibrary'
import { STORAGE_KEYS } from '../../lib/storageKeys'

const LS_SOURCE = STORAGE_KEYS.tinypartsSource
const LS_CHECKED = STORAGE_KEYS.tinypartsLastCheck
/** don't ask GitHub more often than this on launch (the button forces a check) */
const MIN_INTERVAL_MS = 15 * 60 * 1000
const TIMEOUT_MS = 20_000

export interface SyncStatus {
  state: 'idle' | 'checking' | 'ok' | 'error'
  /** repo@branch checked */
  source: string
  commit?: string
  checkedAt?: number
  /** packs whose content changed in the last check */
  updated: string[]
  errors: string[]
}

function ls(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

export function tinypartsSource(): { repo: string; ref: string } {
  const m = /^([\w.-]+\/[\w.-]+)(?:@(.+))?$/.exec(ls(LS_SOURCE)?.trim() ?? '')
  return m ? { repo: m[1], ref: m[2] || 'main' } : { repo: SNAPSHOT.repo, ref: 'main' }
}

// ── status store (for useSyncExternalStore) ──────────────────────────────────

const lastChecked = ((): { commit?: string; at?: number } => {
  try {
    return JSON.parse(ls(LS_CHECKED) ?? '{}')
  } catch {
    return {}
  }
})()

let status: SyncStatus = {
  state: 'idle',
  source: `${tinypartsSource().repo}@${tinypartsSource().ref}`,
  commit: lastChecked.commit,
  checkedAt: lastChecked.at,
  updated: [],
  errors: []
}
const listeners = new Set<() => void>()

function setStatus(next: Partial<SyncStatus>): void {
  status = { ...status, ...next }
  for (const cb of listeners) cb()
}
export const getSyncStatus = (): SyncStatus => status
export function onSyncStatus(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// ── GitHub ───────────────────────────────────────────────────────────────────

async function get(url: string, accept?: string): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: ctl.signal,
      headers: accept ? { Accept: accept } : undefined
    })
    if (res.status === 403 || res.status === 429)
      throw new Error('GitHub rate limit reached; try again in a while')
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
    return res
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`${url} timed out`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

async function commitSha(repo: string, ref: string): Promise<string> {
  const res = await get(
    `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`,
    'application/vnd.github.sha'
  )
  const sha = (await res.text()).trim()
  if (!/^[0-9a-f]{40}$/.test(sha))
    throw new Error(`unexpected commit id from GitHub: ${sha.slice(0, 60)}`)
  return sha
}

interface TreeEntry {
  path: string
  type: string
  sha: string
}

/** path → blob sha, for everything under `packs/`. */
async function packsTree(repo: string, commit: string): Promise<Map<string, string>> {
  const api = `https://api.github.com/repos/${repo}/git/trees`
  const res = await get(`${api}/${commit}?recursive=1`)
  const body = (await res.json()) as { tree: TreeEntry[]; truncated?: boolean }
  const out = new Map<string, string>()
  if (!body.truncated) {
    for (const e of body.tree)
      if (e.type === 'blob' && e.path.startsWith('packs/')) out.set(e.path, e.sha)
    return out
  }
  // very large repo: walk down to packs/ and list it on its own
  const top = (await (await get(`${api}/${commit}`)).json()) as { tree: TreeEntry[] }
  const packs = top.tree.find((e) => e.path === 'packs' && e.type === 'tree')
  if (!packs) return out
  const sub = (await (await get(`${api}/${packs.sha}?recursive=1`)).json()) as { tree: TreeEntry[] }
  for (const e of sub.tree) if (e.type === 'blob') out.set(`packs/${e.path}`, e.sha)
  return out
}

async function rawText(repo: string, commit: string, path: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${repo}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`
  const res = await get(url)
  return new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()))
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++])
    })
  )
}

const sameFiles = (a: Record<string, string>, b: Record<string, string>): boolean => {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

// ── one pack ─────────────────────────────────────────────────────────────────

export interface PackSyncResult {
  /** the app now serves different content for this pack */
  changed: boolean
  downloaded: number
  errors: string[]
}

/**
 * Bring one pack in line with `tree` at `commit`. Exported for tests; the app
 * calls syncTinyparts().
 */
export async function syncPack(
  id: string,
  repo: string,
  ref: string,
  commit: string,
  tree: Map<string, string>
): Promise<PackSyncResult> {
  const prefix = `packs/${id}/`
  const errors: string[] = []
  if (!tree.has(`${prefix}pack.json`)) return { changed: false, downloaded: 0, errors }

  const bundled = SNAPSHOT.packs.find((p) => p.id === id)
  const cached = await getCachedPack(id)
  const files: Record<string, { text: string; sha: string }> = {}
  let downloaded = 0

  const fetchFile = async (rel: string): Promise<string> => {
    if (files[rel]) return files[rel].text
    const sha = tree.get(prefix + rel)
    if (!sha) throw new Error(`${prefix}${rel} is referenced but isn't in the repo`)
    let text: string | undefined
    if (cached?.files[rel] === sha) text = await readCachedFile(id, rel)
    if (text === undefined && bundled?.files[rel] === sha) text = await readBundled(prefix + rel)
    if (text === undefined) {
      text = await rawText(repo, commit, prefix + rel)
      downloaded++
    }
    files[rel] = { text, sha }
    return text
  }

  const pack = parsePackJson(await fetchFile('pack.json'), `${prefix}pack.json`)
  await pool(pack.parts, 6, async (partRef) => {
    try {
      if (partRef.file) await fetchFile(joinPath(partRef.file))
      else if (partRef.dir) {
        const partPath = joinPath(partRef.dir, 'part.json')
        const json = parsePartJson(await fetchFile(partPath), prefix + partPath)
        for (const f of referencedFiles(json)) await fetchFile(joinPath(partRef.dir, f))
      }
    } catch (e) {
      errors.push(`${partRef.type}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })

  const shas = Object.fromEntries(Object.entries(files).map(([rel, f]) => [rel, f.sha]))
  if (bundled && sameFiles(shas, bundled.files)) {
    // GitHub matches what shipped: the bundled copy serves
    if (!cached) return { changed: false, downloaded, errors }
    await deleteCachedPack(id)
    setLayerParts('remote', id, [])
    return { changed: true, downloaded, errors }
  }
  const origin = { kind: 'github' as const, repo, ref, commit }
  if (cached && sameFiles(shas, cached.files)) {
    await touchCachedPack({ ...cached, origin })
    return { changed: false, downloaded, errors }
  }
  await putCachedPack(
    { id, name: pack.name, version: pack.version, origin, files: shas, updatedAt: Date.now() },
    files
  )
  errors.push(...(await registerCachedPack(id)))
  return { changed: true, downloaded, errors }
}

// ── everything ───────────────────────────────────────────────────────────────

let running: Promise<SyncStatus> | null = null

/**
 * Check GitHub for changes to the bundled packs and every pack installed from
 * the same repo. Quietly skipped if a check succeeded in the last 15 minutes
 * unless `force`. Resolves with the final status (never rejects).
 */
export function syncTinyparts(opts: { force?: boolean } = {}): Promise<SyncStatus> {
  if (running) return running
  running = (async () => {
    const { repo, ref } = tinypartsSource()
    const source = `${repo}@${ref}`
    if (
      !opts.force &&
      status.state !== 'error' &&
      lastChecked.at &&
      Date.now() - lastChecked.at < MIN_INTERVAL_MS &&
      source === status.source
    )
      return status
    setStatus({ state: 'checking', source, errors: [] })
    try {
      const commit = await commitSha(repo, ref)
      const cached = await listCachedPacks()
      const fromRepo = cached.filter((c) => c.origin.kind === 'github' && c.origin.repo === repo)
      const ids = new Set([
        ...SNAPSHOT.packs.map((p) => p.id),
        ...fromRepo.map((c) => c.id),
        // installed by an older build (copied into user parts); adopt them
        ...Object.keys(getInstalledPacks()).filter(
          (id) => !isBundledPack(id) && !cached.some((c) => c.id === id)
        )
      ])
      const current =
        lastChecked.commit === commit &&
        fromRepo.every((c) => c.origin.kind === 'github' && c.origin.commit === commit) &&
        [...ids].every((id) => isBundledPack(id) || cached.some((c) => c.id === id))
      const updated: string[] = []
      const errors: string[] = []
      if (!current || opts.force) {
        const tree = await packsTree(repo, commit)
        for (const id of ids) {
          try {
            const r = await syncPack(id, repo, ref, commit, tree)
            if (r.changed) updated.push(id)
            errors.push(...r.errors.map((e) => `${id}: ${e}`))
          } catch (e) {
            errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
      }
      lastChecked.commit = commit
      lastChecked.at = Date.now()
      lsSet(LS_CHECKED, JSON.stringify(lastChecked))
      setStatus({ state: 'ok', commit, checkedAt: lastChecked.at, updated, errors })
    } catch (e) {
      setStatus({ state: 'error', errors: [e instanceof Error ? e.message : String(e)] })
    }
    return status
  })().finally(() => {
    running = null
  })
  return running
}
