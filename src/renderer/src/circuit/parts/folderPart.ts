/**
 * circuit/parts/folderPart — the tinyparts on-disk format, and turning it into
 * live PartDefs. See docs/parts-and-art.md for the author-facing guide.
 *
 * A pack is a folder in the tinyparts repo:
 *
 *   packs/<pack-id>/
 *     pack.json                  { id, name, version, parts: [{ type, dir }] }
 *     parts/<type>/
 *       part.json                name, category, size, pin names, buses
 *       breadboard.svg           ← real SVG files: open them in Illustrator
 *       schematic.svg            (optional)
 *       icon.svg                 (optional palette tile)
 *
 * Older packs list single-file parts instead (`{ type, file }` → a PartDef JSON
 * with the SVG embedded as a string). Both load through here; only folder parts
 * are hand-editable.
 *
 * Pure: every file access goes through a `ReadText`, so the same code serves
 * the bundled snapshot (Vite imports), the GitHub cache (IndexedDB) and a local
 * tinyparts checkout (Electron IPC).
 */

import type {
  PartDef,
  PartLayer,
  PartMeta,
  PartProvider,
  PartSource,
  PartView,
  ViewKind
} from '../../lib/partsLibrary'
import { artPrefix, namespaceSvg, prepareArt, readSvgRoot, scanPins } from './svgArt'
import { toPx } from './svgUnits'

export const VIEW_KINDS: ViewKind[] = ['breadboard', 'schematic']

export interface PartJsonView {
  /** file name of this view's art, relative to the part folder */
  svg: string
  /** part box size: px @ 96 DPI as a number, or a length ("1.9in", "25mm") */
  width?: number | string
  height?: number | string
  /**
   * - omitted: every `pin-<NAME>` element in the SVG is a pin, in file order
   * - array of names: the pins this part must have, in this order — read from
   *   the SVG, with a warning for any the art is missing
   * - object `{ name: [x, y] }`: fixed positions; the SVG ids are ignored
   */
  pins?: string[] | Record<string, [number, number]>
  /** pins with a bendable rubber-band leg (Fritzing-derived parts) */
  legs?: string[]
}

export interface PartJson {
  type: string
  label: string
  family?: string
  simFamily?: string
  prefix?: string
  sub?: string
  accent?: string
  builtin?: boolean
  /** palette tile art, relative to the part folder (defaults to the breadboard art) */
  icon?: string
  /** groups of pins wired together inside the part (tinyProto's power rails) */
  buses?: string[][]
  /** the part this one is a package variant of: it gets no palette tile of its own */
  variantOf?: string
  views: Partial<Record<ViewKind, PartJsonView>>
  [extra: string]: unknown
}

export interface PackPartRef {
  type: string
  /** folder part: its directory inside the pack, e.g. "parts/tinycore" */
  dir?: string
  /** legacy single-file part: a PartDef JSON inside the pack */
  file?: string
  /** the palette section the part is listed under (Fritzing's bin sections: "Basic", "Input"…) */
  section?: string
}

export interface PackJson {
  schema: number
  id: string
  name: string
  version: string
  description?: string
  group?: string
  icon?: string
  /** ships inside the app and loads without an install */
  bundled?: boolean
  /** palette section order; parts are listed in `parts` order within each */
  sections?: string[]
  parts: PackPartRef[]
  [extra: string]: unknown
}

export type ReadText = (path: string) => Promise<string>

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * JSON as a person would write it: two-space indent, but arrays of plain values
 * on one line (`"pins": ["GND", "3V3", …]`, `[0.96, 3.93]`), wrapped at `width`.
 * scripts/parts-tool.mjs has the same function — keep them in step.
 */
export function formatJson(value: unknown, width = 100): string {
  const text = JSON.stringify(value, null, 2)
  return (
    text.replace(
      /^( *)(.*)\[\n((?:\1 {2}[^[\]{}\n]*\n)+)\1\]/gm,
      (_m, indent: string, head: string, body: string) => {
        const items = body
          .split('\n')
          .filter(Boolean)
          .map((l) => l.trim().replace(/,$/, ''))
        const oneLine = `${indent}${head}[${items.join(', ')}]`
        if (oneLine.length <= width) return oneLine
        const lines: string[] = []
        let cur = ''
        for (const item of items) {
          if (cur && indent.length + 2 + cur.length + item.length + 2 > width) {
            lines.push(`${indent}  ${cur.trimEnd()}`)
            cur = ''
          }
          cur += `${item}, `
        }
        lines.push(`${indent}  ${cur.replace(/, $/, '')}`)
        return `${indent}${head}[\n${lines.join('\n')}\n${indent}]`
      }
    ) + '\n'
  )
}

/** Join pack-relative path segments with forward slashes, dropping `./`. */
export function joinPath(...parts: (string | undefined)[]): string {
  return parts
    .filter((p): p is string => !!p)
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/\.\//g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/')
}

function lengthPx(v: number | string | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  return toPx(v)
}

// ── validation ───────────────────────────────────────────────────────────────

function fail(where: string, msg: string): never {
  throw new Error(`${where}: ${msg}`)
}

export function parsePackJson(text: string, where: string): PackJson {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch (e) {
    fail(where, `not valid JSON (${e instanceof Error ? e.message : String(e)})`)
  }
  const p = v as PackJson
  if (!p || typeof p !== 'object') fail(where, 'expected an object')
  if (typeof p.id !== 'string' || !p.id) fail(where, 'missing "id"')
  if (!Array.isArray(p.parts)) fail(where, 'missing "parts" array')
  for (const ref of p.parts) {
    if (!ref || typeof ref.type !== 'string') fail(where, 'every parts[] entry needs a "type"')
    if (!ref.dir && !ref.file) fail(where, `parts entry "${ref.type}" needs "dir" or "file"`)
  }
  return p
}

export function parsePartJson(text: string, where: string): PartJson {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch (e) {
    fail(where, `not valid JSON (${e instanceof Error ? e.message : String(e)})`)
  }
  const p = v as PartJson
  if (!p || typeof p !== 'object') fail(where, 'expected an object')
  if (typeof p.type !== 'string' || !p.type) fail(where, 'missing "type"')
  if (typeof p.label !== 'string') fail(where, 'missing "label"')
  if (!p.views || typeof p.views !== 'object') fail(where, 'missing "views"')
  const kinds = VIEW_KINDS.filter((k) => p.views[k])
  if (!kinds.length) fail(where, 'needs a "breadboard" or "schematic" view')
  for (const k of kinds) {
    const view = p.views[k]!
    if (typeof view.svg !== 'string' || !view.svg)
      fail(where, `views.${k}.svg must name an .svg file`)
    if (view.svg.trimStart().startsWith('<'))
      fail(where, `views.${k}.svg holds inline markup — folder parts reference a file`)
  }
  return p
}

/** A legacy single-file PartDef (SVG embedded). */
export function isPartDef(v: unknown): v is PartDef {
  const d = v as PartDef
  return (
    !!d &&
    typeof d === 'object' &&
    typeof d.type === 'string' &&
    typeof d.label === 'string' &&
    !!d.views &&
    typeof d.views === 'object' &&
    VIEW_KINDS.some((k) => typeof d.views[k]?.svg === 'string' && d.views[k]!.svg.includes('<'))
  )
}

// ── building a PartDef ───────────────────────────────────────────────────────

export interface FolderOrigin {
  layer: PartLayer
  pack?: string
  /** the part folder inside its pack, e.g. "parts/tinycore" */
  dir: string
  /** absolute folder on disk (local tinyparts checkout only) */
  absDir?: string
}

/** How many pins part.json promises, without reading any art. */
function declaredPinCount(view: PartJsonView | undefined): number {
  if (!view?.pins) return 0
  return Array.isArray(view.pins) ? view.pins.length : Object.keys(view.pins).length
}

/** Palette metadata straight from part.json (+ the icon's text, if already read). */
export function folderPartMeta(json: PartJson, iconSvg: string | undefined): PartMeta {
  return {
    type: json.type,
    label: json.label,
    family: json.family ?? '',
    simFamily: json.simFamily,
    prefix: json.prefix,
    views: VIEW_KINDS.filter((k) => json.views[k]),
    pins: declaredPinCount(json.views.breadboard ?? json.views.schematic),
    icon: iconSvg === undefined ? undefined : namespaceSvg(prepareArt(iconSvg), iconPrefix(json)),
    builtin: json.builtin,
    variantOf: typeof json.variantOf === 'string' ? json.variantOf : undefined
  }
}

/** Where a pack lists a part: its palette section, and its position in pack.json. */
export function placeInPack(meta: PartMeta, ref: PackPartRef, position: number): PartMeta {
  return { ...meta, section: ref.section, position }
}

/** Every file a part folder needs besides part.json (views + icon), folder-relative. */
export function referencedFiles(json: PartJson): string[] {
  const files = new Set<string>()
  for (const k of VIEW_KINDS) if (json.views[k]?.svg) files.add(joinPath(json.views[k]!.svg))
  if (json.icon) files.add(joinPath(json.icon))
  return [...files]
}

/** The file the palette tile draws: `icon`, else the breadboard (or schematic) art. */
export function iconFileOf(json: PartJson): string | undefined {
  return json.icon ?? json.views.breadboard?.svg ?? json.views.schematic?.svg
}

/**
 * The palette icon's art prefix: its view's own when the icon is that view's
 * file (so both inline the identical string), else a separate "icon" one.
 */
function iconPrefix(json: PartJson): string {
  const file = iconFileOf(json)
  return artPrefix(json.type, VIEW_KINDS.find((k) => json.views[k]?.svg === file) ?? 'icon')
}

function buildView(
  json: PartJson,
  kind: ViewKind,
  raw: string,
  warnings: string[]
): { view: PartView; fromSvg: boolean } {
  const v = json.views[kind]!
  const root = readSvgRoot(raw)
  const w = lengthPx(v.width) ?? root.widthPx ?? root.vb[2]
  const h = lengthPx(v.height) ?? root.heightPx ?? root.vb[3]
  let pins: Record<string, [number, number]> = {}
  let fromSvg = false

  if (v.pins && !Array.isArray(v.pins)) {
    for (const [name, at] of Object.entries(v.pins)) pins[name] = [round2(at[0]), round2(at[1])]
  } else {
    fromSvg = true
    const scan = scanPins(raw, w, h)
    for (const d of scan.duplicates)
      warnings.push(`${kind}: "pin-${d}" appears more than once in ${v.svg} (using the first)`)
    for (const e of scan.empty)
      warnings.push(`${kind}: "pin-${e}" in ${v.svg} has no shape to take a position from`)
    const at = new Map(scan.pins.map((p) => [p.name, p.at]))
    if (Array.isArray(v.pins)) {
      const listed = new Set(v.pins)
      for (const name of v.pins) {
        const p = at.get(name)
        if (p) pins[name] = p
        else
          warnings.push(
            `${kind}: pin "${name}" is listed in part.json but ${v.svg} has no "pin-${name}"`
          )
      }
      const extra = scan.pins.filter((p) => !listed.has(p.name))
      for (const p of extra) pins[p.name] = p.at
      if (extra.length)
        warnings.push(
          `${kind}: ${v.svg} has pins not listed in part.json: ${extra
            .slice(0, 6)
            .map((p) => p.name)
            .join(', ')}${extra.length > 6 ? '…' : ''}`
        )
    } else {
      pins = Object.fromEntries(scan.pins.map((p) => [p.name, p.at]))
    }
    if (!Object.keys(pins).length)
      warnings.push(`${kind}: no pins — name each pad "pin-<NAME>" in ${v.svg}`)
  }

  return {
    view: {
      svg: namespaceSvg(prepareArt(raw), artPrefix(json.type, kind)),
      w: round2(w),
      h: round2(h),
      pins,
      ...(v.legs?.length ? { legs: [...v.legs] } : {})
    },
    fromSvg
  }
}

/** Read a folder part's art and build its PartDef (warnings land in `source`). */
export async function buildFolderPart(
  json: PartJson,
  read: ReadText,
  origin: FolderOrigin
): Promise<PartDef> {
  const warnings: string[] = []
  const views: Partial<Record<ViewKind, PartView>> = {}
  const raw: NonNullable<PartSource['raw']> = {}
  const pinsFromSvg: NonNullable<PartSource['pinsFromSvg']> = {}

  for (const kind of VIEW_KINDS) {
    const v = json.views[kind]
    if (!v) continue
    let text: string
    try {
      text = await read(joinPath(origin.dir, v.svg))
    } catch (e) {
      warnings.push(`${kind}: can't read ${v.svg} (${e instanceof Error ? e.message : String(e)})`)
      continue
    }
    raw[kind] = text
    const built = buildView(json, kind, text, warnings)
    views[kind] = built.view
    pinsFromSvg[kind] = built.fromSvg
  }
  if (!views.breadboard && !views.schematic)
    throw new Error(`${json.type}: no readable view art (${warnings.join('; ')})`)

  let icon: string | undefined
  if (json.icon) {
    const iconFile = json.icon
    const sameAs = VIEW_KINDS.find((k) => json.views[k]?.svg === iconFile)
    try {
      const text = sameAs ? raw[sameAs] : await read(joinPath(origin.dir, iconFile))
      if (text !== undefined) {
        raw.icon = text
        icon = namespaceSvg(prepareArt(text), iconPrefix(json))
      }
    } catch (e) {
      warnings.push(`icon: can't read ${iconFile} (${e instanceof Error ? e.message : String(e)})`)
    }
  }

  return {
    type: json.type,
    label: json.label,
    family: json.family,
    simFamily: json.simFamily,
    prefix: json.prefix,
    sub: json.sub,
    accent: json.accent,
    builtin: json.builtin,
    icon,
    buses: json.buses?.map((b) => [...b]),
    views,
    source: { ...origin, json, raw, pinsFromSvg, warnings }
  }
}

// ── whole packs ──────────────────────────────────────────────────────────────

export interface PackLoad {
  pack: PackJson
  providers: PartProvider[]
  /** problems that stopped a part loading at all (per-part art warnings live on each def) */
  errors: string[]
}

/**
 * Read a pack's manifest and every part.json (plus icons) so the palette can
 * list the pack immediately; each part's full art loads on first use. Legacy
 * single-file parts are read whole (the SVG is inside) and served preloaded.
 */
export async function loadPack(
  packDir: string,
  read: ReadText,
  layer: PartLayer,
  opts: { absRoot?: string; extraDirs?: string[] } = {}
): Promise<PackLoad> {
  const pack = parsePackJson(
    await read(joinPath(packDir, 'pack.json')),
    joinPath(packDir, 'pack.json')
  )
  const refs = [...pack.parts]
  for (const dir of opts.extraDirs ?? []) {
    if (!refs.some((r) => r.dir && joinPath(r.dir) === joinPath(dir)))
      refs.push({ type: dir.split('/').pop() || dir, dir })
  }
  const errors: string[] = []
  const providers: PartProvider[] = []

  await Promise.all(
    refs.map(async (ref) => {
      try {
        if (ref.dir) {
          const dir = joinPath(packDir, ref.dir)
          const where = joinPath(dir, 'part.json')
          const json = parsePartJson(await read(where), where)
          if (json.type !== ref.type)
            errors.push(`${where}: type "${json.type}" doesn't match pack.json's "${ref.type}"`)
          const iconFile = iconFileOf(json)
          let iconText: string | undefined
          try {
            iconText = iconFile ? await read(joinPath(dir, iconFile)) : undefined
          } catch {
            iconText = undefined
          }
          const origin: FolderOrigin = {
            layer,
            pack: pack.id,
            dir,
            absDir: opts.absRoot ? joinPath(opts.absRoot, dir) : undefined
          }
          providers.push({
            meta: placeInPack(folderPartMeta(json, iconText), ref, refs.indexOf(ref)),
            load: () => buildFolderPart(json, read, origin)
          })
        } else if (ref.file) {
          const where = joinPath(packDir, ref.file)
          const json: unknown = JSON.parse(await read(where))
          if (!isPartDef(json)) throw new Error(`${where} is not a valid part definition`)
          const def: PartDef = { ...json, source: { layer, pack: pack.id, file: where } }
          providers.push({
            meta: placeInPack(legacyMeta(def), ref, refs.indexOf(ref)),
            load: async () => def,
            def
          })
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e))
      }
    })
  )
  // keep pack.json order (Promise.all finished them in any order)
  const order = new Map(refs.map((r, i) => [r.type, i]))
  providers.sort((a, b) => (order.get(a.meta.type) ?? 0) - (order.get(b.meta.type) ?? 0))
  return { pack, providers, errors }
}

export function legacyMeta(def: PartDef): PartMeta {
  const first = def.views.breadboard ?? def.views.schematic
  return {
    type: def.type,
    label: def.label,
    family: def.family ?? '',
    simFamily: def.simFamily,
    prefix: def.prefix,
    views: VIEW_KINDS.filter((k) => def.views[k]),
    pins: Object.keys(first?.pins ?? {}).length,
    icon: def.icon || first?.svg,
    builtin: def.builtin,
    bin: def.bin,
    section: def.section,
    variantOf: def.variantOf,
    searchOnly: def.searchOnly
  }
}
