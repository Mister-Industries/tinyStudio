/**
 * circuit/views/partsAdapter: geometry glue between the v2 document and the
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
import { OPERATED_SYMBOLS, SYMBOL_BY_TYPE } from '../parts/symbolLibrary'
import { netLabelPinWorld, netLabelVisualOf, snapNetLabel } from '../parts/netLabels'
import { decorateResistor, hasResistorBands } from '../parts/resistorBands'
import { pinWorld, snapPlacementToPinGrid } from '../core/geometry'
import { autoroute, type Rect, type RouteRequest } from '../core/autoroute'
import { junctionPoints } from '../core/junctions'
import { labelLayout, visibleBox } from '../parts/labels'
import {
  GRID_BB,
  GRID_SCH,
  LEADS_VERSION,
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
  pinExitPath,
  pointAtT,
  wirePoints,
  type PinDir
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

// ── leads ────────────────────────────────────────────────────────────────────
//
// A Fritzing part with bendable legs (LEDs, capacitors, a thermistor, an LDR)
// puts its connector where the leg meets the body, and draws the leg itself as
// `<line id="connectorNleg">` running on past the bottom of the art, where the
// box cuts it off. Taken as is, the pin sits on the body with a stub of lead
// hanging below it ("the pins are too high"). So for each leg with a real stub
// past its pin, the breadboard view drops the clipped leg and draws its own
// lead from the body down to a tip a whole number of grid squares further on,
// grows the box to hold it, and puts the pin at the tip: what you plug in is
// the end of the lead, and the pins stay on the grid. Parts whose pins already
// sit at the end of their leads (a resistor, a diode, a TO-92) are untouched.
// Circuits saved before this keep their parts in the same holes:
// `migrateLeads` moves each part by the change, once (doc.meta.leads).

const num = (s: string | undefined): number => (s === undefined ? NaN : parseFloat(s))
function attrOf(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)
  return m?.[1]
}

/** viewBox of an svg string, or its width/height when it has none. */
function viewBoxOf(svg: string): [number, number, number, number] | null {
  const open = /<svg\b[^>]*>/i.exec(svg)?.[0]
  if (!open) return null
  const vb = attrOf(open, 'viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0)
    return vb as [number, number, number, number]
  return null
}

const leadCache = new Map<PartView, PartView>()

/**
 * A breadboard view with its Fritzing legs turned into leads that end on their
 * pins (see above). Returns the view unchanged when no leg needs it.
 */
export function withLeads(v: PartView): PartView {
  const hit = leadCache.get(v)
  if (hit) return hit
  const out = computeLeads(v)
  leadCache.set(v, out)
  return out
}

function computeLeads(v: PartView): PartView {
  if (!v.svg.includes('leg"')) return v
  const vb = viewBoxOf(v.svg)
  if (!vb) return v
  const [vx, vy, vw, vh] = vb
  const sx = v.w / vw
  const sy = v.h / vh
  const pins = Object.entries(v.pins)
  // pin positions in the drawing's own units
  const unitsOf = ([px, py]: [number, number]): [number, number] => [px / sx + vx, py / sy + vy]

  interface Lead {
    tag: string
    pin: string
    from: [number, number] // units
    to: [number, number] // units
    stroke: string
    width: number
  }
  const leads: Lead[] = []
  const legRe = /<line\b[^>]*\bid="connector\d+leg"[^>]*?(?:\/>|>\s*<\/line>)/gi
  for (const m of v.svg.matchAll(legRe)) {
    const tag = m[0]
    const x1 = num(attrOf(tag, 'x1'))
    const y1 = num(attrOf(tag, 'y1'))
    const x2 = num(attrOf(tag, 'x2'))
    const y2 = num(attrOf(tag, 'y2'))
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue
    // the leg's direction, squared up to an axis so the tip stays on the grid
    const horiz = Math.abs(x2 - x1) > Math.abs(y2 - y1)
    const d: [number, number] = horiz ? [Math.sign(x2 - x1), 0] : [0, Math.sign(y2 - y1)]
    if (!d[0] && !d[1]) continue
    // only a leg that leaves the part: an axial part (a resistor, a diode)
    // draws short leg stubs pointing back in from its ends, where its pins
    // already are
    const cx = vx + vw / 2
    const cy = vy + vh / 2
    if ((x2 - cx) * d[0] + (y2 - cy) * d[1] <= 0) continue
    // its pin: in line with the leg, at or just before its start
    let best: { pin: string; u: [number, number]; score: number } | null = null
    for (const [pin, pos] of pins) {
      const u = unitsOf(pos)
      const lateral = Math.abs(horiz ? u[1] - y1 : u[0] - x1)
      const along = (x1 - u[0]) * d[0] + (y1 - u[1]) * d[1]
      if (lateral > 1.5 || along < -1.5 || along > 20) continue
      const score = lateral + Math.abs(along)
      if (!best || score < best.score) best = { pin, u, score }
    }
    if (!best) continue
    // how much lead shows past the pin: to the leg's end, or the box edge
    const legLen = Math.hypot(x2 - x1, y2 - y1)
    const toEdge = d[0] > 0 ? vx + vw - x1 : d[0] < 0 ? x1 - vx : d[1] > 0 ? vy + vh - y1 : y1 - vy
    const end: [number, number] = [
      x1 + d[0] * Math.min(legLen, Math.max(0, toEdge)),
      y1 + d[1] * Math.min(legLen, Math.max(0, toEdge))
    ]
    const scale = horiz ? sx : sy
    const stubPx = ((end[0] - best.u[0]) * d[0] + (end[1] - best.u[1]) * d[1]) * scale
    // the pin is already at (or within a hair of) the end of what's drawn: a
    // TO-92's legs, the 7805's, the piezo's
    if (stubPx < 3) continue
    const leadPx = Math.max(1, Math.ceil((stubPx - 1) / GRID_BB)) * GRID_BB
    const leadU = leadPx / scale
    leads.push({
      tag,
      pin: best.pin,
      from: best.u,
      to: [best.u[0] + d[0] * leadU, best.u[1] + d[1] * leadU],
      stroke: attrOf(tag, 'stroke') ?? '#8C8C8C',
      width: num(attrOf(tag, 'stroke-width')) || 1 / Math.min(sx, sy)
    })
  }
  if (!leads.length) return v

  // grow the drawing to hold the tips, then size the box to match
  let [x0, y0, x1, y1] = [vx, vy, vx + vw, vy + vh]
  for (const l of leads) {
    const r = l.width / 2
    x0 = Math.min(x0, l.to[0] - r)
    y0 = Math.min(y0, l.to[1] - r)
    x1 = Math.max(x1, l.to[0] + r)
    y1 = Math.max(y1, l.to[1] + r)
  }
  const r4 = (n: number): number => Math.round(n * 1e4) / 1e4
  const r2 = (n: number): number => Math.round(n * 100) / 100
  // drawn first, so the body covers where the lead leaves it
  const drawn = leads
    .map(
      (l) =>
        `<line x1="${r4(l.from[0])}" y1="${r4(l.from[1])}" x2="${r4(l.to[0])}" y2="${r4(l.to[1])}" ` +
        `stroke="${l.stroke}" stroke-width="${r4(l.width)}" stroke-linecap="round" fill="none"/>`
    )
    .join('')
  let svg = v.svg
  for (const l of leads) svg = svg.replace(l.tag, '')
  svg = svg.replace(/<svg\b[^>]*>/i, (open) => {
    const sized = /\sviewBox\s*=/i.test(open)
      ? open.replace(
          /viewBox\s*=\s*"[^"]*"/i,
          `viewBox="${r4(x0)} ${r4(y0)} ${r4(x1 - x0)} ${r4(y1 - y0)}"`
        )
      : open
    return `${sized}${drawn}`
  })
  const tipOf = new Map(leads.map((l) => [l.pin, l.to]))
  const newPins: Record<string, [number, number]> = {}
  for (const [pin, pos] of pins) {
    const u = tipOf.get(pin) ?? unitsOf(pos)
    newPins[pin] = [r2((u[0] - x0) * sx), r2((u[1] - y0) * sy)]
  }
  return { ...v, svg, w: r2((x1 - x0) * sx), h: r2((y1 - y0) * sy), pins: newPins }
}

/** Visual for a part type in a view, or null while its def is still loading.
 * Schematic falls back to a generated IC-box symbol (spec §5.1). */
export function visualFor(type: string, view: ViewId): PartVisual | null {
  const def = getPart(type)
  if (!def) return null
  if (view === 'sch') return { def, v: schematicVisual(def) }
  const v = viewFor(def, 'breadboard')
  return v ? { def, v: leadsView(v) } : null
}

const shownCache = new Map<PartView, PartView>()
/** The breadboard art as drawn: leads to the pins, other legs in ink. */
function leadsView(v: PartView): PartView {
  const hit = shownCache.get(v)
  if (hit) return hit
  const led = withLeads(v)
  const out = { ...led, svg: blackenLegs(led.svg) }
  shownCache.set(v, out)
  return out
}

/**
 * Circuits saved before parts had leads (doc.meta.leads unset) placed each
 * part by its old box, with its pins on the body. Move every part whose pins
 * have since moved to the ends of its leads so those pins land where they did,
 * in the same holes, and mark the doc. Returns the moves (empty when there's
 * nothing to do) and whether every part's definition was available to check.
 */
export function leadMigration(doc: CircuitDoc): {
  moves: { id: string; placement: Placement }[]
  complete: boolean
} {
  const moves: { id: string; placement: Placement }[] = []
  // already current: moving its parts again would push them off their holes
  if ((doc.meta?.leads ?? 0) >= LEADS_VERSION) return { moves, complete: true }
  let complete = true
  for (const part of doc.parts) {
    const pl = part.bb
    if (!pl) continue
    const def = getPart(part.type)
    if (!def) {
      complete = false
      continue
    }
    const raw = viewFor(def, 'breadboard')
    if (!raw) continue
    const now = withLeads(raw)
    if (now === raw) continue
    const pin = Object.keys(raw.pins)[0]
    if (!pin) continue
    const leg = pl.legs?.[pin]
    const was = pinWorld(raw.pins[pin], pl, raw.w, raw.h, leg)
    const is = pinWorld(now.pins[pin], pl, now.w, now.h, leg)
    const dx = Math.round((was.x - is.x) * 1e4) / 1e4
    const dy = Math.round((was.y - is.y) * 1e4) / 1e4
    if (dx || dy) moves.push({ id: part.id, placement: { ...pl, x: pl.x + dx, y: pl.y + dy } })
  }
  return { moves, complete }
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

/** Snap a placement so its PINS land on the 9.6 px major grid (both views:
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

const TURN: Record<PinDir, PinDir> = { l: 'u', u: 'r', r: 'd', d: 'l' }

/**
 * Which way a pin's lead leaves its symbol, after the placement's flip and
 * rotation: a pin on the body's left edge points left, and so on. Null for a
 * pin that isn't on an edge (a breadboard hole, an odd authored symbol).
 */
export function pinDirOf(
  part: CircuitPart,
  pin: string,
  pl: Placement,
  view: ViewId
): PinDir | null {
  const vis = visualFor(part.type, view)
  return vis ? dirOnVisual(vis.v, pin, pl) : null
}

function dirOnVisual(v: PartView, pin: string, pl: Placement): PinDir | null {
  const at = v.pins[pin]
  if (!at) return null
  const [x, y] = at
  const e = 0.5
  let dir: PinDir | null =
    x <= e ? 'l' : x >= v.w - e ? 'r' : y <= e ? 'u' : y >= v.h - e ? 'd' : null
  if (!dir) return null
  if (pl.flip && (dir === 'l' || dir === 'r')) dir = dir === 'l' ? 'r' : 'l'
  for (let r = pl.rotate ?? 0; r > 0; r -= 90) dir = TURN[dir]
  return dir
}

/**
 * A schematic wire with no stored route is laid out automatically, leaving
 * each pin outward (core/routing pinExitPath). It stays automatic, following
 * its parts as they move, until someone reshapes it.
 */
export function isAutoRouted(w: CircuitWire): boolean {
  return w.view === 'sch' && !w.route?.length
}

/** Pin direction of a schematic wire end: a part pin or a net label's pin. */
function schEndDir(
  doc: CircuitDoc,
  end: WireEnd,
  overrides?: Map<string, Placement>
): PinDir | null {
  if (typeof end !== 'string') return null
  const { part: id, pin } = splitPinRef(end)
  const part = doc.parts.find((p) => p.id === id)
  if (part) {
    const pl = overrides?.get(id) ?? part.sch
    return pl ? pinDirOf(part, pin, pl, 'sch') : null
  }
  const label = doc.netLabels?.find((l) => l.id === id)
  if (!label) return null
  return dirOnVisual(netLabelVisualOf(label), pin, overrides?.get(id) ?? label.sch)
}

const endPartId = (end: WireEnd): string | null =>
  typeof end === 'string' ? splitPinRef(end).part : null

function routedPoints(
  doc: CircuitDoc,
  w: CircuitWire,
  s: Pt,
  t: Pt,
  overrides?: Map<string, Placement>
): Pt[] {
  if (!isAutoRouted(w)) return wirePoints(s, t, w.route)
  // mid-drag, wires on parts that aren't moving keep their full route; the
  // ones on moving parts take the quick pin-exit route until the drop
  const moving = (end: WireEnd): boolean => {
    const id = endPartId(end)
    return !!id && !!overrides?.has(id)
  }
  if (!moving(w.from) && !moving(w.to)) {
    const full = schematicRoutes(doc).get(w.id)
    if (full) return full
  }
  return pinExitPath(
    s,
    schEndDir(doc, w.from, overrides),
    t,
    schEndDir(doc, w.to, overrides),
    GRID_BB
  )
}

/**
 * Which schematic wires form one conductor: wires that share a pin, a net
 * label pin or a junction host. Returns a lookup from wire id to a net key.
 */
function wireNets(doc: CircuitDoc): (wireId: string) => string {
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let r = k
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  const union = (a: string, b: string): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const w of doc.wires) {
    if (w.view !== 'sch') continue
    union(`w:${w.id}`, typeof w.from === 'string' ? w.from : `w:${w.from.wire}`)
    union(`w:${w.id}`, typeof w.to === 'string' ? w.to : `w:${w.to.wire}`)
  }
  return (id) => find(`w:${id}`)
}

/** Solder dots for a schematic: every point where three or more conductors meet. */
export function schematicJunctions(doc: CircuitDoc, geom: ResolvedWire[]): Pt[] {
  const net = wireNets(doc)
  const resolve = makeEndResolver(doc, undefined, 'sch')
  const pins: Pt[] = []
  for (const { w } of geom)
    for (const end of [w.from, w.to]) {
      if (typeof end !== 'string') continue
      const p = resolve(end)
      if (p) pins.push(p)
    }
  return junctionPoints(
    geom.filter((g) => g.pts.length >= 2).map((g) => ({ net: net(g.w.id), pts: g.pts })),
    pins,
    GRID_SCH
  )
}

const routeCache = new WeakMap<CircuitDoc, Map<string, Pt[]>>()

/**
 * What a schematic wire or tag must keep clear of: part bodies and net labels
 * (walls) and the refdes/value text beside each part (soft: avoid, but can be
 * crossed). `complete` is false while some part's art hasn't loaded yet.
 */
export function schematicObstacles(doc: CircuitDoc): {
  walls: Rect[]
  soft: Rect[]
  complete: boolean
} {
  let complete = true
  const walls: Rect[] = []
  const soft: Rect[] = []
  for (const part of doc.parts) {
    const pl = part.sch
    if (!pl || isHoleBoard(part.type)) continue
    const vis = visualFor(part.type, 'sch')
    if (!vis) {
      complete = false
      continue
    }
    const box = visibleBox(vis.v.w, vis.v.h, pl.rotate)
    walls.push({ x: pl.x + box.left, y: pl.y + box.top, w: box.w, h: box.h })
    // keep wires off the refdes and value text where the canvas draws them
    const lay = labelLayout(vis.v.w, vis.v.h, vis.v.pins, pl.rotate)
    const off = pl.labelOffset ?? [0, 0]
    const ref = String(part.attrs?.label ?? part.id)
    soft.push({
      x: pl.x + lay.refdes[0] + off[0],
      y: pl.y + lay.refdes[1] + off[1],
      w: ref.length * 6,
      h: 10
    })
    soft.push({ x: pl.x + lay.value[0] + off[0], y: pl.y + lay.value[1] + off[1], w: 40, h: 10 })
  }
  for (const label of doc.netLabels ?? []) {
    const v = netLabelVisualOf(label)
    const box = visibleBox(v.w, v.h, label.sch.rotate)
    walls.push({ x: label.sch.x + box.left, y: label.sch.y + box.top, w: box.w, h: box.h })
  }

  return { walls, soft, complete }
}

/** Part bodies a wire being drawn should go around in this view, and the
 * text it should rather not cross. */
export function drawingWalls(doc: CircuitDoc, view: ViewId): { walls: Rect[]; soft: Rect[] } {
  if (view === 'sch') {
    const o = schematicObstacles(doc)
    return { walls: o.walls, soft: o.soft }
  }
  const out: Rect[] = []
  for (const part of doc.parts) {
    const pl = part.bb
    // wires run over breadboards and the tinyProto; that is what they are for
    if (!pl || isHoleBoard(part.type)) continue
    const vis = visualFor(part.type, 'bb')
    if (!vis) continue
    const box = visibleBox(vis.v.w, vis.v.h, pl.rotate)
    out.push({ x: pl.x + box.left, y: pl.y + box.top, w: box.w, h: box.h })
  }
  return { walls: out, soft: [] }
}

/**
 * Full obstacle-aware routes (core/autoroute) for every automatic schematic
 * wire between two pins, computed once per document revision.
 */
export function schematicRoutes(doc: CircuitDoc): Map<string, Pt[]> {
  const hit = routeCache.get(doc)
  if (hit) return hit
  const { walls, soft, complete } = schematicObstacles(doc)

  // wires sharing a pin are one conductor and may share a track
  const find = wireNets(doc)
  const sch = doc.wires.filter((w) => w.view === 'sch')

  const resolve = makeEndResolver(doc, undefined, 'sch')
  const reqs: RouteRequest[] = []
  for (const w of sch) {
    if (!isAutoRouted(w) || typeof w.from !== 'string' || typeof w.to !== 'string') continue
    const s = resolve(w.from)
    const t = resolve(w.to)
    if (!s || !t) continue
    reqs.push({
      id: w.id,
      net: find(w.id),
      s,
      sDir: schEndDir(doc, w.from),
      t,
      tDir: schEndDir(doc, w.to)
    })
  }
  const routes = autoroute(reqs, { grid: GRID_SCH, walls, soft, stub: GRID_BB })
  if (complete) routeCache.set(doc, routes)
  return routes
}

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
      return pointAtT(routedPoints(doc, host, s, t, overrides), end.t)
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
      return { w, pts: s && t ? routedPoints(doc, w, s, t, overrides) : [] }
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
  /** Both endpoints sit on moved parts; bends translate with the move. */
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
    // auto-routed wires re-route live from the moved pins; nothing to freeze
    if (w.view !== view || isAutoRouted(w)) continue
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

// ── M2: breadboard seating (drop-to-connect, derived, never stored) ─────────

import { SpatialHash } from '../core/geometry'
import { breadboardBuses, isHoleBoard } from '../parts/breadboard'
import { headerBuses, isTinyHeaderBoard } from '../parts/boardSymbols'

/** Seat radius: half a hole pitch (spec §7.3). */
const SEAT_RADIUS = GRID_BB / 2

/** buses resolver for buildNets: a part's own `buses` (tinyProto's power
 * rails, from its part.json), else the generated breadboards'. */
export function circuitBuses(type: string): string[][] | undefined {
  const def = getPart(type)
  const own = def?.buses ?? breadboardBuses(type)
  if (!def || !isTinyHeaderBoard(type)) return own
  // a tinyStudio board's repeated GND / 3V3 header pins are one net
  const pins = Object.keys(def.views.breadboard?.pins ?? {})
  const header = headerBuses(pins)
  return header.length ? [...(own ?? []), ...header] : own
}

export interface Seat {
  /** part pin ref sitting in the hole, e.g. "R1:2" */
  pin: string
  /** breadboard hole pin ref, e.g. "BB1:e12" */
  hole: string
  pos: Pt
}

/**
 * Derive implicit pin-in-hole connections: a part seats as a rigid body;
 * ALL of its pins must land within SEAT_RADIUS of a breadboard hole at the
 * part's current placement/rotation, or NONE of them seat (Fritzing rule:
 * a component either fully plugs in or it's just resting on top). This
 * avoids a part with one pin near a hole and another dangling off-grid
 * reporting a single spurious connection while silently leaving the rest
 * of its pins unconnected. Grid-snapped placement makes the common case an
 * exact coordinate match.
 */
export function implicitSeats(doc: CircuitDoc): Seat[] {
  const hash = new SpatialHash<string>()
  let holes = 0
  for (const part of doc.parts) {
    if (!part.bb || !isHoleBoard(part.type)) continue
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
    if (!part.bb || isHoleBoard(part.type)) continue
    const vis = bbVisual(part.type)
    const pins = vis ? Object.keys(vis.v.pins) : []
    if (!pins.length) continue
    const candidates: Seat[] = []
    let allSeated = true
    for (const pin of pins) {
      const p = pinWorldOf(part, pin)
      const hit = p ? hash.nearest(p, SEAT_RADIUS) : null
      if (!hit) {
        allSeated = false
        break
      }
      candidates.push({ pin: `${part.id}:${pin}`, hole: hit.v, pos: hit.p })
    }
    if (allSeated) seats.push(...candidates)
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
 * Dashed helper lines for nets that are electrically connected (globally:
 * either view, buses, seating) but not yet drawn in `view`: for each global
 * net, group its placed pins by this-view-only connectivity, then greedily
 * bridge groups between their nearest pins.
 */
export function ratsnest(doc: CircuitDoc, view: ViewId, global: NetModel): RatsnestSegment[] {
  // this-view connectivity: only this view's wires (+ physical buses; bb also
  // gets derived seating; a seated pin needs no wire)
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
      // a hole board has no schematic symbol: its holes aren't pins to wire there
      if (view === 'sch' && isHoleBoard(part.type)) continue
      const pos = pinWorldOf(part, splitPinRef(pin).pin, undefined, view)
      if (!pos) continue
      // a pin with no wire in this view still rides its part's bus (a header's
      // second GND pin is the first one)
      let local = viewNets.pinToNet.get(pin)
      if (local === undefined) {
        const name = splitPinRef(pin).pin
        for (const group of circuitBuses(part.type) ?? []) {
          if (!group.includes(name)) continue
          const sib = group.find((n) => viewNets.pinToNet.has(`${partId}:${n}`))
          if (sib) local = viewNets.pinToNet.get(`${partId}:${sib}`)
        }
      }
      const comp = local !== undefined ? `n${local}` : `solo:${pin}`
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
 * Only parts that are PARTIALLY connected are reported; a fully-unwired part
 * is just not placed yet and would only add noise.
 */
export function ercFloatingPins(doc: CircuitDoc, net: NetModel, view: ViewId): ErcIssue[] {
  const out: ErcIssue[] = []
  for (const part of doc.parts) {
    const pl = part[view]
    if (!pl || isHoleBoard(part.type)) continue
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
    // the refdes and value text beside each part
    for (const t of schematicObstacles(doc).soft) out.push(t)
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

/**
 * Where a part should land when the editor places it for the user rather
 * than the user dropping it: the cross-view auto-placement anchor.
 *
 * Parts added in one view are placed in BOTH views (spec §10.2: the two views
 * share one electrical model, so a part that exists in the breadboard should
 * exist in the schematic too). For the view the user isn't looking at we have
 * no cursor to place near, so we anchor just right of whatever is already
 * there and let findFreePlacement's ring search resolve collisions. Empty
 * views start at a fixed origin so the first few parts line up.
 */
export function autoPlacementFor(
  doc: CircuitDoc,
  type: string,
  view: ViewId,
  exclude?: Set<string>
): Placement {
  const b = viewBounds(doc, view)
  const vis = visualFor(type, view)
  const w = vis?.v.w ?? 80
  const h = vis?.v.h ?? 40
  const preferred = b
    ? { x: b.maxX + GRID_BB * 3 + w / 2, y: b.minY + h / 2 }
    : { x: GRID_BB * 12, y: GRID_BB * 12 }
  return findFreePlacement(doc, type, view, preferred, exclude)
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
 * One rotate step, in degrees: counter-clockwise (CSS rotation is clockwise
 * positive, so -90 is +270). CCW is the drafting convention, and it means a
 * part stood upright reads left-to-right in one click instead of three.
 */
export const ROTATE_STEP = 270

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
  // 90° CW about c (matching transformLocalPoint's rotation sense), n times;
  // callers pass n = 3 for one counter-clockwise step (ROTATE_STEP).
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
  const nr = ((((label.sch.rotate ?? 0) + ROTATE_STEP) % 360) + 360) % 360
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
/** The slide switch art's knob (left of its track) and where it goes when on. */
const SLIDE_KNOB_OPEN =
  /<rect x="16" y="10" width="13" height="10" rx="2" fill="#cfd6ff"\s*(?:\/>|><\/rect>)/
const SLIDE_KNOB_CLOSED = '<rect x="31" y="10" width="13" height="10" rx="2" fill="#cfd6ff"/>'

/** The pushbutton art's housing ring; everything drawn after it is the cap. */
const BUTTON_RING = /<ellipse[^>]*fill="#DFDFDF"[^>]*cy="15\.211"[^>]*(?:\/>|><\/ellipse>)/

export function partArtFor(part: CircuitPart, vis: PartVisual, view: ViewId): string {
  if (view === 'bb' && part.attrs?.resistance !== undefined && hasResistorBands(vis.v.svg))
    return decorateResistor(vis.v.svg, part.attrs.resistance)
  // Simulate: a closed switch or a pressed button is drawn closed
  const closed = part.attrs?.closed === true || part.attrs?.closed === 'true'
  if (!closed) return vis.v.svg
  if (view === 'sch') {
    const op = OPERATED_SYMBOLS[SYMBOL_BY_TYPE[part.type] ?? '']
    if (op && vis.v.svg.includes(op.open)) return vis.v.svg.replace(op.open, op.closed)
  }
  // the breadboard slide switch: its knob slides from one end of the track
  // to the other
  if (view === 'bb' && SLIDE_KNOB_OPEN.test(vis.v.svg))
    return vis.v.svg.replace(SLIDE_KNOB_OPEN, SLIDE_KNOB_CLOSED)
  // the breadboard pushbutton: its cap (drawn last, after the housing's top
  // ring) sinks into the housing
  if (view === 'bb') {
    const ring = BUTTON_RING.exec(vis.v.svg)
    const end = vis.v.svg.lastIndexOf('</g></svg>')
    if (ring && end > ring.index) {
      const after = ring.index + ring[0].length
      // clipped to the housing ring's opening (everything above its centre,
      // plus the ellipse itself), so the cap sinks into the hole instead of
      // sliding over the housing
      const clip = `pb-${part.id.replace(/[^\w-]/g, '_')}`
      return (
        vis.v.svg.slice(0, after) +
        `<clipPath id="${clip}"><rect x="-10" y="-10" width="80" height="25.211"/>` +
        '<ellipse cx="25.014" cy="15.211" rx="17.54" ry="7.316"/></clipPath>' +
        `<g clip-path="url(#${clip})"><g transform="translate(0 2.6)">` +
        vis.v.svg.slice(after, end) +
        '</g></g>' +
        vis.v.svg.slice(end)
      )
    }
  }
  return vis.v.svg
}
