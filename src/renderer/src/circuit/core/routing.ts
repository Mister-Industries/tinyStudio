/**
 * circuit/core/routing — orthogonal wire routing + bendpoint model.
 *
 * Port of `lib/wireRouting.ts` (the tinySchematic/Fritzing-style engine) into
 * the v2 core, with one behavioral fix and one extension:
 *
 *  FIX (B2): Wokwi's "*" journey instruction is honored. Instructions before
 *  "*" are anchored at the SOURCE pin; instructions after "*" are applied in
 *  REVERSE from the TARGET pin; the remaining gap is auto-completed with an
 *  orthogonal elbow — exactly the semantics documented at
 *  https://docs.wokwi.com/diagram-format#wire-placement-mini-language.
 *  On serialization we always emit source-anchored lists (valid Wokwi).
 *
 *  EXT: `d<dx>,<dy>` diagonal moves (tinyStudio straight-mode extension) are
 *  decoded/encoded as before; they never co-exist with "*".
 *
 * Pure TS. No document knowledge beyond Pt — endpoints are resolved by callers.
 */

import type { Pt } from './model'

const COINCIDENT = 0.5
const samePoint = (a: Pt, b: Pt): boolean =>
  Math.abs(a.x - b.x) < COINCIDENT && Math.abs(a.y - b.y) < COINCIDENT

/** True when an instruction list describes a straight (diagonal-capable) wire. */
export function isStraightRoute(instr?: string[]): boolean {
  return !!instr && instr.some((s) => s.startsWith('d'))
}

/** L-shaped orthogonal path; `endOnMajorAxis` docks the wire into the pin. */
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

/** Apply one h/v/d instruction to a cursor; returns null for invalid. */
function step(cur: Pt, instr: string): Pt | null {
  if (instr.startsWith('d')) {
    const [dx, dy] = instr.slice(1).split(',').map(Number)
    if (Number.isNaN(dx) || Number.isNaN(dy)) return null
    return { x: cur.x + dx, y: cur.y + dy }
  }
  const val = parseFloat(instr.substring(1))
  if (Number.isNaN(val)) return null
  if (instr.startsWith('v')) return { x: cur.x, y: cur.y + val }
  if (instr.startsWith('h')) return { x: cur.x + val, y: cur.y }
  return null
}

/**
 * Decode a journey (possibly containing "*") into the full waypoint list
 * between live `source` and `target` points — Wokwi semantics (B2 fix):
 *   pre-"*"  → walked forward from source
 *   post-"*" → walked in reverse from target
 *   gap      → auto-completed orthogonally
 * Journeys without "*" behave exactly like the old decoder.
 */
export function decodeJourney(source: Pt, target: Pt, instr?: string[]): Pt[] {
  const list = instr ?? []
  const star = list.indexOf('*')
  const srcInstr = star === -1 ? list : list.slice(0, star)
  const tgtInstr = star === -1 ? [] : list.slice(star + 1)

  const fromSrc: Pt[] = [{ x: source.x, y: source.y }]
  for (const s of srcInstr) {
    const n = step(fromSrc[fromSrc.length - 1], s)
    if (n) fromSrc.push(n)
  }

  // Target-side instructions are listed source→target in the file, but are
  // applied starting at the target walking backward, then the walked chain is
  // reversed so the polyline reads source→target.
  const fromTgt: Pt[] = [{ x: target.x, y: target.y }]
  for (let i = tgtInstr.length - 1; i >= 0; i--) {
    // walking backward = inverse move
    const s = tgtInstr[i]
    const inv = s.startsWith('h')
      ? `h${-parseFloat(s.slice(1))}`
      : s.startsWith('v')
        ? `v${-parseFloat(s.slice(1))}`
        : null
    if (!inv) continue
    const n = step(fromTgt[fromTgt.length - 1], inv)
    if (n) fromTgt.push(n)
  }
  fromTgt.reverse()

  const a = fromSrc[fromSrc.length - 1]
  const b = fromTgt[0]
  const mid: Pt[] = samePoint(a, b) ? [] : calculateOrthogonalPath(a.x, a.y, b.x, b.y, false).slice(1, -1)
  return simplifyWirePoints([...fromSrc, ...mid, ...fromTgt])
}

/**
 * Interior bendpoints (absolute) of a wire from its stored journey; points
 * coincident with the live source/target are endpoints, not bends.
 */
export function bendsFromJourney(instr: string[] | undefined, source: Pt, target: Pt): Pt[] {
  const pts = decodeJourney(source, target, instr)
  const interior = pts.slice(1)
  while (interior.length && samePoint(interior[interior.length - 1], target)) interior.pop()
  while (interior.length && samePoint(interior[0], source)) interior.shift()
  return interior.map((p) => ({ x: p.x, y: p.y }))
}

/**
 * Full rendered point list from live endpoints + fixed interior bends.
 * Orthogonal wires insert an elbow per segment (final segment on the major
 * travel axis); straight wires join waypoints directly.
 */
export function buildWirePoints(source: Pt, bends: Pt[], target: Pt, straight = false): Pt[] {
  const waypoints = [source, ...bends, target]
  if (straight) return simplifyWirePoints(waypoints.map((p) => ({ x: p.x, y: p.y })))
  const pts: Pt[] = [{ x: waypoints[0].x, y: waypoints[0].y }]
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1]
    const b = waypoints[i]
    const ortho = calculateOrthogonalPath(a.x, a.y, b.x, b.y, i === waypoints.length - 1)
    for (let k = 1; k < ortho.length; k++) pts.push(ortho[k])
  }
  return simplifyWirePoints(pts)
}

/** Rendered polyline for a wire given resolved endpoints and its journey. */
export function wirePoints(source: Pt, target: Pt, instr?: string[]): Pt[] {
  const straight = isStraightRoute(instr)
  if (straight) {
    const bends = bendsFromJourney(instr, source, target)
    return buildWirePoints(source, bends, target, true)
  }
  return decodeJourney(source, target, instr)
}

/**
 * Serialize an absolute point list into a source-anchored journey.
 * Orthogonal → h/v; straight mode → d moves for diagonal segments.
 */
export function journeyFromPoints(points: Pt[], straight = false): string[] {
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
    if (Math.abs(points[i].x - prev.x) > 0.001 || Math.abs(points[i].y - prev.y) > 0.001)
      unique.push(points[i])
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
 * Drag a whole segment perpendicular to itself; anchored endpoints grow a new
 * corner instead of moving (pulls a straight wire into a "U").
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
  if (isFirst) mid.push(cl(a))
  mid.push(na, nb)
  if (isLast) mid.push(cl(b))
  return [...head, ...mid, ...tail]
}

/** Keep neighbours orthogonal while dragging an interior vertex. */
export function vertexDrag(orig: Pt[], index: number, x: number, y: number): Pt[] {
  const points = orig.map((p) => ({ x: p.x, y: p.y }))
  points[index].x = x
  points[index].y = y
  if (index > 0) {
    if (Math.abs(points[index - 1].y - points[index].y) < Math.abs(points[index - 1].x - points[index].x)) {
      if (index - 1 > 0) points[index - 1].y = points[index].y
      else points[index].y = points[index - 1].y
    } else {
      if (index - 1 > 0) points[index - 1].x = points[index].x
      else points[index].x = points[index - 1].x
    }
  }
  if (index < points.length - 1) {
    if (Math.abs(points[index + 1].y - points[index].y) < Math.abs(points[index + 1].x - points[index].x)) {
      if (index + 1 < points.length - 1) points[index + 1].y = points[index].y
      else points[index].y = points[index + 1].y
    } else {
      if (index + 1 < points.length - 1) points[index + 1].x = points[index].x
      else points[index].x = points[index + 1].x
    }
  }
  return points
}

// ── hit testing / junctions ──────────────────────────────────────────────────

export function distanceToSegment(p: Pt, v: Pt, w: Pt): number {
  const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y)
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)))
}

/** Clamp a point onto an axis-aligned segment (junction drops). */
export function clampOntoSegment(p1: Pt, p2: Pt, x: number, y: number): Pt {
  if (Math.abs(p1.x - p2.x) > 0.1) {
    return { x: Math.max(Math.min(x, Math.max(p1.x, p2.x)), Math.min(p1.x, p2.x)), y: p1.y }
  }
  return { x: p1.x, y: Math.max(Math.min(y, Math.max(p1.y, p2.y)), Math.min(p1.y, p2.y)) }
}

/** Total polyline length. */
export function polylineLength(pts: Pt[]): number {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return l
}

/** Point at parametric position t (0..1 by length) along a polyline. */
export function pointAtT(pts: Pt[], t: number): Pt {
  if (pts.length === 0) return { x: 0, y: 0 }
  if (pts.length === 1 || t <= 0) return { ...pts[0] }
  const total = polylineLength(pts)
  if (total === 0 || t >= 1) return { ...pts[pts.length - 1] }
  let remain = t * total
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (remain <= seg) {
      const f = seg === 0 ? 0 : remain / seg
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f
      }
    }
    remain -= seg
  }
  return { ...pts[pts.length - 1] }
}

/** Parametric position (0..1 by length) of the point on the polyline nearest to p. */
export function tAtPoint(pts: Pt[], p: Pt): number {
  const total = polylineLength(pts)
  if (total === 0) return 0
  let best = 0
  let bestDist = Infinity
  let walked = 0
  for (let i = 1; i < pts.length; i++) {
    const v = pts[i - 1]
    const w = pts[i]
    const seg = Math.hypot(w.x - v.x, w.y - v.y)
    const l2 = seg * seg
    let t = l2 === 0 ? 0 : ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2
    t = Math.max(0, Math.min(1, t))
    const q = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) }
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    if (d < bestDist) {
      bestDist = d
      best = (walked + t * seg) / total
    }
    walked += seg
  }
  return best
}

export interface WireHit {
  id: string
  segmentIndex: number
  p1: Pt
  p2: Pt
}

/** Topmost wire whose body lies within hitDist (zoom-scaled) of (mx,my). */
export function hitWire(
  mx: number,
  my: number,
  wires: { id: string; points: Pt[] }[],
  zoom: number
): WireHit | null {
  const hitDist = 6 / zoom
  for (let i = wires.length - 1; i >= 0; i--) {
    const { id, points } = wires[i]
    for (let j = 0; j < points.length - 1; j++) {
      if (distanceToSegment({ x: mx, y: my }, points[j], points[j + 1]) < hitDist) {
        return { id, segmentIndex: j, p1: points[j], p2: points[j + 1] }
      }
    }
  }
  return null
}
