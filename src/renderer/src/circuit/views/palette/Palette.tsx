/**
 * circuit/views/palette/Palette — the Fritzing-style components rail.
 *
 * Reads the LEGACY partsLibrary manifest (replaced by the pack registry in
 * M2); drag a tile onto the canvas or double-click to drop it at centre.
 *
 * Layout mirrors Fritzing's parts window: a narrow vertical strip of bin tabs
 * down the left edge, then a search field and one flat grid of tiles. Bins are
 * tinyStudio, Core, Mine, Search, and one per installed parts pack — installing
 * `sparkfun-sensors` gives you a SparkFun Sensors tab, not another 900 tiles
 * in a shared bin.
 *
 * There are no family accordions. A bin is already narrow enough to scan, and
 * the tiles arrive pre-ordered (Fritzing's curated bin sequence first, then
 * family, then label — see partsInBin), so related parts sit together without
 * the chrome. Package variants that render identically — a 0603 SMD resistor
 * beside the through-hole one — are folded behind a single tile upstream, so
 * this grid is one tile per visually distinct part.
 *
 * Tiles are artwork only: no caption, no card, no border. A parts bin is a
 * pegboard, and a 10px label truncated to "Electrolytic Cap…" was costing more
 * room than it bought recognition — the part's own artwork is what people scan
 * for. The name is a hover tooltip, and search is the way you go looking for
 * something specific, which is also why search reaches the folded package
 * variants that the grid hides (see searchParts).
 *
 * Rendering budget still matters: a full Fritzing catalogue is thousands of
 * parts, each carrying an inline SVG icon string. Two things keep it cheap:
 *
 *  1. BINS — only the active bin renders; the rest never mount.
 *  2. LAZY THUMBS — each tile reserves its box but only injects the SVG once
 *     it scrolls into view (IntersectionObserver), so scrolling a 160-part
 *     bin paints a screenful at a time.
 *
 * The wire-colour picker used to live here; it moved to the Inspector rail
 * (see inspector/Inspector.tsx) and the search field took its place.
 */

import { Cpu, LibraryBig, Package, Pencil, Plus, Search, X } from 'lucide-react'
import React from 'react'
import {
  getPart,
  installedPackBins,
  packIdOfBin,
  partCountsBySource,
  partsInBin,
  searchParts,
  type PartMeta,
  type PartSource
} from '../../../lib/partsLibrary'
import type { ViewId } from '../../core/model'
import { PackGlyph } from '../../parts/PackGlyph'
import { getInstalledPacks } from '../../parts/packs'
import { NET_LABEL_KINDS, netLabelView } from '../../parts/netLabels'
import { schematicVisual } from '../../parts/symbols'

type BinId = PartSource | 'search'

interface Bin {
  id: BinId
  label: string
  /** short glyph for the vertical rail: lucide icon, or a monogram string */
  icon: React.ReactNode | string
  title: string
  count?: number
}

// Icon lookup is not free in the schematic view (it rebuilds the symbol SVG),
// and the palette re-renders on every selection change. Memoise per type+view,
// and drop the whole cache whenever the part registry changes (defsTick) — a
// part that wasn't loaded yet resolves to a different symbol once it is.
const iconCache = new Map<string, string | undefined>()
let iconCacheTick = -1

function iconFor(meta: PartMeta, view: ViewId, tick: number): string | undefined {
  if (tick !== iconCacheTick) {
    iconCache.clear()
    iconCacheTick = tick
  }
  const key = `${view}:${meta.type}`
  if (iconCache.has(key)) return iconCache.get(key)
  let svg = meta.icon
  if (view === 'sch') {
    const def = getPart(meta.type)
    if (def) svg = schematicVisual(def).svg
  }
  iconCache.set(key, svg)
  return svg
}

/** Fallback tab glyph for a pack that ships no icon: initials of its words,
 * so "SparkFun · Sensors" → "SS" and "arduino" → "AR". */
function monogram(name: string): string {
  const words = name
    .replace(/[·_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0] ?? '??').slice(0, 2).toUpperCase()
}

/**
 * Part artwork on nothing. The thumb used to sit on a `--warm-150` rounded
 * square, which read as a white outline around every icon and made a bin look
 * like a grid of chips rather than a tray of components. The artwork carries
 * its own silhouette, so the box only got in its way.
 */
function Thumb({ svg, size = 40 }: { svg?: string; size?: number }): React.JSX.Element {
  if (!svg)
    return (
      <div className="shrink-0 grid place-items-center" style={{ width: size, height: size }}>
        <Package size={18} className="text-text-faint" />
      </div>
    )
  return (
    <div
      className="shrink-0 grid place-items-center [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/**
 * A Thumb that holds its space but doesn't parse/inject its SVG until it
 * scrolls into view. Once shown it stays shown — re-hiding would thrash the
 * DOM on every scroll reversal for no memory win that matters at bin scale.
 */
function LazyThumb({ svg, size = 44 }: { svg?: string; size?: number }): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null)
  const [shown, setShown] = React.useState(false)

  React.useEffect(() => {
    if (shown) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shown])

  if (shown) return <Thumb svg={svg} size={size} />
  return <div ref={ref} className="shrink-0" style={{ width: size, height: size }} />
}

/** What the tooltip says about a part. Kept out of the tile so the tile stays
 * cheap to render — a bin can be several hundred of these. */
function tipFor(meta: PartMeta): { title: string; lines: string[] } {
  return {
    title: meta.label,
    lines: [
      `${meta.family} · ${meta.pins} pin${meta.pins === 1 ? '' : 's'}`,
      meta.variants?.length ? `also as ${meta.variants.map((v) => v.package).join(', ')}` : '',
      'drag onto the canvas, or double-click'
    ].filter(Boolean)
  }
}

const PartTile = React.memo(function PartTile({
  meta,
  view,
  defsTick,
  showCaption,
  onAdd,
  onEditPart,
  onHover
}: {
  meta: PartMeta
  view: ViewId
  defsTick: number
  /** search results keep their names — that's how you tell "Capacitor (0805)"
   * from "Capacitor (1210)" in a list you asked for by typing */
  showCaption?: boolean
  onAdd: (type: string) => void
  onEditPart: (type: string) => void
  onHover: (meta: PartMeta | null, el: HTMLElement | null) => void
}): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null)
  return (
    <div
      ref={ref}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/tinystudio-part', meta.type)
        onHover(null, null)
      }}
      onDoubleClick={() => onAdd(meta.type)}
      onPointerEnter={() => onHover(meta, ref.current)}
      onPointerLeave={() => onHover(null, null)}
      // no card, no border: the tooltip carries the name and the artwork
      // carries the recognition. Hover is a wash, not a lifted chip.
      className="group relative flex flex-col items-center gap-0.5 p-1 rounded-md hover:bg-bg-sunken transition-colors cursor-grab active:cursor-grabbing"
      aria-label={meta.label}
    >
      <LazyThumb svg={iconFor(meta, view, defsTick)} size={40} />
      {showCaption && (
        <div className="text-[10px] text-text-body text-center leading-tight line-clamp-2 w-full">
          {meta.label}
        </div>
      )}
      <button
        className="absolute -top-0.5 -right-0.5 opacity-0 group-hover:opacity-100 text-text-faint hover:text-brand"
        title="Edit this part"
        onClick={(e) => {
          e.stopPropagation()
          onEditPart(meta.type)
        }}
      >
        <Pencil size={10} />
      </button>
    </div>
  )
})

/**
 * The hover tooltip, positioned in viewport coordinates.
 *
 * It can't live inside the tile: the bin scrolls, and a scroll container clips
 * on both axes, so an absolutely-positioned label inside a 48px cell would be
 * cut off at the palette's edge — which is exactly where every tile is. So one
 * fixed-position node renders at the palette root and follows whichever tile is
 * hovered, and it flips to the left of the rail when there's no room on the
 * right.
 */
function Tooltip({ meta, anchor }: { meta: PartMeta; anchor: HTMLElement }): React.JSX.Element {
  const box = anchor.getBoundingClientRect()
  const { title, lines } = tipFor(meta)
  const width = 200
  const flip = box.left - width - 10 > 0
  return (
    <div
      role="tooltip"
      className="fixed z-50 pointer-events-none rounded-md border border-border-default bg-surface-card px-2 py-1.5 shadow-lg"
      style={{
        width,
        left: flip ? box.left - width - 8 : Math.max(8, box.right + 8),
        top: Math.max(8, Math.min(box.top - 4, window.innerHeight - 90))
      }}
    >
      <div className="text-[11px] font-semibold text-text-strong leading-snug">{title}</div>
      {lines.map((l, i) => (
        <div key={i} className="text-[10px] text-text-muted leading-snug">
          {l}
        </div>
      ))}
    </div>
  )
}

/** One button in the vertical rail. Icons stay square so the strip reads as a
 * column of chips rather than a ragged list. */
function BinTab({
  bin,
  active,
  onClick
}: {
  bin: Bin
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={bin.title}
      aria-label={bin.title}
      aria-pressed={active}
      className={`relative w-full h-9 shrink-0 grid place-items-center border-l-2 transition ${
        active
          ? 'border-brand bg-brand/10 text-brand'
          : 'border-transparent text-text-muted hover:text-text-body hover:bg-bg-sunken'
      }`}
    >
      {typeof bin.icon === 'string' ? <PackGlyph icon={bin.icon} /> : bin.icon}
    </button>
  )
}

export function Palette({
  view,
  defsTick,
  onAdd,
  onAddNetLabel,
  onEditPart,
  onNewPart,
  onOpenPacks
}: {
  view: ViewId
  /** bumps whenever the part registry changes (import / pack install / edit) */
  defsTick: number
  onAdd: (type: string) => void
  onAddNetLabel: (kind: string, name: string) => void
  onEditPart: (type: string) => void
  onNewPart: () => void
  onOpenPacks: () => void
}): React.JSX.Element {
  // opens on the tinyStudio boards — the thing you're most likely reaching for
  const [bin, setBin] = React.useState<BinId>('tiny')
  const [query, setQuery] = React.useState('')
  const searchRef = React.useRef<HTMLInputElement>(null)
  const [tip, setTip] = React.useState<{ meta: PartMeta; anchor: HTMLElement } | null>(null)

  const onHover = React.useCallback((meta: PartMeta | null, anchor: HTMLElement | null) => {
    setTip(meta && anchor ? { meta, anchor } : null)
  }, [])

  const counts = React.useMemo(() => partCountsBySource(), [defsTick])
  const q = query.trim()

  // Search results are their own flat bin. Typing anywhere jumps you into it;
  // clearing the box drops you back to whichever bin you came from.
  const searching = bin === 'search' || q.length > 0
  const results = React.useMemo(() => (q ? searchParts(q) : []), [q, defsTick])

  // tinyStudio / Core / Mine / Search are fixed; every installed pack adds its
  // own tab, named and iconed from what the Pack Manager recorded at install
  // time.
  const bins = React.useMemo<Bin[]>(() => {
    const installed = getInstalledPacks()
    const packs = installedPackBins().map(({ bin: id, packId, count }): Bin => {
      const meta = installed[packId]
      const label = meta?.name || packId
      return {
        id,
        label,
        icon: meta?.icon || monogram(label),
        title: `${label} — ${count} part${count === 1 ? '' : 's'}`,
        count
      }
    })
    packs.sort((a, b) => a.label.localeCompare(b.label))
    return [
      {
        id: 'search',
        label: 'Search',
        icon: <Search size={14} />,
        title: 'Search every bin'
      },
      {
        id: 'tiny',
        label: 'tinyStudio',
        icon: <Cpu size={14} />,
        title: `tinyStudio boards — ${counts.tiny ?? 0} parts`,
        count: counts.tiny
      },
      {
        id: 'core',
        label: 'Core',
        icon: <LibraryBig size={14} />,
        title: `The component library that ships with tinyStudio — ${counts.core ?? 0} parts`,
        count: counts.core
      },
      {
        id: 'mine',
        label: 'Mine',
        icon: <Pencil size={14} />,
        title: `Parts you authored or imported — ${counts.mine ?? 0} parts`,
        count: counts.mine
      },
      ...packs
    ]
  }, [defsTick, counts])

  // a pack can vanish (uninstalled) while its tab is active
  React.useEffect(() => {
    if (!bins.some((b) => b.id === bin)) setBin('tiny')
  }, [bins, bin])

  // a tile can unmount under the cursor (bin switch, search) without ever
  // firing pointerleave, which would strand the tooltip
  React.useEffect(() => setTip(null), [bin, q, view])

  const activeBin = bins.find((b) => b.id === (searching ? 'search' : bin))

  // the active bin, flat and pre-sorted — no family grouping
  const tiles = React.useMemo(
    () => (searching ? [] : partsInBin(bin as PartSource)),
    [bin, searching, defsTick]
  )

  const focusSearch = (): void => {
    setBin('search')
    requestAnimationFrame(() => searchRef.current?.focus())
  }

  const emptyBinNote =
    bin === 'mine'
      ? 'Nothing here yet. Parts you author in the Parts Editor — or drop in as a .fzpz — land in this bin.'
      : bin === 'tiny'
        ? 'The tinyStudio boards should be here. If this bin is empty, the build is missing its built-in parts.'
        : packIdOfBin(bin)
          ? 'This pack has no parts left. Reinstall it from the packs panel.'
          : 'This bin is empty.'

  const tileProps = { view, defsTick, onAdd, onEditPart, onHover }

  return (
    <div className="w-64 shrink-0 min-h-0 relative z-20 border-l border-border-default bg-bg-raised flex">
      {/* vertical bin rail — Fritzing's tab strip */}
      <div className="w-9 shrink-0 border-r border-border-default flex flex-col bg-bg-sunken/40">
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {bins.map((b) => (
            <BinTab
              key={b.id}
              bin={b}
              active={b.id === (searching ? 'search' : bin)}
              onClick={() => {
                if (b.id === 'search') return focusSearch()
                setQuery('')
                setBin(b.id)
              }}
            />
          ))}
        </div>
        <button
          className="h-9 shrink-0 grid place-items-center border-t border-border-default text-text-muted hover:text-brand"
          title="Parts packs — install more components"
          onClick={onOpenPacks}
        >
          <Package size={14} />
        </button>
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-9 flex items-center justify-between gap-2 px-3 border-b border-border-default shrink-0">
          <span className="text-[13px] font-semibold text-text-body truncate">
            {activeBin?.label ?? 'Components'}
          </span>
          <button
            className="text-text-muted hover:text-brand shrink-0"
            title="New part…"
            onClick={onNewPart}
          >
            <Plus size={15} />
          </button>
        </div>

        {/* search field — sits where the wire-colour row used to */}
        <div className="px-2 py-2 border-b border-border-default shrink-0">
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setBin('search')}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder="Search parts…"
              className="w-full h-7 pl-6 pr-6 rounded-md bg-bg-sunken border border-border-default text-[11px] text-text-strong placeholder:text-text-faint outline-none focus:border-brand"
            />
            {query && (
              <button
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-faint hover:text-text-body"
                title="Clear search"
                onClick={() => {
                  setQuery('')
                  setBin('tiny')
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
          {searching ? (
            !q ? (
              <div className="px-1 py-2 text-[11px] text-text-faint leading-relaxed">
                Type above to search every bin by name, family, or tag.
              </div>
            ) : results.length === 0 ? (
              <div className="px-1 py-2 text-[11px] text-text-faint leading-relaxed">
                No parts match “{q}”.
              </div>
            ) : (
              <div>
                <div className="px-1 py-1 text-[11px] font-medium text-text-muted">
                  {results.length} result{results.length === 1 ? '' : 's'}
                </div>
                <div className="grid grid-cols-3 gap-1 pt-1 pb-1">
                  {results.map((c) => (
                    <PartTile key={c.type} meta={c} showCaption {...tileProps} />
                  ))}
                </div>
              </div>
            )
          ) : (
            <>
              {view === 'sch' && bin === 'core' && (
                <div>
                  <div className="px-1 py-1 text-[11px] font-medium text-text-muted">
                    Net Labels
                  </div>
                  {/* net-label symbols draw their own name, so they need no
                      caption either — same bare grid as the part tiles */}
                  <div className="grid grid-cols-4 gap-1 pt-1 pb-1">
                    {NET_LABEL_KINDS.map((k) => (
                      <div
                        key={`${k.kind}:${k.name}`}
                        draggable
                        onDragStart={(e) =>
                          e.dataTransfer.setData('text/tinystudio-netlabel', `${k.kind}:${k.name}`)
                        }
                        onDoubleClick={() => onAddNetLabel(k.kind, k.name)}
                        className="flex items-center justify-center p-1 rounded-md hover:bg-bg-sunken transition-colors cursor-grab active:cursor-grabbing"
                        title={`${k.label} — drag onto the schematic (or double-click)`}
                      >
                        <LazyThumb svg={netLabelView(k.kind, k.name).svg} size={40} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tiles.length === 0 ? (
                <div className="px-1 py-2 text-[11px] text-text-faint leading-relaxed">
                  {emptyBinNote}
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-1">
                  {tiles.map((c: PartMeta) => (
                    <PartTile key={c.type} meta={c} {...tileProps} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {tip && <Tooltip meta={tip.meta} anchor={tip.anchor} />}
    </div>
  )
}
