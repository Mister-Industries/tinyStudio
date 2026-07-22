/**
 * circuit/views/palette/Palette — the Fritzing-style components rail (M1).
 * Reads the LEGACY partsLibrary manifest (replaced by the pack registry in
 * M2); drag a tile onto the canvas or double-click to drop it at centre.
 */

import { ChevronDown, ChevronRight, CircuitBoard, Package, Pencil, Plus } from 'lucide-react'
import React from 'react'
import { getPart, partsByFamily, type PartMeta } from '../../../lib/partsLibrary'
import type { ViewId } from '../../core/model'
import { NET_LABEL_KINDS, netLabelView } from '../../parts/netLabels'
import { schematicVisual } from '../../parts/symbols'

export const WIRE_COLORS = ['#2fa46a', '#e5544b', '#42a5f5', '#f3cb00', '#ffffff', '#79818c']

function iconFor(meta: PartMeta, view: ViewId): string | undefined {
  if (view === 'sch') {
    const def = getPart(meta.type)
    if (def) return schematicVisual(def).svg
  }
  return meta.icon
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bIc\b/, 'IC')
}

function Thumb({ svg, size = 40 }: { svg?: string; size?: number }): React.JSX.Element {
  if (!svg)
    return (
      <div
        className="shrink-0 rounded-md grid place-items-center"
        style={{ width: size, height: size, background: 'var(--warm-150)' }}
      >
        <CircuitBoard size={20} style={{ color: '#79818c' }} />
      </div>
    )
  return (
    <div
      className="shrink-0 rounded-md p-1 grid place-items-center [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto"
      style={{ width: size, height: size, background: 'var(--warm-150)' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
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
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  const families = partsByFamily()
  const isOpen = (fam: string): boolean => !collapsed.has(fam)
  const toggleFam = (fam: string): void =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(fam)) n.delete(fam)
      else n.add(fam)
      return n
    })

  return (
    <div className="w-60 shrink-0 min-h-0 relative z-20 border-r border-border-default bg-bg-raised flex flex-col">
      <div className="h-9 flex items-center justify-between px-3 border-b border-border-default shrink-0">
        <span className="text-[13px] font-semibold text-text-body">Components</span>
        <button
          className="text-text-muted hover:text-brand"
          title="Parts packs — install more components"
          onClick={onOpenPacks}
        >
          <Package size={15} />
        </button>
        <button className="text-text-muted hover:text-brand" title="New part…" onClick={onNewPart}>
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
      <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
        {view === 'sch' && (
          <div>
            <div className="px-1 py-1 text-[11px] font-medium text-text-muted">Net Labels</div>
            <div className="grid grid-cols-2 gap-1.5 pt-1 pb-1">
              {NET_LABEL_KINDS.map((k) => (
                <div
                  key={`${k.kind}:${k.name}`}
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData('text/tinystudio-netlabel', `${k.kind}:${k.name}`)
                  }
                  onDoubleClick={() => onAddNetLabel(k.kind, k.name)}
                  className="group relative flex flex-col items-center gap-1 p-2 rounded-lg border border-border-default bg-surface-card hover:bg-bg-sunken hover:-translate-y-px transition cursor-grab active:cursor-grabbing"
                  title={`${k.label} — drag onto the schematic (or double-click)`}
                >
                  <Thumb svg={netLabelView(k.kind, k.name).svg} size={44} />
                  <div className="text-[10px] text-text-body text-center leading-tight w-full">
                    {k.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {families.map((group) => (
          <div key={group.family}>
            <button
              className="w-full flex items-center gap-1 px-1 py-1 text-[11px] font-medium text-text-muted hover:text-text-body"
              onClick={() => toggleFam(group.family)}
            >
              {isOpen(group.family) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="truncate">{titleCase(group.family)}</span>
              <span className="ml-auto text-text-faint/70">{group.parts.length}</span>
            </button>
            {isOpen(group.family) && (
              <div className="grid grid-cols-2 gap-1.5 pt-1 pb-1">
                {group.parts.map((c: PartMeta) => (
                  <div
                    key={c.type}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/tinystudio-part', c.type)}
                    onDoubleClick={() => onAdd(c.type)}
                    className="group relative flex flex-col items-center gap-1 p-2 rounded-lg border border-border-default bg-surface-card hover:bg-bg-sunken hover:-translate-y-px transition cursor-grab active:cursor-grabbing"
                    title={`${c.label} · ${c.pins} pins — drag onto the canvas (or double-click)`}
                  >
                    <Thumb svg={iconFor(c, view)} size={44} />
                    <div className="text-[10px] text-text-body text-center leading-tight line-clamp-2 w-full">
                      {c.label}
                    </div>
                    <button
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-text-faint hover:text-brand"
                      title="Edit this part"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEditPart(c.type)
                      }}
                    >
                      <Pencil size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
