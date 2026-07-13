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
import { netLabelPinWorld, netLabelVisualOf, snapNetLabel } from '../parts/netLabels'
import { decorateResistor, hasResistorBands } from '../parts/resistorBands'
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
import {
  composite,
  moveNetLabel,
  placePart,
  type Command,
  type WireReroute
} from '../core/commands'

export interface PartVisual {
  def: PartDef
  v: PartView
}

// Fritzing part legs are baked into the breadboard art as
// `<line id="connectorNleg" … stroke="#8C8C8C"/>` (grey). Recolor those leg
// strokes to ink so bendable legs read as black, matching the part body.
const legCache = new Map<string, string>()
function blackenLegs(svg: string): string {
  if (!svg.includes('leg"')) return svg
  const hit = legCache.get(svg)
  if (hit !== undefined) return hit
  const out = svg.replace(/<line\b[^>]*\bid="connector\d+leg"[^>]*>/gi, (m) =>
    m.replace(/stroke="#[0-9a-fA-F]{6}"/g, 'stroke="#1A1A1A"')
  )
  legCache.set(svg, out)
  return out
}

/** Visual for a part type in a view, or null while its def is still loading.
 * Schematic falls back to a generated IC-box symbol (spec §5.1). */
export function visualFor(type: string, view: ViewId): PartVisual | null {
  const def = getPart(type)
  if (!def) return null
  if (view === 'sch') return { def, v: schematicVisual(def) }
  const v = viewFor(def, 'breadboard')
  return v ? { def, v: { ...v, svg: blackenLegs(v.svg) } } : null
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
  if (!vis)
    return {
      ...placement,
      x: Math.round(placement.x / GRID_BB) * GRID_BB,
      y: Math.round(placement.y / GRID_BB) * GRID_BB
    }
  const { x, y } = snapPlacementToPinGrid(
    placement,
    firstPinLocal(type, view),
    vis.v.w,
    vis.v.h,
    GRID_BB
  )
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
    if (!part) {
      // net labels are wire-connectable in the schematic (their virtual pin is
      // "<id>:1"); resolve to the glyph's connection point.
      const label = view === 'sch' ? doc.netLabels?.find((l) => l.id === partId) : undefined
      return label ? netLabelPinWorld(label, overrides?.get(partId) ?? label.sch) : null
    }
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
export function collectFrozen(
  doc: CircuitDoc,
  ids: Set<string>,
  view: ViewId = 'bb'
): FrozenWire[] {
  const resolve = makeEndResolver(doc, undefined, view)
  const touches = (e: WireEnd): boolean => typeof e === 'string' && ids.has(splitPinRef(e).part)
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
  view: ViewId = 'bb',
  /** rigid-assembly moves (board rotation): applied to both-ends-moved wires'
   * bends instead of the delta translation. */
  transformBoth?: (p: Pt) => Pt
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
    const bends = f.both
      ? f.bends.map((b) =>
          transformBoth ? transformBoth(b) : { x: b.x + delta.x, y: b.y + delta.y }
        )
      : f.bends
    out.push({
      wireId: f.id,
      route: journeyFromPoints(buildWirePoints(s, bends, t, f.straight), f.straight)
    })
  }
  return out
}

/** bb-fixed aliases (exportImage & friends). */
export function bbWireGeometry(
  doc: CircuitDoc,
  overrides?: Map<string, Placement>
): ResolvedWire[] {
  return wireGeometry(doc, 'bb', overrides)
}
export function bbBounds(
  doc: CircuitDoc
): { minX: number; minY: number; maxX: number; maxY: number } | null {
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

// ── ERC (view-side floating-pin check; merged with core/erc net rules) ────────

import type { ErcIssue } from '../core/erc'

/**
 * Info-level floating-pin findings that need pin geometry (hence view-side).
 * Only parts that are PARTIALLY connected are reported — a fully-unwired part
 * is just not placed yet and would only add noise.
 */
export function ercFloatingPins(doc: CircuitDoc, net: NetModel, view: ViewId): ErcIssue[] {
  const out: ErcIssue[] = []
  for (const part of doc.parts) {
    const pl = part[view]
    if (!pl || isBreadboard(part.type)) continue
    const vis = visualFor(part.type, view)
    if (!vis) continue
    const floating: string[] = []
    let connected = 0
    for (const pin of Object.keys(vis.v.pins)) {
      const idx = net.pinToNet.get(`${part.id}:${pin}`)
      if (idx !== undefined && net.nets[idx].length >= 2) connected++
      else floating.push(pin)
    }
    if (connected === 0) continue
    for (const pin of floating) {
      out.push({
        id: `float:${part.id}:${pin}`,
        severity: 'info',
        message: `${part.id}.${pin} is unconnected.`,
        ref: { part: part.id, pin }
      })
    }
  }
  return out
}

// ── collision-avoidance placement (parity with the pre-rewrite editor) ────────

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function overlaps(a: Box, b: Box, gap = 0): boolean {
  return (
    a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
  )
}

/** AABBs of everything already on the canvas in this view: parts, net labels,
 * and thin boxes along wire segments (so drops don't land on top of wires). */
export function occupiedBoxes(doc: CircuitDoc, view: ViewId, exclude?: Set<string>): Box[] {
  const out: Box[] = []
  for (const part of doc.parts) {
    if (exclude?.has(part.id)) continue
    const pl = part[view]
    if (!pl) continue
    const vis = visualFor(part.type, view)
    if (!vis) continue
    out.push({ x: pl.x, y: pl.y, w: vis.v.w, h: vis.v.h })
  }
  if (view === 'sch') {
    for (const l of doc.netLabels ?? []) {
      if (exclude?.has(l.id)) continue
      const v = netLabelVisualOf(l)
      out.push({ x: l.sch.x, y: l.sch.y, w: v.w, h: v.h })
    }
  }
  for (const { pts } of wireGeometry(doc, view)) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const x = Math.min(a.x, b.x)
      const y = Math.min(a.y, b.y)
      out.push({ x, y, w: Math.abs(a.x - b.x) || 1, h: Math.abs(a.y - b.y) || 1 })
    }
  }
  return out
}

/** Grid-snapped placement for a new `type` near `preferred` that clears the
 * existing scene. Spirals outward on the major grid until a free slot is found. */
export function findFreePlacement(
  doc: CircuitDoc,
  type: string,
  view: ViewId,
  preferred: Pt,
  exclude?: Set<string>
): Placement {
  const vis = visualFor(type, view)
  const w = vis?.v.w ?? 80
  const h = vis?.v.h ?? 40
  const boxes = occupiedBoxes(doc, view, exclude)
  const base = snapBB(
    type,
    { x: Math.round(preferred.x - w / 2), y: Math.round(preferred.y - h / 2) },
    view
  )
  const step = Math.max(GRID_BB, Math.ceil(Math.max(w, h) / GRID_BB / 2) * GRID_BB)
  const gap = GRID_BB
  for (let ring = 0; ring < 60; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        const cand = { x: base.x + dx * step, y: base.y + dy * step }
        const box = { x: cand.x, y: cand.y, w, h }
        if (!boxes.some((b) => overlaps(box, b, gap))) return { ...base, x: cand.x, y: cand.y }
      }
    }
  }
  return base
}

/** A paste offset (applied to every pasted placement) that clears the scene. */
export function freePasteOffset(
  doc: CircuitDoc,
  parts: { type: string; bb?: Placement; sch?: Placement }[],
  view: ViewId,
  step = GRID_BB * 2
): Pt {
  const boxes = occupiedBoxes(doc, view)
  const items: Box[] = []
  for (const p of parts) {
    const pl = p[view]
    if (!pl) continue
    const vis = visualFor(p.type, view)
    if (!vis) continue
    items.push({ x: pl.x, y: pl.y, w: vis.v.w, h: vis.v.h })
  }
  if (!items.length) return { x: step, y: step }
  for (let k = 1; k <= 60; k++) {
    const off = { x: step * k, y: step * k }
    const moved = items.map((b) => ({ x: b.x + off.x, y: b.y + off.y, w: b.w, h: b.h }))
    if (!moved.some((m) => boxes.some((b) => overlaps(m, b, GRID_BB)))) return off
  }
  return { x: step, y: step }
}

// ── rigid rotations (shared by Canvas gestures and the Inspector) ────────────

/**
 * Rigid 90°-step rotation of a breadboard assembly (bb view): the board, its
 * seated parts, and the wires *between* seated parts all turn about the
 * board's centre, so the layout is preserved instead of the wires rerouting.
 * Grid-aligned seating means holes map to holes, so pins re-seat exactly.
 * Returns one undoable composite Command, or null if the board is unknown.
 */
export function rotateBoardAssemblyCmd(
  doc: CircuitDoc,
  boardId: string,
  seats: Seat[],
  steps = 1
): Command | null {
  const n = ((steps % 4) + 4) % 4
  if (!n) return null
  const board = doc.parts.find((p) => p.id === boardId)
  const bpl = board?.bb
  const bvis = board && visualFor(board.type, 'bb')
  if (!board || !bpl || !bvis) return null
  const c = { x: bpl.x + bvis.v.w / 2, y: bpl.y + bvis.v.h / 2 }
  // 90° CW about c (matching transformLocalPoint's rotation sense), n times.
  const rot90 = (p: Pt): Pt => ({ x: c.x - (p.y - c.y), y: c.y + (p.x - c.x) })
  const rot = (p: Pt): Pt => {
    let q = p
    for (let i = 0; i < n; i++) q = rot90(q)
    return q
  }
  const ids = [boardId, ...seatedPartsOn(boardId, seats)]
  const placements = new Map<string, Placement>()
  for (const id of ids) {
    const part = doc.parts.find((p) => p.id === id)
    const cur = part?.bb
    const vis = part && visualFor(part.type, 'bb')
    if (!part || !cur || !vis) continue
    const nr = ((((cur.rotate ?? 0) + 90 * n) % 360) + 360) % 360
    const rotate = (nr || undefined) as Placement['rotate']
    if (id === boardId) {
      placements.set(id, { ...cur, rotate })
    } else {
      const nc = rot({ x: cur.x + vis.v.w / 2, y: cur.y + vis.v.h / 2 })
      placements.set(id, { ...cur, x: nc.x - vis.v.w / 2, y: nc.y - vis.v.h / 2, rotate })
    }
  }
  const frozen = collectFrozen(doc, new Set(ids), 'bb')
  const reroutes = reroutesFor(doc, frozen, placements, { x: 0, y: 0 }, 'bb', rot)
  const cmds: Command[] = []
  let first = true
  for (const [id, pl] of placements) {
    cmds.push(placePart(id, 'bb', pl, first ? reroutes : []))
    first = false
  }
  return cmds.length ? composite(`Rotate ${boardId}`, cmds) : null
}

/**
 * Rotate a schematic net label 90° about its centre, snapping its pin back to
 * the major grid and rerouting attached wires (frozen bends). Returns an
 * undoable Command, or null if the label is unknown.
 */
export function rotateNetLabelCmd(doc: CircuitDoc, labelId: string): Command | null {
  const label = doc.netLabels?.find((l) => l.id === labelId)
  if (!label) return null
  const nr = ((((label.sch.rotate ?? 0) + 90) % 360) + 360) % 360
  const snapped = snapNetLabel(label.kind, label.name, {
    ...label.sch,
    rotate: (nr || undefined) as Placement['rotate']
  })
  const frozen = collectFrozen(doc, new Set([labelId]), 'sch')
  const reroutes = reroutesFor(doc, frozen, new Map([[labelId, snapped]]), { x: 0, y: 0 }, 'sch')
  return moveNetLabel(labelId, snapped, reroutes)
}

/**
 * Per-part art: the type-level visual, decorated with instance attrs.
 * Today that's resistor color bands following `attrs.resistance` (bb art
 * carries `band_*` ids); everything else renders the stock art.
 */
export function partArtFor(part: CircuitPart, vis: PartVisual, view: ViewId): string {
  if (view === 'bb' && part.attrs?.resistance !== undefined && hasResistorBands(vis.v.svg))
    return decorateResistor(vis.v.svg, part.attrs.resistance)
  return vis.v.svg
}
