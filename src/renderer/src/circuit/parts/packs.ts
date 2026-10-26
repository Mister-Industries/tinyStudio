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

import { PART_MANIFEST, unregisterParts, type PartDef } from '../../lib/partsLibrary'
import { deleteUserPart, saveUserPart } from '../../lib/userParts'

export interface PackIndexEntry {
  id: string
  name: string
  version: string
  description?: string
  /** heading the installer files this pack under ("Core", "SparkFun", …) */
  group?: string
  /** 2-letter monogram (or inline SVG) for the palette's vertical tab rail */
  icon?: string
  /** part count, so the installer can show a size without fetching the manifest */
  count?: number
  url: string
}

export interface PackIndex {
  schema: number
  /** preferred group order; anything unlisted sorts after, alphabetically */
  groups?: string[]
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
  group?: string
  icon?: string
  parts: PackPartRef[]
}

/** What we remember about an installed pack, so its palette tab can show a
 * real name and icon after a reload without re-fetching the index. */
export interface InstalledPack {
  id: string
  version: string
  name?: string
  icon?: string
  group?: string
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
      // stamp the pack id so the palette can give this pack its own bin
      // (persisted with the def, so the tab survives a reload)
      await saveUserPart({ ...json, pack: manifest.id })
      installed.push(ref.type)
    } catch (e) {
      failed.push({ type: ref.type, error: e instanceof Error ? e.message : String(e) })
    } finally {
      done++
      onProgress?.(done, manifest.parts.length)
    }
  }
  if (installed.length)
    recordPackMeta({
      id: manifest.id,
      version: manifest.version,
      name: manifest.name,
      icon: manifest.icon,
      group: manifest.group
    })
  return { installed, failed }
}

/** Remove every part belonging to a pack, and forget the pack itself. */
export async function uninstallPack(id: string): Promise<number> {
  const types = PART_MANIFEST.filter((m) => m.pack === id).map((m) => m.type)
  for (const t of types) await deleteUserPart(t)
  unregisterParts(types)
  forgetPack(id)
  return types.length
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

/**
 * Installed packs, keyed by id. The stored shape used to be `id → version`;
 * reads normalise that into the richer record so an upgrade doesn't lose
 * anyone's install history.
 */
export function getInstalledPacks(): Record<string, InstalledPack> {
  let raw: unknown
  try {
    const s = localStorage.getItem(LS_INSTALLED)
    raw = s ? JSON.parse(s) : {}
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, InstalledPack> = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[id] = { id, version: v }
    else if (v && typeof v === 'object')
      out[id] = { version: '', ...(v as Partial<InstalledPack>), id }
  }
  return out
}

/** Look up one installed pack's display metadata (name / icon / group). */
export function getPackMeta(id: string): InstalledPack | undefined {
  return getInstalledPacks()[id]
}

function writeInstalled(map: Record<string, InstalledPack>): void {
  try {
    localStorage.setItem(LS_INSTALLED, JSON.stringify(map))
  } catch {
    /* quota / privacy mode */
  }
}

/** Remember (or refresh) a pack's install record. Fields already stored are
 * kept when the caller doesn't supply them — the migration knows ids and
 * versions but not names, and shouldn't clobber a real install's metadata. */
export function recordPackMeta(pack: InstalledPack): void {
  const map = getInstalledPacks()
  map[pack.id] = { ...map[pack.id], ...pack }
  writeInstalled(map)
}

/** Drop a pack's install record (its parts are handled separately). */
export function forgetPack(id: string): void {
  const map = getInstalledPacks()
  if (!(id in map)) return
  delete map[id]
  writeInstalled(map)
}
