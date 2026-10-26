/**
 * partsLibrary — the source of truth for circuit parts.
 *
 * Parts come from two places:
 *  1. Built-in tinyStudio boards (the tiny* family) authored inline below.
 *  2. The Fritzing-imported library under assets/parts/ — 642 files, 554
 *     tiles, the ten Fritzing Core sections flattened into one bin. It's
 *     bundled rather than downloaded: nobody should need a network round-trip
 *     to place a resistor. Each part is its own JSON file, lazy-loaded on
 *     demand, so shipping the catalogue costs a manifest at startup and not
 *     several hundred inline SVGs.
 *
 * Everything else — SparkFun's sub-bins, the per-vendor packs — is still an
 * optional download (circuit/parts/packs.ts), and each installed pack gets its
 * own bin.
 *
 * Both share one schema. Pin coordinates are pixels @ 96 DPI relative to the
 * part's top-left — the same space Wokwi uses — so a part drops straight into
 * diagram.json. A part can carry a `breadboard` and/or `schematic` view; pin
 * NAMES are stable across views, which is what lets connections survive a view
 * switch and stay valid Wokwi data.
 */

import manifestJson from '../assets/parts/index.json'

export type ViewKind = 'breadboard' | 'schematic'

/**
 * Which bin a part shows up in — one tab in the components rail, the way
 * Fritzing's parts bins work:
 *  - 'tiny'         — the tinyStudio boards themselves (tinyCore, tinyGlow, …).
 *                     Their own tab: they're the reason the app exists, and
 *                     five of them shouldn't be five squares lost among the
 *                     five hundred generic ones.
 *  - 'core'         — the bundled Fritzing catalogue, shipped with the app
 *  - 'mine'         — authored in the Parts Editor or dropped in as a .fzpz
 *  - 'pack:<id>'    — installed from a parts pack; every pack gets its own bin
 *                     (see circuit/parts/packs.ts)
 */
export type PartSource = 'tiny' | 'core' | 'mine' | `pack:${string}`

/** The bin id for a pack. Keep this the single place the prefix is spelled. */
export const packBinId = (packId: string): PartSource => `pack:${packId}`

/** Inverse of packBinId — undefined for the 'core' / 'mine' bins. */
export function packIdOfBin(bin: string): string | undefined {
  return bin.startsWith('pack:') ? bin.slice(5) : undefined
}

export interface PartView {
  svg: string
  w: number
  h: number
  pins: Record<string, [number, number]>
  /** pin names with a bendable rubber-band leg in this view (Fritzing
   * legId — LED/resistor class parts). Breadboard view only in practice. */
  legs?: string[]
}

export interface PartDef {
  type: string
  label: string
  family?: string
  sub?: string
  accent?: string
  builtin?: boolean
  /** id of the parts pack this came from — set by packs.installPack, and
   * persisted with the def so the bin survives a reload. */
  pack?: string
  /** free-text search terms beyond label/family/type (Fritzing tags). */
  tags?: string[]
  /** Fritzing <properties> minus family — package, spacing, resistance, … */
  properties?: Record<string, string>
  /** other package options that render identically to this one (see
   * scripts/split-parts-packs.mjs). The palette shows only this tile. */
  variants?: { type: string; package: string }[]
  /** set on the *hidden* side of the above: the type whose tile stands in for
   * this one. Still placeable and still resolves in saved documents. */
  variantOf?: string
  /** position in its pack's flat grid (Fritzing's curated bin order first) */
  order?: number
  icon?: string
  views: Partial<Record<ViewKind, PartView>>
}

export interface PartMeta {
  type: string
  label: string
  family: string
  familySlug?: string
  views: ViewKind[]
  pins: number
  icon?: string
  file?: string
  builtin?: boolean
  pack?: string
  tags?: string[]
  properties?: Record<string, string>
  variants?: { type: string; package: string }[]
  variantOf?: string
  order?: number
  source: PartSource
}

// ── built-in tinyStudio boards ───────────────────────────────────────────────

function boardSvg(
  label: string,
  sub: string | undefined,
  w: number,
  h: number,
  accent: string
): string {
  const cy = sub ? h / 2 - 6 : h / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#172246"/><stop offset="1" stop-color="#0b1330"/>
    </linearGradient></defs>
    <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="12" fill="url(#g)" stroke="${accent}" stroke-width="1.5"/>
    <text x="${w / 2}" y="${cy}" fill="#e9edff" font-family="sans-serif" font-size="15" font-weight="600" text-anchor="middle" dominant-baseline="middle">${label}</text>
    ${sub ? `<text x="${w / 2}" y="${h / 2 + 14}" fill="#7b86b8" font-family="sans-serif" font-size="11" text-anchor="middle" dominant-baseline="middle">${sub}</text>` : ''}
  </svg>`
}

function board(
  type: string,
  label: string,
  w: number,
  h: number,
  pins: Record<string, [number, number]>,
  opts: { sub?: string; accent?: string } = {}
): PartDef {
  const accent = opts.accent || '#3a4a78'
  return {
    type,
    label,
    family: 'tinyStudio',
    sub: opts.sub,
    accent,
    builtin: true,
    views: { breadboard: { svg: boardSvg(label, opts.sub, w, h, accent), w, h, pins } }
  }
}

const BUILTIN_PARTS: PartDef[] = [
  board(
    'tinycore',
    'tinyCore',
    150,
    150,
    {
      '3V3': [8, 70],
      GND: [8, 96],
      SIG: [142, 58],
      D3: [142, 78],
      D4: [142, 98],
      D5: [142, 118],
      D9: [74, 142]
    },
    { sub: 'ESP32-S3', accent: 'var(--cyan)' }
  ),
  board(
    'tinyglow',
    'tinyGlow',
    104,
    104,
    { VCC: [6, 40], GND: [6, 64], DIN: [98, 52] },
    { accent: 'var(--pink)' }
  ),
  board('tinyproto', 'tinyProto', 120, 100, {
    '+': [6, 30],
    '-': [6, 54],
    A: [114, 30],
    B: [114, 54]
  }),
  board('tinydisplay', 'tinyDisplay', 120, 100, {
    VCC: [6, 24],
    GND: [6, 48],
    SDA: [114, 24],
    SCL: [114, 48]
  }),
  board('tinysniff', 'tinySniff', 110, 100, {
    VCC: [6, 24],
    GND: [6, 48],
    SDA: [104, 24],
    SCL: [104, 48]
  })
]

// ── registry + lazy loading ──────────────────────────────────────────────────

// Lazy per-part loading. Each part is a flat file under assets/parts/ (Vite's
// dynamic-import variables only support a single path segment, so the family
// grouping lives in the manifest, not in directories). The ".json" extension
// stays in the static part of the template so Vite can analyze the glob.
const rawManifest: PartMeta[] = (
  (manifestJson as { parts?: Omit<PartMeta, 'source'>[] }).parts || []
).map((m) => ({ ...m, source: 'core' as const }))
const loaderByType: Record<string, () => Promise<{ default: PartDef }>> = {}
for (const m of rawManifest) {
  if (!m.file) continue
  const rel = m.file.replace(/\.json$/, '')
  loaderByType[m.type] = () => import(`../assets/parts/${rel}.json`)
}

const cache: Record<string, PartDef> = {}
for (const d of BUILTIN_PARTS) cache[d.type] = d

const builtinMeta: PartMeta[] = BUILTIN_PARTS.map((d) => ({
  type: d.type,
  label: d.label,
  family: d.family || 'tinyStudio',
  views: Object.keys(d.views) as ViewKind[],
  pins: Object.keys(Object.values(d.views)[0]?.pins || {}).length,
  icon: d.icon || Object.values(d.views)[0]?.svg,
  builtin: true,
  source: 'tiny'
}))

/** Palette metadata: the tiny* boards first, then the Fritzing catalogue. */
export const PART_MANIFEST: PartMeta[] = [...builtinMeta, ...rawManifest]

/** Which bin a definition belongs to. The tiny* boards get their own tab;
 * anything carrying a pack id gets that pack's bin; the rest is user-authored.
 * The bundled Fritzing catalogue never comes through here — it's stamped
 * 'core' straight off the manifest. */
export function sourceOf(def: Pick<PartDef, 'builtin' | 'pack'>): PartSource {
  if (def.builtin) return 'tiny'
  return def.pack ? packBinId(def.pack) : 'mine'
}

/**
 * Is this part hidden behind another tile? Package variants (a 0603 SMD
 * resistor next to the through-hole one) render identically in tinyStudio, so
 * only the primary gets a tile. They stay placeable and stay resolvable in
 * saved documents — they're just not their own entry in the palette.
 */
export const isVariant = (m: Pick<PartMeta, 'variantOf'>): boolean => !!m.variantOf

/**
 * One bin's parts as a single flat, ordered list — the components rail renders
 * a bin as one grid rather than a stack of family accordions.
 *
 * Order is Fritzing's: the curated bin sequence first (baked into `order` by
 * scripts/split-parts-packs.mjs), then family, then label — so related parts
 * still sit next to each other without needing headers. Rendering one bin at a
 * time is also what keeps a multi-thousand-part library from mounting at once.
 */
export function partsInBin(
  source: PartSource,
  opts: { includeVariants?: boolean } = {}
): PartMeta[] {
  const out = PART_MANIFEST.filter(
    (p) => p.source === source && (opts.includeVariants || !isVariant(p))
  )
  return out.sort(comparePartsForDisplay)
}

/** Shared display order: explicit `order` wins, then family, then label. */
export function comparePartsForDisplay(a: PartMeta, b: PartMeta): number {
  const ao = a.order ?? Number.MAX_SAFE_INTEGER
  const bo = b.order ?? Number.MAX_SAFE_INTEGER
  return (
    ao - bo ||
    a.family.localeCompare(b.family) ||
    a.label.localeCompare(b.label) ||
    a.type.localeCompare(b.type)
  )
}

/** How many tiles each bin shows — drives the tab counts. Hidden package
 * variants aren't counted; the number should match what you can see. */
export function partCountsBySource(): Record<string, number> {
  const counts: Record<string, number> = { tiny: 0, core: 0, mine: 0 }
  for (const p of PART_MANIFEST) {
    if (isVariant(p)) continue
    counts[p.source] = (counts[p.source] ?? 0) + 1
  }
  return counts
}

/**
 * Every pack that currently has parts in the registry, in first-seen order.
 * The palette turns these into tabs; a pack with zero parts left (all deleted)
 * simply stops having a tab.
 */
export function installedPackBins(): { bin: PartSource; packId: string; count: number }[] {
  const seen = new Map<string, number>()
  for (const p of PART_MANIFEST) {
    const id = packIdOfBin(p.source)
    if (!id) continue
    seen.set(id, (seen.get(id) ?? 0) + (isVariant(p) ? 0 : 1))
  }
  return Array.from(seen, ([packId, count]) => ({ bin: packBinId(packId), packId, count }))
}

/** The presentation a part should have after migrating to the split packs. */
export interface PackRestamp {
  type: string
  label?: string
  order?: number
  variantOf?: string
  variants?: { type: string; package: string }[]
}

/**
 * Re-file already-registered parts into a different bin. Used by the pack
 * migration: parts installed from the old monolithic `tinystudio-core` pack
 * are re-stamped with the pack id — and the label / order / variant grouping —
 * they'd get today, so they land under the right tab looking right, without a
 * re-download. Returns the parts actually changed (callers persist those).
 */
export function restampPack(entries: Iterable<PackRestamp>, packId: string): PartDef[] {
  const moved: PartDef[] = []
  for (const entry of entries) {
    const def = cache[entry.type]
    const meta = PART_MANIFEST.find((m) => m.type === entry.type)
    if (!def || !meta || def.builtin) continue
    if (def.pack === packId && def.order === entry.order && def.label === entry.label) continue

    def.pack = packId
    meta.pack = packId
    meta.source = packBinId(packId)
    if (entry.label) def.label = meta.label = entry.label
    if (entry.order != null) def.order = meta.order = entry.order
    // variantOf/variants are absent for most parts; assign either way so a
    // re-run after a reclassification can also *un*-hide a tile
    def.variantOf = meta.variantOf = entry.variantOf
    def.variants = meta.variants = entry.variants
    moved.push(def)
  }
  return moved
}

/**
 * Fuzzy-ish part search over label / family / type / tags. Terms are ANDed so
 * "red led" narrows rather than widens; results are ranked label-prefix first,
 * then label substring, then everything else, and capped by `limit` so a
 * one-character query can't try to paint the whole catalogue.
 *
 * Package variants ARE searchable, and rank last. The bin grids fold every
 * footprint of a part behind one tile — which is the point, sixteen identical
 * "Inductors" squares help nobody — but that only works if the folded ones stay
 * reachable. Someone who needs the 0805 specifically types "0805" and gets it;
 * they're just not in the way of everyone else. Variants carry their package in
 * their label ("Capacitor (0805)"), so a result row still says which is which.
 */
export function searchParts(query: string, limit = 200): PartMeta[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const scored: { m: PartMeta; score: number }[] = []
  for (const m of PART_MANIFEST) {
    const label = m.label.toLowerCase()
    const hay = `${label} ${m.family.toLowerCase()} ${m.type.toLowerCase()} ${(m.tags || []).join(' ').toLowerCase()}`
    if (!terms.every((t) => hay.includes(t))) continue
    const base = label.startsWith(terms[0]) ? 0 : label.includes(terms[0]) ? 1 : 2
    scored.push({ m, score: isVariant(m) ? base + 3 : base })
  }
  scored.sort((a, b) => a.score - b.score || a.m.label.localeCompare(b.m.label))
  return scored.slice(0, limit).map((s) => s.m)
}

/** Synchronous lookup — only returns parts already loaded (built-ins + cached). */
export function getPart(type: string): PartDef | undefined {
  return cache[type]
}

/** Load a part definition (from cache if present, else its JSON file). */
export async function loadPart(type: string): Promise<PartDef | undefined> {
  if (cache[type]) return cache[type]
  const loader = loaderByType[type]
  if (!loader) return undefined
  const mod = await loader()
  cache[type] = mod.default
  return mod.default
}

/** Ensure every given type is loaded; resolves once the cache is populated. */
export async function ensureParts(types: Iterable<string>): Promise<void> {
  await Promise.all(Array.from(new Set(types)).map((t) => loadPart(t).catch(() => undefined)))
}

/** Register a user-authored part (from the Parts Editor) into the live registry. */
export function registerPart(def: PartDef): void {
  cache[def.type] = def
  const existing = PART_MANIFEST.findIndex((m) => m.type === def.type)
  const meta: PartMeta = {
    type: def.type,
    label: def.label,
    family: def.family || 'Custom',
    views: Object.keys(def.views) as ViewKind[],
    pins: Object.keys(Object.values(def.views)[0]?.pins || {}).length,
    icon: def.icon || Object.values(def.views)[0]?.svg,
    builtin: def.builtin,
    pack: def.pack,
    tags: def.tags,
    properties: def.properties,
    variants: def.variants,
    variantOf: def.variantOf,
    order: def.order,
    source: sourceOf(def)
  }
  if (existing >= 0) PART_MANIFEST[existing] = meta
  else PART_MANIFEST.push(meta)
}

/**
 * Put bundled parts back the way the app shipped them.
 *
 * A part installed from a pack overwrites the bundled row for the same type
 * (registerPart keys on type), which is right while the pack is the only
 * source. Once the app started bundling the Core catalogue that stopped being
 * true: an install that had downloaded `core-basic` would keep showing the
 * downloaded copy, in a pack tab, with its pre-fold labels. `unregisterParts`
 * is not the answer — it would take the type out of the manifest entirely.
 *
 * So this restores the row from the shipped manifest and drops the cached def
 * so the next `loadPart` reads the bundled file. Returns the types restored.
 */
export function restoreBundledParts(types: Iterable<string>): string[] {
  const restored: string[] = []
  for (const type of types) {
    const shipped = rawManifest.find((m) => m.type === type)
    if (!shipped) continue
    const i = PART_MANIFEST.findIndex((m) => m.type === type)
    if (i >= 0) PART_MANIFEST[i] = shipped
    else PART_MANIFEST.push(shipped)
    delete cache[type]
    restored.push(type)
  }
  return restored
}

/** Drop parts from the live registry (pack uninstall). The document may still
 * reference a removed type — that's the caller's problem, same as deleting a
 * user part; unresolved types render as a placeholder. */
export function unregisterParts(types: Iterable<string>): void {
  for (const type of types) {
    delete cache[type]
    const i = PART_MANIFEST.findIndex((m) => m.type === type)
    if (i >= 0) PART_MANIFEST.splice(i, 1)
  }
}

/** Pick the best available view for a part, preferring the requested one. */
export function viewFor(def: PartDef, view: ViewKind): PartView | undefined {
  return def.views[view] || def.views.breadboard || def.views.schematic
}
