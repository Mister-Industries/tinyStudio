/**
 * wireRouting — orthogonal auto-routing + bendpoint model for the Circuit view.
 *
 * A faithful TypeScript port of the tinySchematic wiring engine (its
 * `js/utils.js`), which replicates Fritzing's breadboard wiring behaviour
 * (BREADBOARD_AND_WIRING_TECHNICAL_SPEC.md §5). Headline behaviours:
 *
 *   • Absolute bendpoints — a wire's interior bends are fixed in world space, so
 *     when a connected part moves only the leg(s) touching that part re-anchor;
 *     the body of the wire holds still.
 *   • Orthogonal "elbow" rebuild — every segment is kept axis-aligned, with the
 *     final segment approaching its pin along the major travel axis.
 *   • Straight / diagonal mode — wires drawn with a modifier held keep their true
 *     (possibly diagonal) waypoints instead of being forced orthogonal.
 *   • Junctions — a wire end can land on the body of another wire (a free {x,y}
 *     point), joining its net.
 *
 * Geometry persists in the Wokwi `diagram.json` route format: `[from, to,
 * color?, instructions?]`. Orthogonal wires use only `h…`/`v…` moves (fully
 * Wokwi compatible); straight/diagonal wires additionally use a `d<dx>,<dy>`
 * move (a tinyStudio extension our reader understands).
 */

export type PinRef = string | { x: number; y: number }
export type Connection = [PinRef, PinRef, string?, string[]?]
export interface Pt {
  x: number
  y: number
}
/** Resolve any endpoint reference to an absolute scene point (null if missing). */
export type Resolve = (ref: PinRef) => Pt | null

const COINCIDENT = 0.5 // px tolerance for "same point"
const samePoint = (a: Pt, b: Pt): boolean =>
  Math.abs(a.x - b.x) < COINCIDENT && Math.abs(a.y - b.y) < COINCIDENT

/** True when an instruction list describes a straight (diagonal-capable) wire. */
export function isStraightRoute(instr?: string[]): boolean {
  return !!instr && instr.some((s) => s.startsWith('d'))
}

/**
 * Build an L-shaped (single-bend) orthogonal path between two points.
 * `endOnMajorAxis` forces the wire to arrive perpendicular to a pin so it docks
 * cleanly instead of grazing the part body.
 */
export function calculateOrthogonalPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  endOnMajorAxis = false
): Pt[] {
  const dx = toX - fromX
  const dy = toY - fromY
  const isWide = Math.abs(dx) > Math.abs(dy)
  const goHorizontalFirst = endOnMajorAxis ? !isWide : isWide

  if (goHorizontalFirst) {
    return [
      { x: fromX, y: fromY },
      { x: toX, y: fromY },
      { x: toX, y: toY }
    ]
  }
  return [
    { x: fromX, y: fromY },
    { x: fromX, y: toY },
    { x: toX, y: toY }
  ]
}

/** Accumulate a relative instruction list into absolute points from `start`. */
function accumulatePoints(start: Pt, instrs?: string[]): Pt[] {
  const points: Pt[] = [{ x: start.x, y: start.y }]
  let cx = start.x
  let cy = start.y
  for (const instr of instrs || []) {
    if (instr === '*') continue
    if (instr.startsWith('d')) {
      const [dx, dy] = instr.slice(1).split(',').map(Number)
      if (Number.isNaN(dx) || Number.isNaN(dy)) continue
      cx += dx
      cy += dy
    } else {
      const val = parseFloat(instr.substring(1))
      if (Number.isNaN(val)) continue
      if (instr.startsWith('v')) cy += val
      else if (instr.startsWith('h')) cx += val
      else continue
    }
    points.push({ x: cx, y: cy })
  }
  return points
}

/**
 * Interior bendpoints (absolute world coords) of a wire, derived from its stored
 * instruction list. Leading/trailing points coincident with the live source /
 * target are endpoints, not bends, so they are dropped.
 */
export function bendsFromInstructions(instr: string[] | undefined, source: Pt, target: Pt): Pt[] {
  const pts = accumulatePoints(source, instr)
  const interior = pts.slice(1)
  while (interior.length && samePoint(interior[interior.length - 1], target)) interior.pop()
  while (interior.length && samePoint(interior[0], source)) interior.shift()
  return interior.map((p) => ({ x: p.x, y: p.y }))
}

/**
 * Full rendered point list from live endpoints + fixed interior bends.
 * Orthogonal wires insert an elbow per segment (final segment along the major
 * travel axis); straight wires join waypoints directly.
 */
export function buildWirePoints(source: Pt, bends: Pt[], target: Pt, straight = false): Pt[] {
  const waypoints = [source, ...bends, target]

  if (straight) return simplifyWirePoints(waypoints.map((p) => ({ x: p.x, y: p.y })))

  const pts: Pt[] = [{ x: waypoints[0].x, y: waypoints[0].y }]
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1]
    const b = waypoints[i]
    const endOnMajorAxis = i === waypoints.length - 1
    const ortho = calculateOrthogonalPath(a.x, a.y, b.x, b.y, endOnMajorAxis)
    for (let k = 1; k < ortho.length; k++) pts.push(ortho[k])
  }
  return simplifyWirePoints(pts)
}

/** Resolve a connection's full rendered point list. `route` overrides conn[3]. */
export function getWirePoints(conn: Connection, resolve: Resolve, route?: string[]): Pt[] {
  const source = resolve(conn[0])
  const target = resolve(conn[1])
  if (!source || !target) return []
  const instr = route ?? conn[3] ?? []
  const straight = isStraightRoute(instr)
  const bends = bendsFromInstructions(instr, source, target)
  return buildWirePoints(source, bends, target, straight)
}

/**
 * Serialize an absolute point list into relative instructions. Orthogonal wires
 * emit `h…`/`v…`; straight wires emit `d<dx>,<dy>` per segment so diagonals
 * survive a save/load round-trip.
 */
export function instructionsFromPoints(points: Pt[], straight = false): string[] {
  const out: string[] = []
  const round = (v: number): number => Math.round(v * 1000) / 1000
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    if (straight && Math.abs(dx) > 0.001 && Math.abs(dy) > 0.001) {
      out.push(`d${round(dx)},${round(dy)}`)
      continue
    }
    if (Math.abs(dx) > 0.001) out.push(`h${round(dx)}`)
    if (Math.abs(dy) > 0.001) out.push(`v${round(dy)}`)
  }
  return out
}

/** Drop duplicate and collinear points so saved routes stay minimal. */
export function simplifyWirePoints(points: Pt[]): Pt[] {
  if (points.length < 3) return points

  const unique: Pt[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const prev = unique[unique.length - 1]
    const curr = points[i]
    if (Math.abs(curr.x - prev.x) > 0.001 || Math.abs(curr.y - prev.y) > 0.001) unique.push(curr)
  }
  if (unique.length < 3) return unique

  const simple: Pt[] = [unique[0]]
  for (let i = 1; i < unique.length - 1; i++) {
    const prev = simple[simple.length - 1]
    const curr = unique[i]
    const next = unique[i + 1]
    const horizontal = Math.abs(prev.y - curr.y) < 0.001 && Math.abs(curr.y - next.y) < 0.001
    const vertical = Math.abs(prev.x - curr.x) < 0.001 && Math.abs(curr.x - next.x) < 0.001
    if (!horizontal && !vertical) simple.push(curr)
  }
  simple.push(unique[unique.length - 1])
  return simple
}

/**
 * Drag a whole wire segment perpendicular to itself. `points` is the rendered
 * point list; `index` is the segment (points[index]..points[index+1]). A
 * horizontal segment moves to `newY`; a vertical one to `newX`. If an end of the
 * dragged segment is a true wire endpoint (anchored to its pin), a bendpoint is
 * inserted there instead of moving the endpoint — so dragging the middle of a
 * straight pin-to-pin wire pulls it into a "U" with two legs.
 */
export function dragSegment(
  points: Pt[],
  index: number,
  axis: 'horizontal' | 'vertical',
  newX: number,
  newY: number
): Pt[] {
  const cl = (p: Pt): Pt => ({ x: p.x, y: p.y })
  const a = points[index]
  const b = points[index + 1]
  const isFirst = index === 0
  const isLast = index + 1 === points.length - 1

  let na: Pt
  let nb: Pt
  if (axis === 'horizontal') {
    na = { x: a.x, y: newY }
    nb = { x: b.x, y: newY }
  } else {
    na = { x: newX, y: a.y }
    nb = { x: newX, y: b.y }
  }

  const head = points.slice(0, index).map(cl)
  const tail = points.slice(index + 2).map(cl)
  const mid: Pt[] = []
  if (isFirst) mid.push(cl(a)) // keep anchored source, na becomes a corner
  mid.push(na, nb)
  if (isLast) mid.push(cl(b)) // keep anchored target, nb becomes a corner
  return [...head, ...mid, ...tail]
}

/** Distance from point p to segment v→w (for wire hit-testing). */
export function distanceToSegment(p: Pt, v: Pt, w: Pt): number {
  const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y)
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)))
}

export interface WireHit {
  index: number
  segmentIndex: number
  p1: Pt
  p2: Pt
}

/**
 * The topmost wire whose body lies within `hitDist` (scaled by zoom) of (mx,my).
 * `pointsFor` resolves each connection's current rendered points (so callers can
 * apply per-view route overlays).
 */
export function getWireAt(
  mx: number,
  my: number,
  connections: Connection[],
  pointsFor: (c: Connection, i: number) => Pt[],
  zoom: number
): WireHit | null {
  const hitDist = 6 / zoom
  for (let i = connections.length - 1; i >= 0; i--) {
    const points = pointsFor(connections[i], i)
    for (let j = 0; j < points.length - 1; j++) {
      const p1 = points[j]
      const p2 = points[j + 1]
      if (distanceToSegment({ x: mx, y: my }, p1, p2) < hitDist) {
        return { index: i, segmentIndex: j, p1, p2 }
      }
    }
  }
  return null
}

/** Clamp a point onto an (axis-aligned) wire segment — used to drop junctions. */
export function clampOntoSegment(p1: Pt, p2: Pt, x: number, y: number): Pt {
  if (Math.abs(p1.x - p2.x) > 0.1) {
    return { x: Math.max(Math.min(x, Math.max(p1.x, p2.x)), Math.min(p1.x, p2.x)), y: p1.y }
  }
  return { x: p1.x, y: Math.max(Math.min(y, Math.max(p1.y, p2.y)), Math.min(p1.y, p2.y)) }
}

/** SVG points="" string for a polyline. */
export function ptsStr(points: Pt[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}
