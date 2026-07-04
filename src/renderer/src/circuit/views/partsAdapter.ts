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

/** Breadboard visual for a part type, or null while its def is still loading. */
export function bbVisual(type: string): PartVisual | null {
  const def = getPart(type)
  const v = def && viewFor(def, 'breadboard')
  return def && v ? { def, v } : null
}

/** First pin's local coordinate (the snap-by-pin alignment reference). */
export function firstPinLocal(type: string): [number, number] | undefined {
  const vis = bbVisual(type)
  if (!vis) return undefined
  const first = Object.values(vis.v.pins)[0]
  return first
}

/** Snap a bb placement so its pins land on-grid (Fritzing behavior). */
export function snapBB(type: string, placement: Placement): Placement {
  const vis = bbVisual(type)
  if (!vis) return { ...placement, x: Math.round(placement.x / GRID_BB) * GRID_BB, y: Math.round(placement.y / GRID_BB) * GRID_BB }
  const { x, y } = snapPlacementToPinGrid(placement, firstPinLocal(type), vis.v.w, vis.v.h, GRID_BB)
  return { ...placement, x, y }
}

/** World position of a part's pin in the bb view (leg-tip aware). */
export function pinWorldOf(part: CircuitPart, pin: string, placement?: Placement): Pt | null {
  const pl = placement ?? part.bb
  if (!pl) return null
  const vis = bbVisual(part.type)
  const local = vis?.v.pins[pin]
  if (!vis || !local) return null
  return pinWorld(local, pl, vis.v.w, vis.v.h, pl.legs?.[pin])
}

export type EndResolver = (end: WireEnd, seen?: Set<string>) => Pt | null

/**
 * Endpoint resolver over a doc, with optional per-part placement overrides
 * (used mid-drag so wires track the moving part before the command commits).
 * Pending v1 junctions resolve to their raw coordinate.
 */
export function makeEndResolver(
  doc: CircuitDoc,
  overrides?: Map<string, Placement>
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
    return pinWorldOf(part, pin, overrides?.get(partId) ?? part.bb)
  }
  return resolve
}

export interface ResolvedWire {
  w: CircuitWire
  pts: Pt[]
}

/** Rendered polylines for every bb wire (empty pts when unresolvable). */
export function bbWireGeometry(doc: CircuitDoc, overrides?: Map<string, Placement>): ResolvedWire[] {
  const resolve = makeEndResolver(doc, overrides)
  return doc.wires
    .filter((w) => w.view === 'bb')
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
  tol: number
): { id: string; pin: string; pos: Pt } | null {
  for (let i = doc.parts.length - 1; i >= 0; i--) {
    const part = doc.parts[i]
    if (!part.bb) continue
    const vis = bbVisual(part.type)
    if (!vis) continue
    for (const pin of Object.keys(vis.v.pins)) {
      const pos = pinWorldOf(part, pin)
      if (pos && Math.hypot(pos.x - wx, pos.y - wy) < tol) return { id: part.id, pin, pos }
    }
  }
  return null
}

/** Bounding box of everything placed in the bb view, or null when empty. */
export function bbBounds(doc: CircuitDoc): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const part of doc.parts) {
    if (!part.bb) continue
    const vis = bbVisual(part.type)
    if (!vis) continue
    minX = Math.min(minX, part.bb.x)
    minY = Math.min(minY, part.bb.y)
    maxX = Math.max(maxX, part.bb.x + vis.v.w)
    maxY = Math.max(maxY, part.bb.y + vis.v.h)
  }
  for (const { pts } of bbWireGeometry(doc)) {
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
export function collectFrozen(doc: CircuitDoc, ids: Set<string>): FrozenWire[] {
  const resolve = makeEndResolver(doc)
  const touches = (e: WireEnd): boolean =>
    typeof e === 'string' && ids.has(splitPinRef(e).part)
  const out: FrozenWire[] = []
  for (const w of doc.wires) {
    if (w.view !== 'bb') continue
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
  delta: Pt
): WireReroute[] {
  const resolve = makeEndResolver(doc, placements)
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
