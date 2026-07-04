/**
 * circuit/views/partsAdapter — geometry glue between the v2 document and the
 * LEGACY partsLibrary (breadboard view only). Temporary by design: the M2
 * parts registry (`circuit/parts/registry.ts`) replaces every import of
 * `lib/partsLibrary` in here without touching the canvas.
 *
 * Everything geometric the editor needs lives here so Canvas, Inspector and
 * the image exporter share one implementation:
 *   - pin world positions (rotation/flip/leg aware, via core/geometry)
 *   - wire endpoint resolution (pins, junctions, pending v1 junctions)
 *   - rendered wire polylines
 *   - frozen-bend reroutes for part moves (the collectFrozen behavior)
 */

import { getPart, viewFor, type PartDef, type PartView } from '../../lib/partsLibrary'
import { schematicVisual } from '../parts/symbols'
import { pinWorld, snapPlacementToPinGrid } from '../core/geometry'
import {
  GRID_BB,
  isJunction,
  isPendingJunction,
  splitPinRef,
  type CircuitDoc,
  type CircuitPart,
  type CircuitWire,
  type Placement,
  type Pt,
  type ViewId,
  type WireEnd
} from '../core/model'
import {
  bendsFromJourney,
  buildWirePoints,
  isStraightRoute,
  journeyFromPoints,
  pointAtT,
  wirePoints
} from '../core/routing'
import type { WireReroute } from '../core/commands'

export interface PartVisual {
  def: PartDef
  v: PartView
}

/** Visual for a part type in a view, or null while its def is still loading.
 * Schematic falls back to a generated IC-box symbol (spec §5.1). */
export function visualFor(type: string, view: ViewId): PartVisual | null {
  const def = getPart(type)
  if (!def) return null
  if (view === 'sch') return { def, v: schematicVisual(def) }
  const v = viewFor(def, 'breadboard')
  return v ? { def, v } : null
}

/** Breadboard visual (bb-fixed callers: seats, breadboard holes, exports). */
export function bbVisual(type: string): PartVisual | null {
  return visualFor(type, 'bb')
}

/** First pin's local coordinate (the snap-by-pin alignment reference). */
export function firstPinLocal(type: string, view: ViewId = 'bb'): [number, number] | undefined {
  const vis = visualFor(type, view)
  if (!vis) return undefined
  return Object.values(vis.v.pins)[0]
}

/** Snap a placement so its PINS land on the 9.6 px major grid (both views —
 * spec §4 pin-on-grid contract; Fritzing behavior). */
export function snapBB(type: string, placement: Placement, view: ViewId = 'bb'): Placement {
  const vis = visualFor(type, view)
  if (!vis) return { ...placement, x: Math.round(placement.x / GRID_BB) * GRID_BB, y: Math.round(placement.y / GRID_BB) * GRID_BB }
  const { x, y } = snapPlacementToPinGrid(placement, firstPinLocal(type, view), vis.v.w, vis.v.h, GRID_BB)
  return { ...placement, x, y }
}

/** World position of a part's pin in a view (leg-tip aware in bb). */
export function pinWorldOf(
  part: CircuitPart,
  pin: string,
  placement?: Placement,
  view: ViewId = 'bb'
): Pt | null {
  const pl = placement ?? part[view]
  if (!pl) return null
  const vis = visualFor(part.type, view)
  const local = vis?.v.pins[pin]
  if (!vis || !local) return null
  return pinWorld(local, pl, vis.v.w, vis.v.h, view === 'bb' ? pl.legs?.[pin] : undefined)
}

export type EndResolver = (end: WireEnd, seen?: Set<string>) => Pt | null

/**
 * Endpoint resolver over a doc, with optional per-part placement overrides
 * (used mid-drag so wires track the moving part before the command commits).
 * Pending v1 junctions resolve to their raw coordinate.
 */
export function makeEndResolver(
  doc: CircuitDoc,
  overrides?: Map<string, Placement>,
  view: ViewId = 'bb'
): EndResolver {
  const wireById = new Map(doc.wires.map((w) => [w.id, w]))
  const resolve: EndResolver = (end, seen = new Set()) => {
    if (isJunction(end)) {
      if (isPendingJunction(end)) return { x: end.x, y: end.y }
      if (seen.has(end.wire)) return null
      seen.add(end.wire)
      const host = wireById.get(end.wire)
      if (!host) return null
      const s = resolve(host.from, seen)
      const t = resolve(host.to, seen)
      if (!s || !t) return null
      return pointAtT(wirePoints(s, t, host.route), end.t)
    }
    const { part: partId, pin } = splitPinRef(end)
    const part = doc.parts.find((p) => p.id === partId)
    if (!part) return null
    return pinWorldOf(part, pin, overrides?.get(partId) ?? part[view], view)
  }
  return resolve
}

export interface ResolvedWire {
  w: CircuitWire
  pts: Pt[]
}

/** Rendered polylines for every wire of a view (empty pts when unresolvable). */
export function wireGeometry(
  doc: CircuitDoc,
  view: ViewId,
  overrides?: Map<string, Placement>
): ResolvedWire[] {
  const resolve = makeEndResolver(doc, overrides, view)
  return doc.wires
    .filter((w) => w.view === view)
    .map((w) => {
      const s = resolve(w.from)
      const t = resolve(w.to)
      return { w, pts: s && t ? wirePoints(s, t, w.route) : [] }
    })
}

/** Topmost pin within `tol` world px of a world point. */
export function pinAtWorld(
  doc: CircuitDoc,
  wx: number,
  wy: number,
  tol: number,
  view: ViewId = 'bb'
): { id: string; pin: string; pos: Pt } | null {
  for (let i = doc.parts.length - 1; i >= 0; i--) {
    const part = doc.parts[i]
    if (!part[view]) continue
    const vis = visualFor(part.type, view)
    if (!vis) continue
    for (const pin of Object.keys(vis.v.pins)) {
      const pos = pinWorldOf(part, pin, undefined, view)
      if (pos && Math.hypot(pos.x - wx, pos.y - wy) < tol) return { id: part.id, pin, pos }
    }
  }
  return null
}

/** Bounding box of everything placed in a view, or null when empty. */
export function viewBounds(
  doc: CircuitDoc,
  view: ViewId = 'bb'
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const part of doc.parts) {
    const pl = part[view]
    if (!pl) continue
    const vis = visualFor(part.type, view)
    if (!vis) continue
    minX = Math.min(minX, pl.x)
    minY = Math.min(minY, pl.y)
    maxX = Math.max(maxX, pl.x + vis.v.w)
    maxY = Math.max(maxY, pl.y + vis.v.h)
  }
  for (const { pts } of wireGeometry(doc, view)) {
    for (const p of pts) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  return isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

// ── frozen-bend part moves (the collectFrozen behavior, v2 flavor) ───────────

export interface FrozenWire {
  id: string
  bends: Pt[]
  straight: boolean
  /** Both endpoints sit on moved parts — bends translate with the move. */
  both: boolean
}

/** Snapshot the wires touching any of `ids` before a move begins. */
export function collectFrozen(doc: CircuitDoc, ids: Set<string>, view: ViewId = 'bb'): FrozenWire[] {
  const resolve = makeEndResolver(doc, undefined, view)
  const touches = (e: WireEnd): boolean =>
    typeof e === 'string' && ids.has(splitPinRef(e).part)
  const out: FrozenWire[] = []
  for (const w of doc.wires) {
    if (w.view !== view) continue
    const f = touches(w.from)
    const t = touches(w.to)
    if (!f && !t) continue
    const s = resolve(w.from)
    const e = resolve(w.to)
    if (!s || !e) continue
    out.push({
      id: w.id,
      bends: bendsFromJourney(w.route, s, e),
      straight: isStraightRoute(w.route),
      both: f && t
    })
  }
  return out
}

/**
 * New journeys for frozen wires given the moved parts' new placements.
 * Single-anchored wires keep their bends fixed in world space; wires between
 * two moved parts translate their bends by `delta`.
 */
export function reroutesFor(
  doc: CircuitDoc,
  frozen: FrozenWire[],
  placements: Map<string, Placement>,
  delta: Pt,
  view: ViewId = 'bb'
): WireReroute[] {
  const resolve = makeEndResolver(doc, placements, view)
  const wireById = new Map(doc.wires.map((w) => [w.id, w]))
  const out: WireReroute[] = []
  for (const f of frozen) {
    const w = wireById.get(f.id)
    if (!w) continue
    const s = resolve(w.from)
    const t = resolve(w.to)
    if (!s || !t) continue
    const bends = f.both ? f.bends.map((b) => ({ x: b.x + delta.x, y: b.y + delta.y })) : f.bends
    out.push({ wireId: f.id, route: journeyFromPoints(buildWirePoints(s, bends, t, f.straight), f.straight) })
  }
  return out
}

/** bb-fixed aliases (exportImage & friends). */
export function bbWireGeometry(doc: CircuitDoc, overrides?: Map<string, Placement>): ResolvedWire[] {
  return wireGeometry(doc, 'bb', overrides)
}
export function bbBounds(doc: CircuitDoc): { minX: number; minY: number; maxX: number; maxY: number } | null {
  return viewBounds(doc, 'bb')
}

// ── M2: breadboard seating (drop-to-connect, derived — never stored) ─────────

import { SpatialHash } from '../core/geometry'
import { breadboardBuses, isBreadboard } from '../parts/breadboard'

/** Seat radius: half a hole pitch (spec §7.3). */
const SEAT_RADIUS = GRID_BB / 2

/** buses resolver for buildNets — breadboards today, PartDef v2 packs later. */
export function circuitBuses(type: string): string[][] | undefined {
  return breadboardBuses(type)
}

export interface Seat {
  /** part pin ref sitting in the hole, e.g. "R1:2" */
  pin: string
  /** breadboard hole pin ref, e.g. "BB1:e12" */
  hole: string
  pos: Pt
}

/**
 * Derive implicit pin-in-hole connections: every placed non-breadboard pin
 * within SEAT_RADIUS of a breadboard hole. Grid-snapped placement makes the
 * common case an exact coordinate match.
 */
export function implicitSeats(doc: CircuitDoc): Seat[] {
  const hash = new SpatialHash<string>()
  let holes = 0
  for (const part of doc.parts) {
    if (!part.bb || !isBreadboard(part.type)) continue
    const vis = bbVisual(part.type)
    if (!vis) continue
    for (const pin of Object.keys(vis.v.pins)) {
      const p = pinWorldOf(part, pin)
      if (p) {
        hash.insert(p, `${part.id}:${pin}`)
        holes++
      }
    }
  }
  if (!holes) return []
  const seats: Seat[] = []
  for (const part of doc.parts) {
    if (!part.bb || isBreadboard(part.type)) continue
    const vis = bbVisual(part.type)
    if (!vis) continue
    for (const pin of Object.keys(vis.v.pins)) {
      const p = pinWorldOf(part, pin)
      if (!p) continue
      const hit = hash.nearest(p, SEAT_RADIUS)
      if (hit) seats.push({ pin: `${part.id}:${pin}`, hole: hit.v, pos: hit.p })
    }
  }
  return seats
}

/** Ids of parts seated on `boardId` (sticky-board moves, spec §7.3). */
export function seatedPartsOn(boardId: string, seats: Seat[]): string[] {
  const out = new Set<string>()
  for (const s of seats) {
    if (splitPinRef(s.hole).part === boardId) out.add(splitPinRef(s.pin).part)
  }
  return [...out]
}

/** Nearest hole of a specific breadboard part to a world point. */
export function holeAt(
  doc: CircuitDoc,
  boardId: string,
  wx: number,
  wy: number,
  tol: number
): { pin: string; pos: Pt } | null {
  const part = doc.parts.find((p) => p.id === boardId)
  if (!part?.bb) return null
  const vis = bbVisual(part.type)
  if (!vis) return null
  let best: { pin: string; pos: Pt; d: number } | null = null
  for (const pin of Object.keys(vis.v.pins)) {
    const p = pinWorldOf(part, pin)
    if (!p) continue
    const d = Math.hypot(p.x - wx, p.y - wy)
    if (d < tol && (!best || d < best.d)) best = { pin, pos: p, d }
  }
  return best ? { pin: best.pin, pos: best.pos } : null
}

// ── M3: ratsnest (dual-view contract, spec §8.2) ─────────────────────────────

import { buildNets, type NetModel } from '../core/nets'

export interface RatsnestSegment {
  a: Pt
  b: Pt
  /** index into the GLOBAL net model (for status counting). */
  net: number
}

/**
 * Dashed helper lines for nets that are electrically connected (globally —
 * either view, buses, seating) but not yet drawn in `view`: for each global
 * net, group its placed pins by this-view-only connectivity, then greedily
 * bridge groups between their nearest pins.
 */
export function ratsnest(doc: CircuitDoc, view: ViewId, global: NetModel): RatsnestSegment[] {
  // this-view connectivity: only this view's wires (+ physical buses; bb also
  // gets derived seating — a seated pin needs no wire)
  const viewDoc: CircuitDoc = { ...doc, wires: doc.wires.filter((w) => w.view === view) }
  const viewNets = buildNets(viewDoc, {
    busesFor: circuitBuses,
    implicit:
      view === 'bb' ? implicitSeats(doc).map((s): [string, string] => [s.pin, s.hole]) : undefined
  })

  const out: RatsnestSegment[] = []
  global.nets.forEach((pins, netIdx) => {
    if (pins.length < 2) return
    // placed, resolvable pins grouped by view-local component
    const groups = new Map<string, { pin: string; pos: Pt }[]>()
    for (const pin of pins) {
      const { part: partId } = splitPinRef(pin)
      const part = doc.parts.find((p) => p.id === partId)
      if (!part || !part[view]) continue
      const pos = pinWorldOf(part, splitPinRef(pin).pin, undefined, view)
      if (!pos) continue
      const comp = viewNets.pinToNet.has(pin) ? `n${viewNets.pinToNet.get(pin)}` : `solo:${pin}`
      if (!groups.has(comp)) groups.set(comp, [])
      groups.get(comp)!.push({ pin, pos })
    }
    if (groups.size < 2) return
    // greedy nearest-group bridging (MST-ish, fine for editor guidance)
    const remaining = [...groups.values()]
    const connected = [remaining.shift()!]
    while (remaining.length) {
      let best: { gi: number; a: Pt; b: Pt; d: number } | null = null
      remaining.forEach((group, gi) => {
        for (const g of group)
          for (const c of connected.flat()) {
            const d = Math.hypot(g.pos.x - c.pos.x, g.pos.y - c.pos.y)
            if (!best || d < best.d) best = { gi, a: c.pos, b: g.pos, d }
          }
      })
      if (!best) break
      const chosen = best as { gi: number; a: Pt; b: Pt; d: number }
      out.push({ a: chosen.a, b: chosen.b, net: netIdx })
      connected.push(remaining.splice(chosen.gi, 1)[0])
    }
  })
  return out
}
