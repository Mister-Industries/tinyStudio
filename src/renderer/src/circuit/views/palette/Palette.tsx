/**
 * circuit/views/palette/Palette — the parts bin, laid out like Fritzing's: a
 * rail of tabs (Search, Core, Mine, then one per installed pack) beside a grid
 * of part icons in sections. Which part goes where: ./paletteLayout.
 * Drag a tile onto the canvas, or double-click it to drop it at the centre.
 */

import { CircuitBoard, Package, Pencil, Plus, Search } from 'lucide-react'
import React from 'react'
import {
  getPackInfo,
  getPart,
  onPartsChanged,
  PART_MANIFEST,
  type PartMeta
} from '../../../lib/partsLibrary'
import { STORAGE_KEYS } from '../../../lib/storageKeys'
import type { ViewId } from '../../core/model'
import { NET_LABEL_KINDS, netLabelView } from '../../parts/netLabels'
import { schematicVisual } from '../../parts/symbols'
import { WIRE_COLORS } from './wireColors'
import { sanitizeSvg } from '../../../lib/sanitizeSvg'
import {
  CORE_TAB,
  MINE_TAB,
  paletteTabs,
  searchParts,
  SEARCH_TAB,
  type PaletteSection,
  type PaletteTab
} from './paletteLayout'

function iconFor(meta: PartMeta, view: ViewId): string | undefined {
  if (view === 'sch') {
    const def = getPart(meta.type)
    if (def) return schematicVisual(def).svg
  }
  return meta.icon
}

function readSavedTab(): string {
  try {
    return localStorage.getItem(STORAGE_KEYS.paletteTab) || CORE_TAB
  } catch {
    return CORE_TAB // storage blocked: start on Core
  }
}

function saveTab(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.paletteTab, id)
  } catch {
    /* storage blocked: the tab just isn't remembered */
  }
}

const Thumb = React.memo(function Thumb({ svg }: { svg?: string }): React.JSX.Element {
  const html = React.useMemo(() => (svg ? sanitizeSvg(svg) : ''), [svg])
  if (!html) return <CircuitBoard size={18} style={{ color: '#79818c' }} />
  return (
    <div
      className="size-full grid place-items-center [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})

/** A tab's icon: the pack's own image, its SVG, or its short text code. */
function TabIcon({ tab }: { tab: PaletteTab }): React.JSX.Element {
  const icon = tab.icon
  if (tab.id === CORE_TAB || tab.id === MINE_TAB || !icon)
    return (
      <span className="text-[9px] font-bold tracking-wide leading-none">
        {tab.id === CORE_TAB || tab.id === MINE_TAB
          ? tab.title.toUpperCase()
          : tab.title.slice(0, 2)}
      </span>
    )
  if (icon.startsWith('data:image/'))
    return <img src={icon} alt="" className="size-6 object-contain" draggable={false} />
  if (icon.trimStart().startsWith('<'))
    return (
      <span
        className="size-6 grid place-items-center [&>svg]:max-w-full [&>svg]:max-h-full"
        dangerouslySetInnerHTML={{ __html: sanitizeSvg(icon) }}
      />
    )
  return <span className="text-[10px] font-bold leading-none">{icon.slice(0, 3)}</span>
}

const tileClass =
  'group relative size-9 p-0.5 rounded-md border border-border-default bg-surface-card hover:bg-bg-sunken hover:border-brand hover:-translate-y-px transition cursor-grab active:cursor-grabbing'

function PartTile({
  part,
  view,
  onAdd,
  onEdit
}: {
  part: PartMeta
  view: ViewId
  onAdd: (type: string) => void
  onEdit: (type: string) => void
}): React.JSX.Element {
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/tinystudio-part', part.type)}
      onDoubleClick={() => onAdd(part.type)}
      className={tileClass}
      title={`${part.label} · ${part.pins} pins\nDrag onto the canvas, or double-click`}
    >
      <Thumb svg={iconFor(part, view)} />
      <button
        className="absolute -top-1 -right-1 hidden group-hover:grid place-items-center size-4 rounded-full bg-surface-card border border-border-default text-text-faint hover:text-brand"
        title="Edit this part"
        onClick={(e) => {
          e.stopPropagation()
          onEdit(part.type)
        }}
      >
        <Pencil size={9} />
      </button>
    </div>
  )
}

function NetLabelTiles({
  onAddNetLabel
}: {
  onAddNetLabel: (kind: string, name: string) => void
}): React.JSX.Element {
  return (
    <>
      {NET_LABEL_KINDS.map((k) => (
        <div
          key={`${k.kind}:${k.name}`}
          draggable
          onDragStart={(e) =>
            e.dataTransfer.setData('text/tinystudio-netlabel', `${k.kind}:${k.name}`)
          }
          onDoubleClick={() => onAddNetLabel(k.kind, k.name)}
          className={tileClass}
          title={`${k.label}\nDrag onto the schematic, or double-click`}
        >
          <Thumb svg={netLabelView(k.kind, k.name).svg} />
        </div>
      ))}
    </>
  )
}

function SectionGrid({
  section,
  children
}: {
  section: Pick<PaletteSection, 'title'>
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      {section.title && (
        <div className="px-0.5 pb-1 text-[11px] font-medium text-text-muted">{section.title}</div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,2.25rem)] gap-1">{children}</div>
    </div>
  )
}

export function Palette({
  view,
  wireColor,
  onPickColor,
  onAdd,
  onAddNetLabel,
  onEditPart,
  onNewPart,
  onOpenPacks
}: {
  view: ViewId
  wireColor: string
  onPickColor: (c: string) => void
  onAdd: (type: string) => void
  onAddNetLabel: (kind: string, name: string) => void
  onEditPart: (type: string) => void
  onNewPart: () => void
  onOpenPacks: () => void
}): React.JSX.Element {
  const [rev, setRev] = React.useState(0)
  React.useEffect(() => onPartsChanged(() => setRev((r) => r + 1)), [])
  const [tabId, setTabId] = React.useState(readSavedTab)
  const [query, setQuery] = React.useState('')

  // eslint-disable-next-line react-hooks/exhaustive-deps -- rev: the manifest mutates in place
  const tabs = React.useMemo(() => paletteTabs(PART_MANIFEST, getPackInfo), [rev])
  const results = React.useMemo(
    () => (tabId === SEARCH_TAB ? searchParts(PART_MANIFEST, query, getPackInfo) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rev: the manifest mutates in place
    [tabId, query, rev]
  )
  // an uninstalled pack's tab falls back to Core
  const tab = tabId === SEARCH_TAB ? undefined : (tabs.find((t) => t.id === tabId) ?? tabs[0])
  const pick = (id: string): void => {
    setTabId(id)
    saveTab(id)
  }

  const sections: PaletteSection[] = tab?.sections ?? []

  const railButton = (id: string, title: string, content: React.ReactNode): React.JSX.Element => {
    const active = (tab?.id ?? SEARCH_TAB) === id
    return (
      <button
        key={id}
        onClick={() => pick(id)}
        title={title}
        className={`relative shrink-0 w-full h-10 grid place-items-center transition ${
          active
            ? 'bg-bg-raised text-brand'
            : 'text-text-muted hover:text-text-body hover:bg-bg-raised/60'
        }`}
      >
        {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-brand" />}
        {content}
      </button>
    )
  }

  const tile = (p: PartMeta): React.JSX.Element => (
    <PartTile key={p.type} part={p} view={view} onAdd={onAdd} onEdit={onEditPart} />
  )

  return (
    <div className="w-[17rem] shrink-0 min-h-0 relative z-20 border-r border-border-default bg-bg-raised flex">
      <nav
        className="w-10 shrink-0 border-r border-border-default bg-bg-sunken flex flex-col overflow-y-auto overflow-x-hidden"
        aria-label="Parts bins"
      >
        {railButton(SEARCH_TAB, 'Search parts', <Search size={16} />)}
        {tabs.map((t) =>
          railButton(
            t.id,
            t.id === MINE_TAB ? 'Mine: parts you imported or made' : t.title,
            <TabIcon tab={t} />
          )
        )}
        <button
          className="shrink-0 w-full h-10 grid place-items-center text-text-faint hover:text-brand"
          title="Get more parts: install packs such as Arduino or SparkFun"
          onClick={onOpenPacks}
        >
          <Plus size={16} />
        </button>
      </nav>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-9 flex items-center gap-2 px-3 border-b border-border-default shrink-0">
          <span className="text-[13px] font-semibold text-text-body truncate flex-1">
            {tab?.title ?? 'Search'}
          </span>
          <button
            className="text-text-muted hover:text-brand"
            title="Parts packs: install more components"
            onClick={onOpenPacks}
          >
            <Package size={15} />
          </button>
          <button
            className="text-text-muted hover:text-brand"
            title="New part…"
            onClick={onNewPart}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border-default shrink-0">
          <span className="text-[11px] text-text-muted mr-1">Wire</span>
          {WIRE_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onPickColor(c)}
              className="w-4 h-4 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                background: c,
                borderColor: wireColor === c ? 'var(--brand)' : 'rgba(255,255,255,0.18)'
              }}
              title="Set wire color (recolors the selected wire)"
            />
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-1.5 py-2 flex flex-col gap-3">
          {tabId === SEARCH_TAB && (
            <>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search installed parts"
                className="w-full h-8 px-2 rounded-md border border-border-default bg-surface-card text-[12px] text-text-body placeholder:text-text-faint outline-none focus:border-brand"
              />
              {query.trim() && !results.length && (
                <p className="text-[11px] text-text-muted px-0.5">
                  No installed part matches. More parts come in packs (+ in the bar on the left).
                </p>
              )}
              {results.length > 0 && <SectionGrid section={{}}>{results.map(tile)}</SectionGrid>}
            </>
          )}

          {tab?.id === MINE_TAB && !sections.length && (
            <p className="text-[11px] text-text-muted px-0.5 leading-relaxed">
              Parts you import (drop a .fzpz on the canvas) or make with <b>New part</b> appear
              here.
            </p>
          )}

          {tab?.id === CORE_TAB && view === 'sch' && (
            <SectionGrid section={{ title: 'Net Labels' }}>
              <NetLabelTiles onAddNetLabel={onAddNetLabel} />
            </SectionGrid>
          )}
          {sections.map((s) => (
            <SectionGrid key={s.title ?? ''} section={s}>
              {s.parts.map(tile)}
            </SectionGrid>
          ))}
        </div>
      </div>
    </div>
  )
}
