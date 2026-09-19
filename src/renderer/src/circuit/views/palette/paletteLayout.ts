/**
 * circuit/views/palette/paletteLayout: which tab and section each part sits in,
 * laid out the way Fritzing's parts bins are.
 *
 *   Core      the bundled tinyBoards and Core packs, and the parts generated in
 *             code (breadboards, sources, probes), in Fritzing's Core bin order
 *   Mine      the user's own imported and new parts
 *   <pack>    one tab per installed pack; every SparkFun pack shares one tab
 *
 * A pack's pack.json decides its layout: `sections` gives the section order and
 * the `parts` list gives the order within each section. Package variants
 * (`variantOf`) and search-only parts (simulation sources and probes) get no
 * tile; search still finds them.
 *
 * Pure (no React, no registry): the palette passes in the manifest and a pack
 * lookup.
 */

import type { PackInfo, PartMeta } from '../../../lib/partsLibrary'

export const SEARCH_TAB = 'search'
export const CORE_TAB = 'core'
export const MINE_TAB = 'mine'
const SPARKFUN_TAB = 'sparkfun'

export interface PaletteSection {
  /** undefined for a tab with a single, untitled section */
  title?: string
  parts: PartMeta[]
}

export interface PaletteTab {
  id: string
  title: string
  /** a data: URL, SVG markup or a short text code, from the pack */
  icon?: string
  sections: PaletteSection[]
}

/** Tabs after Core and Mine: Arduino and SparkFun first, as in Fritzing, then the tinyparts index order. */
const TAB_ORDER = [
  'arduino',
  SPARKFUN_TAB,
  'seeed',
  'intel',
  'lilypad',
  'picaxe',
  'wemos',
  'analog-devices',
  'atlas-scientific',
  'infineon',
  'spresense',
  'dagu',
  'frc',
  'raspberry-pi',
  'chipkit',
  'calliope',
  'esp',
  'adafruit',
  'voltage-regulators',
  'simulator'
]

/** Pack order inside a shared tab (the tinyparts index order). */
const PACK_ORDER = [
  'tinyboards',
  'core',
  'sparkfun-analogic',
  'sparkfun-boards',
  'sparkfun-connectors',
  'sparkfun-digitalic',
  'sparkfun-discretesemi',
  'sparkfun-displays',
  'sparkfun-electromechanical',
  'sparkfun-freqctrl',
  'sparkfun-led',
  'sparkfun-passives',
  'sparkfun-poweric',
  'sparkfun-rf',
  'sparkfun-sensors',
  'sparkfun-etc'
]

type PackLookup = (id: string) => PackInfo | undefined

/** The tab a part's pack (its `bin`) belongs in. */
export function tabIdFor(bin: string | undefined, info: PackInfo | undefined): string {
  if (!bin) return MINE_TAB
  if (bin === 'core' || bin === 'tinyboards' || info?.group === 'tinyStudio') return CORE_TAB
  if (info?.group === 'SparkFun') return SPARKFUN_TAB
  return bin
}

/** "SparkFun · Sensors" → "Sensors": a pack's name as a section inside a shared tab. */
function shortPackName(info: PackInfo | undefined, bin: string): string {
  const name = info?.name ?? bin
  const dot = name.indexOf('·')
  return dot >= 0 ? name.slice(dot + 1).trim() : name
}

function rank(list: string[], id: string): number {
  const i = list.indexOf(id)
  return i < 0 ? list.length : i
}

const byPackOrder = (a: string, b: string): number =>
  rank(PACK_ORDER, a) - rank(PACK_ORDER, b) || a.localeCompare(b)

function tabMeta(id: string, bins: string[], packInfo: PackLookup): Omit<PaletteTab, 'sections'> {
  if (id === CORE_TAB) return { id, title: 'Core' }
  if (id === MINE_TAB) return { id, title: 'Mine' }
  if (id === SPARKFUN_TAB) {
    const icon = bins.map((b) => packInfo(b)?.icon).find((i) => i?.startsWith('data:'))
    return { id, title: 'SparkFun', icon }
  }
  const info = packInfo(id)
  return { id, title: info?.name ?? id, icon: info?.icon }
}

function sectionsFor(
  parts: PartMeta[],
  bins: string[],
  packInfo: PackLookup,
  shared: boolean
): PaletteSection[] {
  const titleOf = (p: PartMeta): string | undefined =>
    p.section ?? (shared ? shortPackName(packInfo(p.bin!), p.bin!) : undefined)

  // declared order first (pack by pack), then any other section as it turns up
  const order: (string | undefined)[] = []
  const add = (t: string | undefined): void => {
    if (!order.includes(t)) order.push(t)
  }
  for (const bin of bins) for (const s of packInfo(bin)?.sections ?? []) add(s)
  const sorted = [...parts].sort(
    (a, b) =>
      byPackOrder(a.bin!, b.bin!) ||
      (a.position ?? Infinity) - (b.position ?? Infinity) ||
      a.label.localeCompare(b.label)
  )
  for (const p of sorted) add(titleOf(p))

  return order
    .map((title) => ({ title, parts: sorted.filter((p) => titleOf(p) === title) }))
    .filter((s) => s.parts.length > 0)
}

/**
 * The palette's tabs: Core and Mine always, then one per installed pack in
 * Fritzing's order. Search is not a tab here; see searchParts.
 */
export function paletteTabs(manifest: PartMeta[], packInfo: PackLookup): PaletteTab[] {
  const types = new Set(manifest.map((p) => p.type))
  const shown = manifest.filter((p) => !p.searchOnly && !(p.variantOf && types.has(p.variantOf)))

  const byTab = new Map<string, PartMeta[]>([
    [CORE_TAB, []],
    [MINE_TAB, []]
  ])
  for (const p of shown) {
    const id = tabIdFor(p.bin, p.bin ? packInfo(p.bin) : undefined)
    if (!byTab.has(id)) byTab.set(id, [])
    byTab.get(id)!.push(p)
  }

  const tabs: PaletteTab[] = []
  for (const [id, parts] of byTab) {
    if (id === MINE_TAB) {
      const sorted = [...parts].sort((a, b) => a.label.localeCompare(b.label))
      tabs.push({
        ...tabMeta(id, [], packInfo),
        sections: sorted.length ? [{ parts: sorted }] : []
      })
      continue
    }
    const bins = [...new Set(parts.map((p) => p.bin!))].sort(byPackOrder)
    const shared = id === CORE_TAB || bins.length > 1
    tabs.push({
      ...tabMeta(id, bins, packInfo),
      sections: sectionsFor(parts, bins, packInfo, shared)
    })
  }

  const fixed = [CORE_TAB, MINE_TAB]
  return tabs.sort((a, b) => {
    const fa = fixed.indexOf(a.id)
    const fb = fixed.indexOf(b.id)
    if (fa >= 0 || fb >= 0) return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb)
    return rank(TAB_ORDER, a.id) - rank(TAB_ORDER, b.id) || a.title.localeCompare(b.title)
  })
}

/**
 * Every part whose name, type, category, section or pack matches all the words
 * in `query`, package variants included. Names starting with the query come first.
 */
export function searchParts(
  manifest: PartMeta[],
  query: string,
  packInfo: PackLookup,
  limit = 200
): PartMeta[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const hits = manifest.filter((p) => {
    const pack = p.bin ? (packInfo(p.bin)?.name ?? p.bin) : 'mine'
    const text = `${p.label} ${p.type} ${p.family} ${p.section ?? ''} ${pack}`.toLowerCase()
    return words.every((w) => text.includes(w))
  })
  const starts = (p: PartMeta): number => (p.label.toLowerCase().startsWith(words[0]) ? 0 : 1)
  return hits
    .sort((a, b) => starts(a) - starts(b) || a.label.localeCompare(b.label))
    .slice(0, limit)
}
