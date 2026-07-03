/**
 * circuit/views/inspector/Inspector — right-rail editing for the selection.
 * Part: refdes (rename with uniqueness check), label, location, rotation,
 * typed attrs. Wire: color, net info. Multi-select: summary + delete.
 * All edits dispatch Commands (undoable); moves/rotations reroute wires with
 * frozen bends like canvas drags do.
 */

import { CircuitBoard, Plus, RotateCw, Spline, Trash2 } from 'lucide-react'
import React from 'react'
import { getPart } from '../../../lib/partsLibrary'
import * as cmd from '../../core/commands'
import type { CircuitDoc, CircuitPart, CircuitWire, Placement } from '../../core/model'
import type { NetModel } from '../../core/nets'
import { isValidRefdes } from '../../core/refdes'
import type { CircuitStore } from '../../core/store'
import { collectFrozen, reroutesFor } from '../partsAdapter'
import { WIRE_COLORS } from '../palette/Palette'
import type { Selection } from '../canvas/Canvas'

const field =
  'bg-bg-sunken border border-border-default rounded px-2 py-1 text-text-strong outline-none focus:border-brand w-full'
const rowLabel = 'text-[11px] text-text-muted'

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bIc\b/, 'IC')
}

export function InspectorRail({
  doc,
  store,
  sel,
  setSel,
  netModel
}: {
  doc: CircuitDoc
  store: CircuitStore
  sel: Selection
  setSel: (s: Selection) => void
  netModel: NetModel
}): React.JSX.Element {
  const part =
    sel.parts.size === 1 && sel.wires.size === 0
      ? doc.parts.find((p) => p.id === [...sel.parts][0])
      : undefined
  const wire =
    sel.wires.size === 1 && sel.parts.size === 0
      ? doc.wires.find((w) => w.id === [...sel.wires][0])
      : undefined
  const multi = sel.parts.size + sel.wires.size > 1

  return (
    <div className="w-64 shrink-0 min-h-0 relative z-20 border-l border-border-default bg-bg-raised flex flex-col">
      <div className="h-9 flex items-center px-3 border-b border-border-default shrink-0">
        <span className="text-[13px] font-semibold text-text-body">Inspector</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3 text-xs">
        {part ? (
          <PartInspector key={part.id} part={part} doc={doc} store={store} setSel={setSel} />
        ) : wire ? (
          <WireInspector key={wire.id} wire={wire} store={store} setSel={setSel} netModel={netModel} />
        ) : multi ? (
          <MultiInspector sel={sel} store={store} setSel={setSel} />
        ) : (
          <div className="text-text-faint text-[11px] leading-relaxed">
            Select a component to edit its refdes, location, rotation, and properties — or a wire
            to recolor it. Shift-click or drag a marquee for multi-select.
          </div>
        )}
      </div>
    </div>
  )
}

function PartInspector({
  part,
  doc,
  store,
  setSel
}: {
  part: CircuitPart
  doc: CircuitDoc
  store: CircuitStore
  setSel: (s: Selection) => void
}): React.JSX.Element {
  const def = getPart(part.type)
  const [refdes, setRefdes] = React.useState(part.id)
  const [newAttr, setNewAttr] = React.useState('')
  React.useEffect(() => setRefdes(part.id), [part.id])

  const refdesTaken = refdes !== part.id && doc.parts.some((p) => p.id === refdes)
  const refdesBad = !isValidRefdes(refdes) || refdesTaken

  const commitRefdes = (): void => {
    if (refdes === part.id) return
    if (refdesBad) {
      setRefdes(part.id)
      return
    }
    store.dispatch(cmd.renamePart(part.id, refdes))
    setSel({ parts: new Set([refdes]), wires: new Set() })
  }

  const moveTo = (x: number, y: number): void => {
    if (!part.bb) return
    const frozen = collectFrozen(doc, new Set([part.id]))
    const pl: Placement = { ...part.bb, x, y }
    const placements = new Map([[part.id, pl]])
    store.dispatch(
      cmd.placePart(part.id, 'bb', pl, reroutesFor(doc, frozen, placements, { x: x - part.bb.x, y: y - part.bb.y }))
    )
  }

  const setRotation = (deg: number): void => {
    if (!part.bb) return
    const next = (((deg % 360) + 360) % 360) as 0 | 90 | 180 | 270
    const frozen = collectFrozen(doc, new Set([part.id]))
    const pl: Placement = { ...part.bb, rotate: next || undefined }
    const placements = new Map([[part.id, pl]])
    store.dispatch(cmd.placePart(part.id, 'bb', pl, reroutesFor(doc, frozen, placements, { x: 0, y: 0 })))
  }

  const wiresTouching = doc.wires.filter((w) =>
    [w.from, w.to].some((e) => typeof e === 'string' && e.split(':')[0] === part.id)
  ).length

  const propRows = Object.entries(part.attrs || {}).filter(([k]) => k !== 'label')

  return (
    <>
      <div className="flex items-center gap-2">
        <CircuitBoard size={16} className="text-brand shrink-0" />
        <input
          className={`${field} font-semibold ${refdesBad ? 'border-status-error' : ''}`}
          value={refdes}
          title={refdesTaken ? 'That refdes is taken' : 'Reference designator (unique)'}
          onChange={(e) => setRefdes(e.target.value)}
          onBlur={commitRefdes}
          onKeyDown={(e) => e.key === 'Enter' && commitRefdes()}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className={rowLabel}>Label (display)</span>
        <input
          className={field}
          value={String(part.attrs?.label ?? '')}
          placeholder={part.id}
          onChange={(e) =>
            store.dispatch(cmd.setPartAttr(part.id, 'label', e.target.value || undefined))
          }
        />
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 items-center text-text-muted">
        <span className={rowLabel}>Type</span>
        <span className="text-text-body truncate text-[11px]">{part.type}</span>
        <span className={rowLabel}>Family</span>
        <span className="text-text-body truncate">{def?.family ? titleCase(def.family) : '—'}</span>
        <span className={rowLabel}>Wires</span>
        <span className="text-text-body">{wiresTouching}</span>
      </div>

      {part.bb && (
        <>
          <div className="flex flex-col gap-1">
            <span className={rowLabel}>Location (breadboard)</span>
            <div className="flex gap-2">
              <input
                type="number"
                className={field}
                value={Math.round(part.bb.x)}
                onChange={(e) => moveTo(parseFloat(e.target.value) || 0, part.bb!.y)}
              />
              <input
                type="number"
                className={field}
                value={Math.round(part.bb.y)}
                onChange={(e) => moveTo(part.bb!.x, parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className={rowLabel}>Rotation</span>
            <div className="flex items-center gap-1">
              <select
                className={`${field} w-auto`}
                value={part.bb.rotate || 0}
                onChange={(e) => setRotation(parseInt(e.target.value, 10))}
              >
                {[0, 90, 180, 270].map((d) => (
                  <option key={d} value={d}>
                    {d}°
                  </option>
                ))}
              </select>
              <button
                className="tactile-bordered rounded-md p-1.5 bg-surface-card text-text-muted hover:text-brand"
                title="Rotate 90°"
                onClick={() => setRotation((part.bb!.rotate || 0) + 90)}
              >
                <RotateCw size={13} />
              </button>
            </div>
          </div>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <span className={rowLabel}>Properties</span>
        {propRows.length === 0 && (
          <div className="text-[11px] text-text-faint">
            No properties yet. Add one below — e.g. a resistor’s{' '}
            <span className="text-text-body">value</span>.
          </div>
        )}
        {propRows.map(([k, val]) => (
          <div key={k} className="flex items-center gap-1.5">
            <span className="text-[11px] text-text-muted w-16 truncate" title={k}>
              {k}
            </span>
            <input
              className={field}
              value={String(val ?? '')}
              onChange={(e) => store.dispatch(cmd.setPartAttr(part.id, k, e.target.value))}
            />
            <button
              className="text-text-faint hover:text-status-error shrink-0"
              title="Remove property"
              onClick={() => store.dispatch(cmd.setPartAttr(part.id, k, undefined))}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <input
            className={field}
            placeholder="new property…"
            value={newAttr}
            onChange={(e) => setNewAttr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newAttr.trim()) {
                store.dispatch(cmd.setPartAttr(part.id, newAttr.trim(), ''))
                setNewAttr('')
              }
            }}
          />
          <button
            className="tactile-bordered rounded-md p-1.5 bg-surface-card text-text-muted hover:text-brand shrink-0"
            title="Add property"
            onClick={() => {
              if (newAttr.trim()) {
                store.dispatch(cmd.setPartAttr(part.id, newAttr.trim(), ''))
                setNewAttr('')
              }
            }}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      <button
        className="mt-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border-default text-text-muted hover:text-status-error hover:border-status-error/40"
        onClick={() => {
          store.dispatch(cmd.deleteParts([part.id]))
          setSel({ parts: new Set(), wires: new Set() })
        }}
      >
        <Trash2 size={13} /> Delete component
      </button>
    </>
  )
}

function WireInspector({
  wire,
  store,
  setSel,
  netModel
}: {
  wire: CircuitWire
  store: CircuitStore
  setSel: (s: Selection) => void
  netModel: NetModel
}): React.JSX.Element {
  const netIdx = netModel.wireToNet.get(wire.id)
  const netPins = netIdx != null ? (netModel.nets[netIdx]?.length ?? 0) : 0
  const color = wire.color || '#2fa46a'
  return (
    <>
      <div className="flex items-center gap-2">
        <Spline size={16} className="text-brand shrink-0" />
        <span className="text-text-strong font-semibold">Wire</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={rowLabel}>Color</span>
        <div className="flex items-center gap-2">
          {WIRE_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => store.dispatch(cmd.recolorWire(wire.id, c))}
              className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                background: c,
                borderColor:
                  c.toLowerCase() === color.toLowerCase() ? 'var(--brand)' : 'rgba(255,255,255,0.18)'
              }}
            />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 items-center">
        <span className={rowLabel}>Net pins</span>
        <span className="text-text-body">{netPins}</span>
      </div>
      <button
        className="mt-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border-default text-text-muted hover:text-status-error hover:border-status-error/40"
        onClick={() => {
          store.dispatch(cmd.deleteWires([wire.id]))
          setSel({ parts: new Set(), wires: new Set() })
        }}
      >
        <Trash2 size={13} /> Delete wire
      </button>
    </>
  )
}

function MultiInspector({
  sel,
  store,
  setSel
}: {
  sel: Selection
  store: CircuitStore
  setSel: (s: Selection) => void
}): React.JSX.Element {
  return (
    <>
      <div className="text-text-strong font-semibold">
        {sel.parts.size} part{sel.parts.size === 1 ? '' : 's'} · {sel.wires.size} wire
        {sel.wires.size === 1 ? '' : 's'} selected
      </div>
      <div className="text-text-faint text-[11px] leading-relaxed">
        Drag to move together · R to rotate · arrows to nudge · Ctrl+C / Ctrl+D to copy or
        duplicate · Del to remove.
      </div>
      <button
        className="mt-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border-default text-text-muted hover:text-status-error hover:border-status-error/40"
        onClick={() => {
          const cmds: cmd.Command[] = []
          if (sel.parts.size) cmds.push(cmd.deleteParts([...sel.parts]))
          if (sel.wires.size) cmds.push(cmd.deleteWires([...sel.wires]))
          store.dispatch(cmds.length === 1 ? cmds[0] : cmd.composite('Delete selection', cmds))
          setSel({ parts: new Set(), wires: new Set() })
        }}
      >
        <Trash2 size={13} /> Delete selection
      </button>
    </>
  )
}
