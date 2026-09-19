/**
 * partsLibrary: the live registry of every part the Circuit view can place.
 * Where the art lives and how to edit it: docs/parts-and-art.md.
 *
 * Parts arrive in LAYERS. When two layers offer the same `type`, the higher
 * one wins, so an edit shadows the shipped part without replacing it:
 *
 *   user     saved on this computer: Parts Editor edits, .fzpz imports, and the
 *            procedurally generated breadboards/sim parts (lib/userParts.ts)
 *   dev      a local tinyparts checkout, `npm run dev` only (parts/devFolder.ts)
 *   remote   packs downloaded from the tinyparts repo on GitHub, cached
 *            locally (parts/tinypartsSync.ts)
 *   bundled  the tinyparts snapshot compiled into the app (assets/tinyparts/,
 *            refreshed with `npm run parts:sync`)
 *
 * A layer registers PROVIDERS: palette metadata up front plus a loader for the
 * full definition, so listing a 300-part pack doesn't read 300 SVGs. Every
 * definition and every manifest row goes through the naming pass
 * (circuit/parts/naming) here, in one place.
 *
 * Schema: pin coordinates are pixels @ 96 DPI relative to the part's top-left
 * (the same space Wokwi uses), so a part drops straight into diagram.json. A
 * part can carry a `breadboard` and/or `schematic` view; pin NAMES are stable
 * across views, which is what lets connections survive a view switch.
 */

import { compareCategories, resolveNaming } from '../circuit/parts/naming'
import { invalidateSymbol } from '../circuit/parts/symbols'
import { bundledPacks } from '../circuit/parts/bundled'
import { legacyMeta, type PackJson, type PartJson } from '../circuit/parts/folderPart'

export type ViewKind = 'breadboard' | 'schematic'

export interface PartView {
  svg: string
  w: number
  h: number
  pins: Record<string, [number, number]>
  /** pin names with a bendable rubber-band leg in this view (Fritzing
   * legId, LED/resistor class parts). Breadboard view only in practice. */
  legs?: string[]
}

export type PartLayer = 'bundled' | 'remote' | 'dev' | 'user'

export const LAYER_RANK: Record<PartLayer, number> = { bundled: 0, remote: 1, dev: 2, user: 3 }

/** Where a loaded definition came from: what the Parts Editor needs to save it back. */
export interface PartSource {
  layer: PartLayer
  /** tinyparts pack id */
  pack?: string
  /** folder part: its folder, repo-relative (e.g. "packs/tinyboards/parts/tinycore") */
  dir?: string
  /** legacy single-file part, repo-relative */
  file?: string
  /** the folder on disk (local tinyparts checkout only) */
  absDir?: string
  /** part.json as read, for merging an edit back into it */
  json?: PartJson
  /** the art files exactly as authored (before namespacing), by view + icon */
  raw?: Partial<Record<ViewKind | 'icon', string>>
  /** views whose pins were read from `pin-*` ids rather than fixed in part.json */
  pinsFromSvg?: Partial<Record<ViewKind, boolean>>
  /** non-fatal problems found while loading (missing pins, unreadable icon…) */
  warnings?: string[]
}

export interface PartDef {
  type: string
  /** Display name (human-readable; see circuit/parts/naming). */
  label: string
  /** Display category: the group this part sits in, in the components rail. */
  family?: string
  /**
   * Keyword string used for SPICE emitter + refdes matching, kept separate
   * from the display category so renaming a category can never change how a
   * part simulates. Falls back to `family` when absent.
   */
  simFamily?: string
  /** Explicit refdes prefix (R, C, D, Q…) when the part knows better. */
  prefix?: string
  sub?: string
  accent?: string
  builtin?: boolean
  icon?: string
  /** pin groups wired together inside the part (tinyProto's power rails) */
  buses?: string[][]
  views: Partial<Record<ViewKind, PartView>>
  source?: PartSource
  /** user-layer parts: a local edit of a shipped part, or an imported/new part */
  origin?: 'edit' | 'import'
  /** the pack whose palette tab lists a part that isn't from a pack (generated breadboards…) */
  bin?: string
  /** its palette section within that tab */
  section?: string
  /** the part this one is a package variant of: it gets no palette tile of its own */
  variantOf?: string
  /** found by palette search but not shown in a tab (simulation sources and probes) */
  searchOnly?: boolean
}

export interface PartMeta {
  type: string
  label: string
  /** Display category (see circuit/parts/naming). */
  family: string
  /** Keyword string for sim/refdes matching; never the display category. */
  simFamily?: string
  prefix?: string
  familySlug?: string
  views: ViewKind[]
  pins: number
  icon?: string
  file?: string
  builtin?: boolean
  /** the layer currently supplying this part */
  layer?: PartLayer
  /**
   * The pack whose palette tab lists this part (Fritzing calls these bins).
   * Unset for the user's own imported and new parts, which list under Mine.
   */
  bin?: string
  /** palette section within the tab ("Basic", "Input"…) */
  section?: string
  /** position in its pack's pack.json, which is palette order */
  position?: number
  /** the part this one is a package variant of: search finds it, the tabs don't show it */
  variantOf?: string
  /** found by palette search but not shown in a tab */
  searchOnly?: boolean
}

/** What the palette needs to know about a pack to give it a tab. */
export interface PackInfo {
  id: string
  name: string
  /** index group: "tinyStudio" packs share the Core tab, "SparkFun" packs share one tab */
  group?: string
  /** tab icon: a data: URL, SVG markup or a short text code */
  icon?: string
  sections?: string[]
}

/** A layer's offer of one part: metadata now, the full definition on demand. */
export interface PartProvider {
  meta: PartMeta
  load: () => Promise<PartDef>
  /** already-built definition (single-file parts, user parts) */
  def?: PartDef
}

// ── naming ───────────────────────────────────────────────────────────────────

/**
 * Naming pass (see circuit/parts/naming): every part that enters the registry
 * goes through here, so a part's display name and category are decided in
 * exactly one place. The part file's own label/family survive as the
 * sim-matching keywords in `simFamily`.
 */
export function applyNaming<T extends PartDef>(def: T): T {
  const n = resolveNaming(def.type, def.label, def.simFamily ?? def.family)
  return {
    ...def,
    label: n.label,
    family: n.category,
    simFamily: n.sim,
    prefix: def.prefix ?? n.prefix
  }
}

function applyNamingMeta(meta: PartMeta): PartMeta {
  const n = resolveNaming(meta.type, meta.label, meta.simFamily ?? meta.family)
  return {
    ...meta,
    label: n.label,
    family: n.category,
    simFamily: n.sim,
    prefix: meta.prefix ?? n.prefix
  }
}

// ── layered registry ─────────────────────────────────────────────────────────

interface Slot {
  layer: PartLayer
  group: string
  seq: number
  provider: PartProvider
}

/** type → every provider currently offering it */
const slots = new Map<string, Slot[]>()
/** `${layer}/${group}` → the types that group registered */
const groupTypes = new Map<string, Set<string>>()
/** type → the slot the registry is serving it from */
const active = new Map<string, Slot>()
const cache: Record<string, PartDef> = {}
const inflight = new Map<string, Promise<PartDef | undefined>>()
const listeners = new Set<(types: string[]) => void>()
let seq = 0

/** Palette metadata for every available part (mutated in place as layers change). */
export const PART_MANIFEST: PartMeta[] = []

const packInfo = new Map<string, PackInfo>()

/** Record a pack's name, group, icon and section order as its pack.json gives them. */
export function setPackInfo(pack: PackJson): void {
  packInfo.set(pack.id, {
    id: pack.id,
    name: pack.name || pack.id,
    group: pack.group,
    icon: pack.icon,
    sections: pack.sections
  })
}

export function getPackInfo(id: string): PackInfo | undefined {
  return packInfo.get(id)
}

/**
 * Palette placement for the winning slot. Pack layers place a part in their own
 * pack; a user-layer edit keeps the place of the pack part it shadows.
 */
function placement(w: Slot, type: string): Pick<PartMeta, 'bin' | 'section' | 'position'> {
  const own = w.provider.meta
  if (w.layer !== 'user') return { bin: w.group, section: own.section, position: own.position }
  const shipped = (slots.get(type) ?? [])
    .filter((s) => s.layer !== 'user')
    .sort((a, b) => LAYER_RANK[b.layer] - LAYER_RANK[a.layer] || b.seq - a.seq)[0]
  return {
    bin: own.bin ?? shipped?.group,
    section: own.section ?? shipped?.provider.meta.section,
    position: own.position ?? shipped?.provider.meta.position
  }
}

function winner(type: string): Slot | undefined {
  let best: Slot | undefined
  for (const s of slots.get(type) ?? []) {
    if (
      !best ||
      LAYER_RANK[s.layer] > LAYER_RANK[best.layer] ||
      (s.layer === best.layer && s.seq > best.seq)
    )
      best = s
  }
  return best
}

function refresh(types: Iterable<string>): void {
  const changed: string[] = []
  for (const type of types) {
    const w = winner(type)
    const prev = active.get(type)
    if (w === prev) continue
    delete cache[type]
    inflight.delete(type)
    if (prev) invalidateSymbol(type) // a new source may carry new art
    const at = PART_MANIFEST.findIndex((m) => m.type === type)
    if (!w) {
      active.delete(type)
      if (at >= 0) PART_MANIFEST.splice(at, 1)
    } else {
      active.set(type, w)
      if (w.provider.def) cache[type] = applyNaming(w.provider.def)
      const meta = applyNamingMeta({
        ...w.provider.meta,
        ...placement(w, type),
        layer: w.layer
      })
      if (at >= 0) PART_MANIFEST[at] = meta
      else PART_MANIFEST.push(meta)
    }
    changed.push(type)
  }
  if (changed.length) for (const cb of listeners) cb(changed)
}

/**
 * Replace everything one layer group offers (a pack, a single user part…).
 * Types the group no longer lists fall back to the next layer down.
 */
export function setLayerParts(layer: PartLayer, group: string, providers: PartProvider[]): void {
  const key = `${layer}/${group}`
  const touched = new Set(groupTypes.get(key))
  for (const type of touched) {
    const rest = (slots.get(type) ?? []).filter((s) => !(s.layer === layer && s.group === group))
    if (rest.length) slots.set(type, rest)
    else slots.delete(type)
  }
  const now = new Set<string>()
  for (const provider of providers) {
    const type = provider.meta.type
    now.add(type)
    touched.add(type)
    const list = slots.get(type) ?? []
    list.push({ layer, group, seq: ++seq, provider })
    slots.set(type, list)
  }
  if (now.size) groupTypes.set(key, now)
  else groupTypes.delete(key)
  refresh(touched)
}

/** Every layer offering `type`, highest first (drives "edited locally · reset"). */
export function partLayers(type: string): { layer: PartLayer; group: string }[] {
  return [...(slots.get(type) ?? [])]
    .sort((a, b) => LAYER_RANK[b.layer] - LAYER_RANK[a.layer] || b.seq - a.seq)
    .map((s) => ({ layer: s.layer, group: s.group }))
}

/** The groups currently registered in a layer (e.g. which packs are live). */
export function layerGroups(layer: PartLayer): string[] {
  return [...groupTypes.keys()]
    .filter((k) => k.startsWith(`${layer}/`))
    .map((k) => k.slice(layer.length + 1))
}

/** Called with the affected types whenever the winning source of any part changes. */
export function onPartsChanged(cb: (types: string[]) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/**
 * Manifest grouped by display category for the components rail, in the
 * curated category order (circuit/parts/naming CATEGORY_ORDER), parts sorted
 * by name inside each group.
 */
export function partsByFamily(): { family: string; parts: PartMeta[] }[] {
  const groups = new Map<string, PartMeta[]>()
  for (const p of PART_MANIFEST) {
    if (!groups.has(p.family)) groups.set(p.family, [])
    groups.get(p.family)!.push(p)
  }
  return Array.from(groups, ([family, parts]) => ({
    family,
    parts: [...parts].sort((a, b) => a.label.localeCompare(b.label))
  })).sort((a, b) => compareCategories(a.family, b.family))
}

/** Synchronous lookup: only returns parts already loaded. */
export function getPart(type: string): PartDef | undefined {
  return cache[type]
}

/** Load a part definition from whichever layer currently supplies it. */
export async function loadPart(type: string): Promise<PartDef | undefined> {
  if (cache[type]) return cache[type]
  const slot = active.get(type)
  if (!slot) return undefined
  const pending = inflight.get(type)
  if (pending) return pending
  const job = slot.provider.load().then((raw) => {
    // a layer changed while the art was loading: serve the new winner instead
    if (active.get(type) !== slot) return loadPart(type)
    const def = applyNaming(raw)
    cache[type] = def
    if (def.source?.warnings?.length)
      console.warn(`[parts] ${type} (${slot.layer}):\n  ${def.source.warnings.join('\n  ')}`)
    const meta = PART_MANIFEST.find((m) => m.type === type)
    if (meta && !meta.icon) meta.icon = def.icon || viewFor(def, 'breadboard')?.svg
    return def
  })
  inflight.set(type, job)
  try {
    return await job
  } finally {
    if (inflight.get(type) === job) inflight.delete(type)
  }
}

/** Ensure every given type is loaded; resolves once the cache is populated. */
export async function ensureParts(types: Iterable<string>): Promise<void> {
  await Promise.all(Array.from(new Set(types)).map((t) => loadPart(t).catch(() => undefined)))
}

/**
 * Register a fully-built part (Parts Editor save, .fzpz import, generated
 * breadboards). Defaults to the user layer, above every pack.
 */
export function registerPart(raw: PartDef, layer: PartLayer = 'user'): void {
  const def: PartDef = { ...raw, source: raw.source ?? { layer } }
  setLayerParts(layer, `type:${def.type}`, [{ meta: legacyMeta(def), load: async () => def, def }])
}

/** Withdraw a part registered with registerPart; the next layer down takes over. */
export function unregisterPart(type: string, layer: PartLayer = 'user'): void {
  setLayerParts(layer, `type:${type}`, [])
}

/** Pick the best available view for a part, preferring the requested one. */
export function viewFor(def: PartDef, view: ViewKind): PartView | undefined {
  return def.views[view] || def.views.breadboard || def.views.schematic
}

// ── the bundled snapshot is always there ─────────────────────────────────────

for (const pack of bundledPacks()) {
  for (const e of pack.errors) console.error(`[parts] bundled ${pack.id}: ${e}`)
  if (pack.json) setPackInfo(pack.json)
  setLayerParts('bundled', pack.id, pack.providers)
}
