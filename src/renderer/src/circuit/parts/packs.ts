/**
 * circuit/parts/packs: installing parts packs from a pack index (the tinyparts
 * repo on GitHub by default, or any URL serving the same files).
 *
 * An installed pack is downloaded into the parts cache (parts/partsCache.ts)
 * and served as the REMOTE layer of the registry, not copied into the user's
 * own parts, so parts/tinypartsSync.ts can keep it current and a local edit
 * still shadows it.
 *
 * Formats (docs/parts-and-art.md has the full picture):
 *   index.json  { schema: 1, packs: [{ id, name, version, url, bundled?, … }] }
 *   pack.json   { schema: 1, id, name, version, parts: [{ type, dir } | { type, file }] }
 *   parts/<type>/part.json + .svg files   (folder part, editable)
 *   parts/<type>.json                      (single-file PartDef, SVG embedded)
 *
 * `file`/`dir`/`url` may be relative, resolved against the manifest/index's
 * own URL, so a pack can ship as a self-contained folder of relative paths.
 */

import { setLayerParts, setPackInfo } from '../../lib/partsLibrary'
import { SNAPSHOT } from './bundled'
import {
  formatJson,
  isPartDef,
  joinPath,
  loadPack,
  parsePartJson,
  referencedFiles,
  type PackJson,
  type PackPartRef,
  type ReadText
} from './folderPart'
import {
  deleteCachedPack,
  getCachedPack,
  gitBlobSha,
  listCachedPacks,
  putCachedPack,
  readCachedFile,
  type PackOrigin
} from './partsCache'
import { STORAGE_KEYS } from '../../lib/storageKeys'

export type { PackPartRef }
export type PackManifest = PackJson

export interface PackIndexEntry {
  id: string
  name: string
  version: string
  description?: string
  url: string
  group?: string
  icon?: string
  /** ships inside the app; nothing to install */
  bundled?: boolean
  count?: number
}

export interface PackIndex {
  schema: number
  packs: PackIndexEntry[]
}

export const DEFAULT_INDEX_URL =
  'https://raw.githubusercontent.com/Mister-Industries/tinyparts/main/index.json'

const LS_INDEX_URLS = STORAGE_KEYS.packIndexUrls
const LS_INSTALLED = STORAGE_KEYS.installedPacks

function resolveUrl(file: string, base: string): string {
  try {
    return new URL(file, base).toString()
  } catch {
    return file
  }
}

async function fetchResponse(url: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store' })
  } catch (e) {
    throw new Error(`network error fetching ${url}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetchResponse(url)
  try {
    return await res.json()
  } catch {
    throw new Error(`${url} did not return valid JSON`)
  }
}

/** A file's text plus its git blob sha (so the update check can compare it to GitHub). */
export async function fetchText(url: string): Promise<{ text: string; sha: string }> {
  const res = await fetchResponse(url)
  const bytes = new Uint8Array(await res.arrayBuffer())
  return { text: new TextDecoder().decode(bytes), sha: await gitBlobSha(bytes) }
}

export async function fetchIndex(url: string): Promise<PackIndex> {
  const json = await fetchJson(url)
  if (!json || typeof json !== 'object' || !Array.isArray((json as PackIndex).packs))
    throw new Error(`${url} is not a valid pack index (expected { packs: [...] })`)
  const idx = json as PackIndex
  return { ...idx, packs: idx.packs.map((p) => ({ ...p, url: resolveUrl(p.url, url) })) }
}

export async function fetchManifest(url: string): Promise<PackManifest> {
  const json = await fetchJson(url)
  if (
    !json ||
    typeof json !== 'object' ||
    typeof (json as PackManifest).id !== 'string' ||
    !Array.isArray((json as PackManifest).parts)
  )
    throw new Error(`${url} is not a valid pack manifest (expected { id, parts: [...] })`)
  return json as PackManifest
}

/** `raw.githubusercontent.com/<owner>/<repo>/<ref>/packs/<id>/pack.json` → GitHub coordinates. */
export function githubOrigin(manifestUrl: string, packId: string): PackOrigin | null {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(
    manifestUrl
  )
  if (!m || m[4] !== `packs/${packId}/pack.json`) return null
  return { kind: 'github', repo: `${m[1]}/${m[2]}`, ref: m[3], commit: '' }
}

export const isBundledPack = (id: string): boolean => SNAPSHOT.packs.some((p) => p.id === id)

// ── the remote layer ─────────────────────────────────────────────────────────

/** Serve a cached pack as the registry's remote layer (or withdraw it if gone). */
export async function registerCachedPack(id: string): Promise<string[]> {
  const rec = await getCachedPack(id)
  if (!rec) {
    setLayerParts('remote', id, [])
    return []
  }
  const prefix = `packs/${id}/`
  const read: ReadText = async (path) => {
    const rel = path.startsWith(prefix) ? path.slice(prefix.length) : path
    const text = await readCachedFile(id, rel)
    if (text === undefined) throw new Error(`${path} is missing from the parts cache`)
    return text
  }
  const { pack, providers, errors } = await loadPack(`packs/${id}`, read, 'remote')
  setPackInfo(pack)
  setLayerParts('remote', id, providers)
  return errors
}

/** Register every cached pack; call once at startup, before user parts. */
export async function initRemoteLayer(): Promise<void> {
  for (const rec of await listCachedPacks()) {
    try {
      const errors = await registerCachedPack(rec.id)
      for (const e of errors) console.warn(`[parts] cached pack ${rec.id}: ${e}`)
    } catch (e) {
      console.warn(`[parts] couldn't load cached pack ${rec.id}:`, e)
    }
  }
}

export interface InstallResult {
  installed: string[]
  failed: { type: string; error: string }[]
}

/**
 * Download every part in a manifest into the parts cache and make the pack
 * live. Continues past individual part failures; a pack with no successful
 * part isn't stored or marked installed.
 */
export async function installPack(
  manifest: PackManifest,
  manifestUrl: string,
  onProgress?: (done: number, total: number) => void
): Promise<InstallResult> {
  const installed: string[] = []
  const failed: { type: string; error: string }[] = []
  const files: Record<string, { text: string; sha: string }> = {}
  let done = 0

  for (const ref of manifest.parts) {
    try {
      const got: Record<string, { text: string; sha: string }> = {}
      if (ref.dir) {
        const partPath = joinPath(ref.dir, 'part.json')
        const pj = await fetchText(resolveUrl(partPath, manifestUrl))
        const json = parsePartJson(pj.text, resolveUrl(partPath, manifestUrl))
        got[partPath] = pj
        for (const f of referencedFiles(json)) {
          const rel = joinPath(ref.dir, f)
          got[rel] = await fetchText(resolveUrl(rel, manifestUrl))
        }
      } else if (ref.file) {
        const url = resolveUrl(ref.file, manifestUrl)
        const f = await fetchText(url)
        let json: unknown
        try {
          json = JSON.parse(f.text)
        } catch {
          throw new Error(`${url} did not return valid JSON`)
        }
        if (!isPartDef(json)) throw new Error(`${url} is not a valid part definition`)
        got[joinPath(ref.file)] = f
      } else throw new Error('pack entry has neither "dir" nor "file"')
      Object.assign(files, got)
      installed.push(ref.type)
    } catch (e) {
      failed.push({ type: ref.type, error: e instanceof Error ? e.message : String(e) })
    } finally {
      done++
      onProgress?.(done, manifest.parts.length)
    }
  }
  if (!installed.length) return { installed, failed }

  // the manifest byte-for-byte when everything landed (so its sha matches
  // GitHub's); otherwise just the parts that made it, which the next update
  // check will see as changed and retry
  if (failed.length) {
    const kept = { ...manifest, parts: manifest.parts.filter((r) => installed.includes(r.type)) }
    files['pack.json'] = { text: formatJson(kept), sha: '' }
  } else {
    files['pack.json'] = await fetchText(manifestUrl).catch(() => ({
      text: formatJson(manifest),
      sha: ''
    }))
  }

  await putCachedPack(
    {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      origin: githubOrigin(manifestUrl, manifest.id) ?? { kind: 'url', url: manifestUrl },
      files: Object.fromEntries(Object.entries(files).map(([rel, f]) => [rel, f.sha])),
      updatedAt: Date.now()
    },
    files
  )
  await registerCachedPack(manifest.id)
  markInstalled(manifest.id, manifest.version)
  return { installed, failed }
}

/** Remove a downloaded pack; its parts disappear unless another layer has them. */
export async function uninstallPack(id: string): Promise<void> {
  await deleteCachedPack(id)
  setLayerParts('remote', id, [])
  const map = getInstalledPacks()
  delete map[id]
  writeLs(LS_INSTALLED, map)
}

// ── settings (index URL list + installed-version tracking) ─────────────────

function writeLs(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / privacy mode: session-only */
  }
}

export function getIndexUrls(): string[] {
  try {
    const raw = localStorage.getItem(LS_INDEX_URLS)
    if (!raw) return [DEFAULT_INDEX_URL]
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every((u) => typeof u === 'string')
      ? parsed
      : [DEFAULT_INDEX_URL]
  } catch {
    return [DEFAULT_INDEX_URL]
  }
}

export function setIndexUrls(urls: string[]): void {
  writeLs(LS_INDEX_URLS, urls)
}

export function getInstalledPacks(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_INSTALLED)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function markInstalled(id: string, version: string): void {
  writeLs(LS_INSTALLED, { ...getInstalledPacks(), [id]: version })
}
