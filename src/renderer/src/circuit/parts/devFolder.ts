/**
 * circuit/parts/devFolder — live parts from a local tinyparts checkout, for
 * people editing the parts library itself. Development only.
 *
 * Two ways in, same behaviour:
 *   - automatic: `npm run dev` / `npm run dev:web` with tinyparts cloned next
 *     to tinyStudio. The dev server serves the checkout (vite-plugin-tinyparts.ts)
 *     and streams file changes.
 *   - chosen: in the desktop dev app, Parts Packs → Developer → Choose folder…
 *     reads any checkout over Electron IPC instead.
 *
 * Either way:
 *   - the bundled and installed packs load from the checkout (the dev layer,
 *     above GitHub and the bundled snapshot);
 *   - saving an .svg in Illustrator (or any file there) reloads the affected
 *     pack within a moment — no restart, no `npm run parts:sync`;
 *   - the Parts editor gets "Save to tinyparts", which writes part.json and the
 *     .svg files into the checkout.
 *
 * Nothing here publishes anything: commit and push tinyparts to share. See
 * docs/parts-and-art.md.
 */

import {
  layerGroups,
  setLayerParts,
  setPackInfo,
  type PartDef,
  type PartProvider,
  type ViewKind
} from '../../lib/partsLibrary'
import { resetUserPart } from '../../lib/userParts'
import { SNAPSHOT } from './bundled'
import {
  VIEW_KINDS,
  formatJson,
  isPartDef,
  joinPath,
  loadPack,
  parsePackJson,
  parsePartJson,
  type PackJson,
  type PartJson,
  type PartJsonView,
  type ReadText
} from './folderPart'
import { getInstalledPacks } from './packs'
import { STORAGE_KEYS } from '../../lib/storageKeys'

const LS_FOLDER = STORAGE_KEYS.tinypartsDevFolder
const LS_OFF = STORAGE_KEYS.tinypartsLive

export interface DevPackStatus {
  id: string
  name: string
  parts: number
  /** a part (or the pack) couldn't load at all */
  errors: string[]
  /** loaded, but something's off — missing pins, unreadable icon… */
  warnings: string[]
  /** part folders on disk that pack.json doesn't list (loaded anyway) */
  unlisted: string[]
}

export interface DevFolderStatus {
  state: 'off' | 'loading' | 'watching' | 'error'
  /** the checkout being served (absolute path) */
  folder: string | null
  /** 'server': the dev server's ../tinyparts · 'folder': a folder chosen in the desktop app */
  mode: 'server' | 'folder' | null
  /** a checkout the dev server offers, even while live parts are off */
  serverRoot: string | null
  packs: DevPackStatus[]
  error?: string
  /** when the last (re)load finished */
  loadedAt?: number
  /** packs touched by the last file change, for a toast */
  lastReload?: string[]
}

// ── file access: dev server HTTP or Electron IPC ─────────────────────────────

interface FolderIO {
  kind: 'server' | 'folder'
  /** absolute path of the checkout */
  root: string
  read: ReadText
  exists(rel: string): Promise<boolean>
  list(rel: string): Promise<{ name: string; isDirectory: boolean }[]>
  write(rel: string, text: string): Promise<void>
  remove(rel: string): Promise<void>
  /** start watching; resolves with a stop function */
  watch(onChange: (paths: string[]) => void): Promise<() => void>
}

const abs = (root: string, rel: string): string => `${root.replace(/[\\/]+$/, '')}/${joinPath(rel)}`

function folderIO(root: string): FolderIO {
  const fs = window.api.fs
  return {
    kind: 'folder',
    root,
    read: (rel) => fs.readFile(abs(root, rel)),
    exists: (rel) => fs.pathExists(abs(root, rel)),
    list: async (rel) =>
      (await fs.readDirectory(abs(root, rel))).map((i) => ({
        name: i.name,
        isDirectory: i.isDirectory
      })),
    write: (rel, text) => fs.writeFile(abs(root, rel), text),
    remove: (rel) => fs.deleteFile(abs(root, rel)),
    watch: async (onChange) => {
      await window.api.parts.watch(root)
      const off = window.api.parts.onChanged(({ paths }) => onChange(paths))
      return () => {
        off()
        void window.api.parts.unwatch()
      }
    }
  }
}

function serverIO(root: string): FolderIO {
  const at = (endpoint: string, rel: string): string =>
    `/__tinyparts/${endpoint}?path=${encodeURIComponent(joinPath(rel))}`
  const ok = async (res: Response, what: string): Promise<Response> => {
    if (!res.ok)
      throw new Error(`${what} → HTTP ${res.status}${res.status === 404 ? ' (not found)' : ''}`)
    return res
  }
  return {
    kind: 'server',
    root,
    read: async (rel) =>
      (await ok(await fetch(at('file', rel), { cache: 'no-store' }), rel)).text(),
    exists: async (rel) => (await (await ok(await fetch(at('exists', rel)), rel)).json()) === true,
    list: async (rel) => (await ok(await fetch(at('list', rel)), rel)).json(),
    write: async (rel, text) =>
      void (await ok(await fetch(at('file', rel), { method: 'PUT', body: text }), rel)),
    remove: async (rel) => void (await ok(await fetch(at('file', rel), { method: 'DELETE' }), rel)),
    watch: async (onChange) => {
      const events = new EventSource('/__tinyparts/events')
      events.onmessage = (e) => {
        try {
          onChange((JSON.parse(e.data) as { paths: string[] }).paths)
        } catch {
          /* malformed event — ignore */
        }
      }
      return () => events.close()
    }
  }
}

/** Is a dev server offering a tinyparts checkout? Resolves with its path. */
async function detectServer(): Promise<string | null> {
  try {
    if (typeof window === 'undefined' || !/^https?:$/.test(location.protocol)) return null
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return null
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 2000)
    const res = await fetch('/__tinyparts/info', { cache: 'no-store', signal: ctl.signal })
    clearTimeout(timer)
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
    const info = (await res.json()) as { root?: unknown }
    return typeof info.root === 'string' ? info.root : null
  } catch {
    return null
  }
}

let isDev: boolean | undefined

/** The desktop app running unpackaged — where a folder can be chosen by hand. */
export function canChooseDevFolder(): boolean {
  if (isDev === undefined) {
    try {
      isDev = typeof window !== 'undefined' && !!window.api?.parts && window.api.app.isDev()
    } catch {
      isDev = false
    }
  }
  return isDev
}

export function getDevFolder(): string | null {
  try {
    return localStorage.getItem(LS_FOLDER)
  } catch {
    return null
  }
}

function liveOff(): boolean {
  try {
    return localStorage.getItem(LS_OFF) === 'off'
  } catch {
    return false
  }
}

function setLs(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* private mode — this session only */
  }
}

// ── status store ─────────────────────────────────────────────────────────────

let status: DevFolderStatus = {
  state: 'off',
  folder: null,
  mode: null,
  serverRoot: null,
  packs: []
}
const listeners = new Set<() => void>()
function setStatus(next: Partial<DevFolderStatus>): void {
  status = { ...status, ...next }
  for (const cb of listeners) cb()
}
export const getDevStatus = (): DevFolderStatus => status
export function onDevStatus(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Parts are being served live from a checkout (so "Save to tinyparts" works). */
export const devFolderActive = (): boolean => !!io && status.state === 'watching'

// ── loading ──────────────────────────────────────────────────────────────────

let io: FolderIO | null = null

/** Packs to serve from the checkout: everything the app would otherwise load. */
function wantedPacks(index: { packs?: { id: string; bundled?: boolean }[] }): string[] {
  const ids = new Set<string>(SNAPSHOT.packs.map((p) => p.id))
  for (const p of index.packs ?? []) if (p.bundled) ids.add(p.id)
  for (const id of Object.keys(getInstalledPacks())) ids.add(id)
  for (const id of layerGroups('remote')) ids.add(id)
  return [...ids]
}

async function unlistedDirs(src: FolderIO, pack: PackJson): Promise<string[]> {
  const partsDir = `packs/${pack.id}/parts`
  if (!(await src.exists(partsDir))) return []
  const listed = new Set(pack.parts.filter((r) => r.dir).map((r) => joinPath(r.dir)))
  const out: string[] = []
  for (const item of await src.list(partsDir)) {
    if (!item.isDirectory) continue
    const rel = `parts/${item.name}`
    if (listed.has(rel)) continue
    if (await src.exists(`packs/${pack.id}/${rel}/part.json`)) out.push(rel)
  }
  return out
}

async function loadDevPack(src: FolderIO, id: string): Promise<DevPackStatus | null> {
  if (!(await src.exists(`packs/${id}/pack.json`))) {
    setLayerParts('dev', id, [])
    return null
  }
  let pack: PackJson
  try {
    pack = parsePackJson(await src.read(`packs/${id}/pack.json`), `packs/${id}/pack.json`)
  } catch (e) {
    setLayerParts('dev', id, [])
    return {
      id,
      name: id,
      parts: 0,
      errors: [e instanceof Error ? e.message : String(e)],
      warnings: [],
      unlisted: []
    }
  }
  const unlisted = await unlistedDirs(src, pack)
  const loaded = await loadPack(`packs/${id}`, src.read, 'dev', {
    absRoot: src.root,
    extraDirs: unlisted
  })
  // build every part now: edits should fail loudly here, not when placed
  const warnings: string[] = []
  const errors = [...loaded.errors]
  const providers: PartProvider[] = []
  await Promise.all(
    loaded.providers.map(async (p) => {
      try {
        const def = p.def ?? (await p.load())
        for (const w of def.source?.warnings ?? []) warnings.push(`${def.type} — ${w}`)
        providers.push({ meta: p.meta, load: async () => def, def })
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e))
      }
    })
  )
  const order = new Map(loaded.providers.map((p, i) => [p.meta.type, i]))
  providers.sort((a, b) => (order.get(a.meta.type) ?? 0) - (order.get(b.meta.type) ?? 0))
  // a stale load (the source changed while this one ran) must not win
  if (io !== src) return null
  setPackInfo(loaded.pack)
  setLayerParts('dev', id, providers)
  for (const dir of unlisted)
    warnings.push(
      `${dir} isn't listed in pack.json yet — run npm run parts:check -- --fix before pushing`
    )
  return { id, name: pack.name, parts: providers.length, errors, warnings, unlisted }
}

// ── lifecycle ────────────────────────────────────────────────────────────────

let stopWatch: (() => void) | null = null
let pending = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

function stop(): void {
  stopWatch?.()
  stopWatch = null
  if (timer) clearTimeout(timer)
  timer = null
  io = null
  for (const id of layerGroups('dev')) setLayerParts('dev', id, [])
}

/**
 * Start (or restart) live parts: a folder chosen in the desktop app wins,
 * otherwise whatever checkout the dev server offers. Safe to call anywhere —
 * in a packaged app or a deployed web build it finds nothing and stays off.
 */
export async function startDevParts(): Promise<void> {
  stop()
  const serverRoot = await detectServer()
  const chosen = canChooseDevFolder() ? getDevFolder() : null
  const src = liveOff()
    ? null
    : chosen
      ? folderIO(chosen)
      : serverRoot
        ? serverIO(serverRoot)
        : null
  if (!src) {
    setStatus({ state: 'off', folder: null, mode: null, serverRoot, packs: [], error: undefined })
    return
  }
  io = src
  setStatus({ state: 'loading', folder: src.root, mode: src.kind, serverRoot, error: undefined })
  try {
    const index = JSON.parse(await src.read('index.json'))
    const packs: DevPackStatus[] = []
    for (const id of wantedPacks(index)) {
      const s = await loadDevPack(src, id)
      if (s) packs.push(s)
    }
    if (io !== src) return
    stopWatch = await src.watch((paths) => onFilesChanged(src, paths))
    setStatus({ state: 'watching', packs, loadedAt: Date.now(), lastReload: undefined })
  } catch (e) {
    stop()
    setStatus({
      state: 'error',
      packs: [],
      error: `Couldn't read the tinyparts checkout at ${src.root}: ${e instanceof Error ? e.message : String(e)}`
    })
  }
}

function onFilesChanged(src: FolderIO, paths: string[]): void {
  for (const p of paths) {
    const m = /^packs\/([^/]+)\//.exec(p.replace(/\\/g, '/'))
    if (m) pending.add(m[1])
    else if (p === 'index.json') pending.add('*')
  }
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void flush(src), 200)
}

async function flush(src: FolderIO): Promise<void> {
  const ids = pending
  pending = new Set()
  if (io !== src) return
  if (ids.has('*')) return startDevParts()
  const live = new Set(status.packs.map((p) => p.id))
  const packs = [...status.packs]
  const reloaded: string[] = []
  for (const id of ids) {
    if (!live.has(id)) continue
    const s = await loadDevPack(src, id)
    const at = packs.findIndex((p) => p.id === id)
    if (s && at >= 0) packs[at] = s
    else if (at >= 0) packs.splice(at, 1)
    reloaded.push(id)
  }
  if (reloaded.length && io === src)
    setStatus({ packs, loadedAt: Date.now(), lastReload: reloaded })
}

/** Desktop dev app: serve a chosen checkout instead of the dev server's. */
export async function setDevFolder(folder: string): Promise<void> {
  setLs(LS_FOLDER, folder)
  setLs(LS_OFF, null)
  return startDevParts()
}

/** Turn live parts on (the dev server's checkout, or the chosen folder) or off. */
export async function setDevPartsEnabled(on: boolean): Promise<void> {
  if (on) {
    setLs(LS_OFF, null)
    return startDevParts()
  }
  setLs(LS_OFF, 'off')
  setLs(LS_FOLDER, null)
  return startDevParts()
}

/** Packs in the checkout a brand-new part could be saved into. */
export async function devTargetPacks(): Promise<{ id: string; name: string }[]> {
  if (!io) return []
  try {
    const index = JSON.parse(await io.read('index.json')) as {
      packs: { id: string; name: string }[]
    }
    return index.packs.map((p) => ({ id: p.id, name: p.name }))
  } catch {
    return []
  }
}

// ── saving back ──────────────────────────────────────────────────────────────

export interface FolderSave {
  pack: string
  /** the edited definition (labels, sizes and pins; its svg strings are NOT written) */
  def: PartDef
  /** the art to write per view, exactly as authored — omitted views keep their file */
  art: Partial<Record<ViewKind, string>>
  /** 'svg': pins come from the art's pin-* ids; 'fixed': write positions into part.json */
  pinMode: Partial<Record<ViewKind, 'svg' | 'fixed'>>
  sizeEdited: Partial<Record<ViewKind, boolean>>
  labelEdited: boolean
}

async function writeIfChanged(src: FolderIO, rel: string, text: string): Promise<void> {
  if ((await src.exists(rel)) && (await src.read(rel)).replace(/\r\n/g, '\n') === text) return
  await src.write(rel, text)
}

/**
 * Write a part into the tinyparts checkout as a folder part, reload its pack,
 * and drop any local edit that would hide the result. Returns the folder path.
 */
export async function savePartToFolder(s: FolderSave): Promise<string> {
  const src = io
  if (!src) throw new Error('Live tinyparts is off (Parts Packs → Developer)')
  const type = s.def.type
  const packRel = `packs/${s.pack}/pack.json`
  const pack = parsePackJson(await src.read(packRel), packRel)
  const ref = pack.parts.find((r) => r.type === type)
  const dirRel = ref?.dir ? joinPath(ref.dir) : `parts/${type}`
  const partDir = `packs/${s.pack}/${dirRel}`
  const partPath = `${partDir}/part.json`

  // start from what's there: the folder's part.json, or the single-file part being converted
  let existing: PartJson | null = null
  let legacy: PartDef | null = null
  if (await src.exists(partPath)) existing = parsePartJson(await src.read(partPath), partPath)
  else if (ref?.file) {
    const json: unknown = JSON.parse(await src.read(`packs/${s.pack}/${ref.file}`))
    if (isPartDef(json)) legacy = json
  }
  const base: Record<string, unknown> = existing
    ? { ...existing }
    : legacy
      ? Object.fromEntries(
          Object.entries(legacy).filter(([k]) => !['views', 'icon', 'source', 'origin'].includes(k))
        )
      : { type, label: s.def.label, family: s.def.family ?? 'Custom' }

  const views: Partial<Record<ViewKind, PartJsonView>> = {}
  for (const kind of VIEW_KINDS) {
    const v = s.def.views[kind]
    if (!v) continue
    const prev = existing?.views[kind]
    const file = prev?.svg ?? `${kind}.svg`
    const art = s.art[kind] ?? (legacy ? legacy.views[kind]?.svg : undefined)
    if (art !== undefined)
      await writeIfChanged(src, `${partDir}/${file}`, art.endsWith('\n') ? art : `${art}\n`)
    const keepSize = !!prev && !s.sizeEdited[kind]
    // 'svg': keep reading positions from the art — as "every pin-* id" if the
    // part already worked that way, else as a name list; 'fixed': positions
    // go into part.json (an edit made by dragging pins in the editor)
    let pins: PartJsonView['pins']
    if (s.pinMode[kind] !== 'svg') pins = v.pins
    else if (prev && prev.pins === undefined) pins = undefined
    else pins = Object.keys(v.pins)
    views[kind] = {
      svg: file,
      width: keepSize ? prev!.width : v.w,
      height: keepSize ? prev!.height : v.h,
      ...(pins !== undefined ? { pins } : {}),
      ...((v.legs ?? prev?.legs)?.length ? { legs: v.legs ?? prev?.legs } : {})
    }
  }

  const json = { ...base, type, views } as PartJson
  if (s.labelEdited || (!existing && !legacy)) json.label = s.def.label
  // a single-file part's own palette icon becomes icon.svg
  if (!existing && legacy?.icon && legacy.icon !== legacy.views.breadboard?.svg) {
    await writeIfChanged(src, `${partDir}/icon.svg`, `${legacy.icon}\n`)
    json.icon = 'icon.svg'
  }
  // keep key order readable: identity first, views last
  const { views: partViews, ...head } = json
  await writeIfChanged(src, partPath, formatJson({ ...head, views: partViews }))

  const nextRef = { type, dir: dirRel }
  const parts = ref ? pack.parts.map((r) => (r === ref ? nextRef : r)) : [...pack.parts, nextRef]
  await writeIfChanged(src, packRel, formatJson({ ...pack, parts }))
  if (ref?.file) await src.remove(`packs/${s.pack}/${ref.file}`)

  await resetUserPart(type)
  // reload now rather than waiting for the watcher (a pack the app didn't
  // load yet — a new part saved into it — starts being served here too)
  const st = await loadDevPack(src, s.pack)
  if (st) {
    const known = status.packs.some((p) => p.id === s.pack)
    setStatus({
      packs: known ? status.packs.map((p) => (p.id === s.pack ? st : p)) : [...status.packs, st],
      loadedAt: Date.now(),
      lastReload: undefined
    })
  }
  return abs(src.root, partDir)
}
