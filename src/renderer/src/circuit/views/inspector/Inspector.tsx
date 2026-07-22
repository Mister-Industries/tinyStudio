/**
 * circuit/views/inspector/Inspector — right-rail editing for the selection.
 * Part: refdes (rename with uniqueness check), label, location, rotation,
 * typed attrs. Wire: color, net info. Multi-select: summary + delete.
 * All edits dispatch Commands (undoable); moves/rotations reroute wires with
 * frozen bends like canvas drags do.
 */

import { CircuitBoard, FlipHorizontal2, Plus, RotateCw, Spline, Trash2 } from 'lucide-react'
import React from 'react'
import { getPart } from '../../../lib/partsLibrary'
import * as cmd from '../../core/commands'
import type {
  CircuitDoc,
  CircuitPart,
  CircuitWire,
  NetLabel,
  NetLabelKind,
  Placement,
  ViewId
} from '../../core/model'
import type { NetModel } from '../../core/nets'
import { simAttrsFor } from '../../core/netlist'
import { isValidRefdes } from '../../core/refdes'
import type { CircuitStore } from '../../core/store'
import { isBreadboard } from '../../parts/breadboard'
import {
  collectFrozen,
  implicitSeats,
  reroutesFor,
  rotateBoardAssemblyCmd,
  rotateNetLabelCmd
} from '../partsAdapter'
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
  netModel,
  view
}: {
  doc: CircuitDoc
  store: CircuitStore
  sel: Selection
  setSel: (s: Selection) => void
  netModel: NetModel
  view: ViewId
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
  const label =
    sel.parts.size === 0 && sel.wires.size === 0 && (sel.labels?.size ?? 0) === 1
      ? doc.netLabels?.find((l) => l.id === [...(sel.labels ?? [])][0])
      : undefined

  return (
    <div className="w-64 shrink-0 min-h-0 relative z-20 border-l border-border-default bg-bg-raised flex flex-col">
      <div className="h-9 flex items-center px-3 border-b border-border-default shrink-0">
        <span className="text-[13px] font-semibold text-text-body">Inspector</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3 text-xs">
        {part ? (
          <PartInspector
            key={`${part.id}:${view}`}
            part={part}
            doc={doc}
            store={store}
            setSel={setSel}
            view={view}
          />
        ) : wire ? (
          <WireInspector
            key={wire.id}
            wire={wire}
            store={store}
            setSel={setSel}
            netModel={netModel}
          />
        ) : multi ? (
          <MultiInspector sel={sel} store={store} setSel={setSel} />
        ) : label ? (
          <LabelInspector key={label.id} label={label} doc={doc} store={store} setSel={setSel} />
        ) : (
          <div className="text-text-faint text-[11px] leading-relaxed">
            Select a component to edit its refdes, location, rotation, and properties — or a wire to
            recolor it. Shift-click or drag a marquee for multi-select.
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
  setSel,
  view
}: {
  part: CircuitPart
  doc: CircuitDoc
  store: CircuitStore
  setSel: (s: Selection) => void
  view: ViewId
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

  const pv = part[view]
  const moveTo = (x: number, y: number): void => {
    if (!pv) return
    const frozen = collectFrozen(doc, new Set([part.id]), view)
    const pl: Placement = { ...pv, x, y }
    const placements = new Map([[part.id, pl]])
    store.dispatch(
      cmd.placePart(
        part.id,
        view,
        pl,
        reroutesFor(doc, frozen, placements, { x: x - pv.x, y: y - pv.y }, view)
      )
    )
  }

  const setRotation = (deg: number): void => {
    if (!pv) return
    const next = (((deg % 360) + 360) % 360) as 0 | 90 | 180 | 270
    // Breadboards rotate as a rigid assembly (board + seated parts + wires
    // between them) — same path as the canvas R / right-click gesture.
    if (view === 'bb' && isBreadboard(part.type)) {
      const steps = ((next - (pv.rotate ?? 0)) / 90 + 4) % 4
      const c = rotateBoardAssemblyCmd(doc, part.id, implicitSeats(doc), steps)
      if (c) store.dispatch(c)
      return
    }
    const frozen = collectFrozen(doc, new Set([part.id]), view)
    const pl: Placement = { ...pv, rotate: next || undefined }
    const placements = new Map([[part.id, pl]])
    store.dispatch(
      cmd.placePart(part.id, view, pl, reroutesFor(doc, frozen, placements, { x: 0, y: 0 }, view))
    )
  }

  const toggleFlip = (): void => {
    if (!pv) return
    const frozen = collectFrozen(doc, new Set([part.id]), view)
    const pl: Placement = { ...pv, flip: pv.flip ? undefined : true }
    const placements = new Map([[part.id, pl]])
    store.dispatch(
      cmd.placePart(part.id, view, pl, reroutesFor(doc, frozen, placements, { x: 0, y: 0 }, view))
    )
  }

  const wiresTouching = doc.wires.filter((w) =>
    [w.from, w.to].some((e) => typeof e === 'string' && e.split(':')[0] === part.id)
  ).length

  const simAttrs = simAttrsFor(part.type, def?.family)
  const simKeys = new Set(simAttrs.map((a) => a.key))
  const propRows = Object.entries(part.attrs || {}).filter(
    ([k]) => k !== 'label' && !simKeys.has(k)
  )

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

      {pv && (
        <>
          <div className="flex flex-col gap-1">
            <span className={rowLabel}>
              Location ({view === 'bb' ? 'breadboard' : 'schematic'})
            </span>
            <div className="flex gap-2">
              <input
                type="number"
                className={field}
                value={Math.round(pv.x)}
                onChange={(e) => moveTo(parseFloat(e.target.value) || 0, pv.y)}
              />
              <input
                type="number"
                className={field}
                value={Math.round(pv.y)}
                onChange={(e) => moveTo(pv.x, parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className={rowLabel}>Rotation</span>
            <div className="flex items-center gap-1">
              <select
                className={`${field} w-auto`}
                value={pv.rotate || 0}
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
                onClick={() => setRotation((pv.rotate || 0) + 90)}
              >
                <RotateCw size={13} />
              </button>
              {view === 'sch' && (
                <button
                  className={`tactile-bordered rounded-md p-1.5 bg-surface-card hover:text-brand ${pv.flip ? 'text-brand' : 'text-text-muted'}`}
                  title="Mirror horizontally (F)"
                  onClick={toggleFlip}
                >
                  <FlipHorizontal2 size={13} />
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {simAttrs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className={rowLabel}>Simulation</span>
          {simAttrs.map((a) => (
            <div key={a.key} className="flex items-center gap-1.5">
              <span className="text-[11px] text-text-muted w-16 truncate" title={a.hint || a.label}>
                {a.label}
              </span>
              <input
                className={field}
                value={String(part.attrs?.[a.key] ?? '')}
                placeholder={a.default}
                title={a.hint}
                onChange={(e) =>
                  store.dispatch(
                    cmd.setPartAttr(part.id, a.key, e.target.value === '' ? undefined : e.target.value)
                  )
                }
              />
              {a.hint && (
                <span className="text-[10px] text-text-faint w-8 shrink-0 truncate">{a.hint}</span>
              )}
            </div>
          ))}
        </div>
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
                  c.toLowerCase() === color.toLowerCase()
                    ? 'var(--brand)'
                    : 'rgba(255,255,255,0.18)'
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
        Drag to move together · R to rotate · arrows to nudge · Ctrl+C / Ctrl+D to copy or duplicate
        · Del to remove.
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

function LabelInspector({
  label,
  doc,
  store,
  setSel
}: {
  label: NetLabel
  doc: CircuitDoc
  store: CircuitStore
  setSel: (s: Selection) => void
}): React.JSX.Element {
  const [name, setName] = React.useState(label.name)
  React.useEffect(() => setName(label.name), [label.id, label.name])

  const commitName = (): void => {
    const n = name.trim()
    if (!n || n === label.name) {
      setName(label.name)
      return
    }
    store.dispatch(cmd.updateNetLabel(label.id, { name: n }))
  }

  const setKind = (kind: NetLabelKind): void => {
    const patch = kind === 'ground' ? { kind, name: 'GND' } : { kind }
    store.dispatch(cmd.updateNetLabel(label.id, patch))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Spline size={14} className="text-brand" />
        <span className="font-semibold text-text-strong">Net label</span>
      </div>
      <label className="flex flex-col gap-1">
        <span className={rowLabel}>Net name</span>
        <input
          className={field}
          value={name}
          disabled={label.kind === 'ground'}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && commitName()}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={rowLabel}>Kind</span>
        <select
          className={field}
          value={label.kind}
          onChange={(e) => setKind(e.target.value as NetLabelKind)}
        >
          <option value="ground">Ground (GND)</option>
          <option value="power">Power rail</option>
          <option value="net">Named net</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={rowLabel}>Rotation</span>
        <div className="flex items-center gap-1.5">
          <select
            className={field}
            value={label.sch.rotate || 0}
            onChange={(e) => {
              const target = Number(e.target.value)
              let c: ReturnType<typeof rotateNetLabelCmd> = null
              let d = doc
              // rotateNetLabelCmd is a single 90° step; compose to reach target
              const steps = (((target - (label.sch.rotate || 0)) / 90 + 4) % 4 + 4) % 4
              const cmds: cmd.Command[] = []
              for (let i = 0; i < steps; i++) {
                c = rotateNetLabelCmd(d, label.id)
                if (!c) break
                cmds.push(c)
                d = c.apply(d)
              }
              if (cmds.length)
                store.dispatch(cmds.length === 1 ? cmds[0] : cmd.composite('Rotate label', cmds))
            }}
          >
            {[0, 90, 180, 270].map((r) => (
              <option key={r} value={r}>
                {r}°
              </option>
            ))}
          </select>
          <button
            className="h-[26px] px-2 rounded border border-border-default bg-surface-card text-text-body hover:border-brand"
            title="Rotate 90°"
            onClick={() => {
              const c = rotateNetLabelCmd(doc, label.id)
              if (c) store.dispatch(c)
            }}
          >
            <RotateCw size={13} />
          </button>
        </div>
      </label>
      <p className="text-[11px] text-text-faint leading-relaxed">
        Labels sharing a name join the same net — a clean way to wire power and ground without long
        wires.
      </p>
      <button
        className="mt-1 flex items-center justify-center gap-1.5 h-8 rounded-md bg-surface-card border border-border-default text-status-danger hover:border-status-danger/50"
        onClick={() => {
          store.dispatch(cmd.deleteNetLabel(label.id))
          setSel({ parts: new Set(), wires: new Set(), labels: new Set() })
        }}
      >
        <Trash2 size={13} /> Delete label
      </button>
    </div>
  )
}
