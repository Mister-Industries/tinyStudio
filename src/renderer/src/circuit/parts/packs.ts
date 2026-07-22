/**
 * circuit/parts/packs — GitHub-distributed parts packs (M2 leftover, spec
 * §5.3/§5.4, "Boards-Manager pattern").
 *
 * This targets the app's ACTUAL current parts pipeline — the legacy
 * `lib/partsLibrary` PartDef (v1) persisted via `lib/userParts.ts` (B7) —
 * not the aspirational v2 `registry.ts`/pack.json-with-zips design in the
 * spec, which needs the still-unbuilt M2 parts registry migration first. A
 * pack here is just a manifest of hosted PartDef v1 JSON files (exactly
 * what `scripts/fritzing-import.mjs` / the in-app `.fzpz` importer already
 * emit); installing one calls the same `saveUserPart` every other part
 * source uses. See docs/tinyparts-pack-setup.md for how to host one.
 *
 * Formats:
 *   index.json  { schema: 1, packs: [{ id, name, version, description?, url }] }
 *   pack.json   { schema: 1, id, name, version, parts: [{ type, file }] }
 *   parts/*.json  a plain PartDef (registerPart-compatible)
 *
 * `file`/`url` may be relative — resolved against the manifest/index's own
 * URL, so a pack can ship as a self-contained folder of relative paths.
 */

import type { PartDef } from '../../lib/partsLibrary'
import { saveUserPart } from '../../lib/userParts'

export interface PackIndexEntry {
  id: string
  name: string
  version: string
  description?: string
  url: string
}

export interface PackIndex {
  schema: number
  packs: PackIndexEntry[]
}

export interface PackPartRef {
  type: string
  file: string
}

export interface PackManifest {
  schema: number
  id: string
  name: string
  version: string
  description?: string
  parts: PackPartRef[]
}

/** Seeded per the M2 decision log ("new tinyparts repo under
 * Mister-Industries"); harmless to fetch — a 404 just surfaces as an error
 * row in the UI until the repo/index is published. */
export const DEFAULT_INDEX_URL =
  'https://raw.githubusercontent.com/Mister-Industries/tinyparts/main/index.json'

const LS_INDEX_URLS = 'tinystudio.packs.indexUrls'
const LS_INSTALLED = 'tinystudio.packs.installed'

function resolveUrl(file: string, base: string): string {
  try {
    return new URL(file, base).toString()
  } catch {
    return file
  }
}

async function fetchJson(url: string): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store' })
  } catch (e) {
    throw new Error(`network error fetching ${url}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  try {
    return await res.json()
  } catch {
    throw new Error(`${url} did not return valid JSON`)
  }
}

export async function fetchIndex(url: string): Promise<PackIndex> {
  const json = await fetchJson(url)
  if (!json || typeof json !== 'object' || !Array.isArray((json as PackIndex).packs))
    throw new Error(`${url} is not a valid pack index (expected { packs: [...] })`)
  const idx = json as PackIndex
  // resolve each pack's manifest url relative to the index itself
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

function isPartDef(v: unknown): v is PartDef {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as PartDef).type === 'string' &&
    typeof (v as PartDef).label === 'string' &&
    !!(v as PartDef).views &&
    typeof (v as PartDef).views === 'object'
  )
}

export interface InstallResult {
  installed: string[]
  failed: { type: string; error: string }[]
}

/** Install every part in a manifest via the existing saveUserPart path
 * (registers + persists to IndexedDB, same as the Parts Editor / .fzpz
 * import). Continues past individual part failures. */
export async function installPack(
  manifest: PackManifest,
  manifestUrl: string,
  onProgress?: (done: number, total: number) => void
): Promise<InstallResult> {
  const installed: string[] = []
  const failed: { type: string; error: string }[] = []
  let done = 0
  for (const ref of manifest.parts) {
    try {
      const url = resolveUrl(ref.file, manifestUrl)
      const json = await fetchJson(url)
      if (!isPartDef(json)) throw new Error(`${url} is not a valid part definition`)
      await saveUserPart(json)
      installed.push(ref.type)
    } catch (e) {
      failed.push({ type: ref.type, error: e instanceof Error ? e.message : String(e) })
    } finally {
      done++
      onProgress?.(done, manifest.parts.length)
    }
  }
  if (installed.length) markInstalled(manifest.id, manifest.version)
  return { installed, failed }
}

// ── settings (index URL list + installed-version tracking) ─────────────────

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
  try {
    localStorage.setItem(LS_INDEX_URLS, JSON.stringify(urls))
  } catch {
    /* quota / privacy mode — session-only */
  }
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
  const map = getInstalledPacks()
  map[id] = version
  try {
    localStorage.setItem(LS_INSTALLED, JSON.stringify(map))
  } catch {
    /* quota / privacy mode */
  }
}
