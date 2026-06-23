/**
 * wireRouting — orthogonal auto-routing for the circuit diagram, ported from the
 * tinySchematic prototype. Wire geometry is stored in the Wokwi `diagram.json`
 * route format: a connection is [from, to, color?, instructions?] where
 * `instructions` is a list of relative moves like "h12.5" / "v-40" applied from
 * the source pin. This keeps our files drop-in compatible with Wokwi.
 */

export type PinRef = string | { x: number; y: number }
export type Connection = [PinRef, PinRef, string?, string[]?]
export interface Pt {
  x: number
  y: number
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

/** Resolve a connection's full point list from its source pin + route instructions. */
export function getWirePoints(conn: Connection, resolve: (ref: PinRef) => Pt | null): Pt[] {
  const source = resolve(conn[0])
  const target = resolve(conn[1])
  if (!source || !target) return []

  const points: Pt[] = [{ x: source.x, y: source.y }]
  let cx = source.x
  let cy = source.y

  for (const instr of conn[3] || []) {
    if (instr === '*') continue
    const val = parseFloat(instr.substring(1))
    if (Number.isNaN(val)) continue
    if (instr.startsWith('v')) cy += val
    else if (instr.startsWith('h')) cx += val
    points.push({ x: cx, y: cy })
  }

  // bridge any gap between the routed tail and the (possibly moved) target pin
  const last = points[points.length - 1]
  if (Math.abs(last.x - target.x) > 0.001 || Math.abs(last.y - target.y) > 0.001) {
    const bridge = calculateOrthogonalPath(last.x, last.y, target.x, target.y, false)
    for (let i = 1; i < bridge.length; i++) points.push(bridge[i])
  }
  return points
}

/** Serialize an absolute point list back into Wokwi h/v relative instructions. */
export function instructionsFromPoints(points: Pt[]): string[] {
  const out: string[] = []
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    if (Math.abs(dx) > 0.001) out.push(`h${Math.round(dx * 1000) / 1000}`)
    if (Math.abs(dy) > 0.001) out.push(`v${Math.round(dy * 1000) / 1000}`)
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
 * Move an entire wire segment (between points[i] and points[i+1]) perpendicular
 * to itself — the Fritzing/Wokwi "drag a wire" behavior. `perp` is the new value
 * on the segment's free axis (y for a horizontal segment, x for a vertical one).
 * If an endpoint is a pin (first/last point), it stays put and a perpendicular
 * stub is inserted so the wire keeps docking cleanly into the pin.
 */
export function moveSegment(points: Pt[], i: number, perp: number): Pt[] {
  if (i < 0 || i + 1 >= points.length) return points
  const horizontal = Math.abs(points[i].y - points[i + 1].y) < 0.001
  const startIsPin = i === 0
  const endIsPin = i + 1 === points.length - 1
  const moved = (p: Pt): Pt => (horizontal ? { x: p.x, y: perp } : { x: perp, y: p.y })
  const out: Pt[] = []
  for (let k = 0; k < points.length; k++) {
    if (k === i) {
      if (startIsPin) out.push({ ...points[k] }, moved(points[k]))
      else out.push(moved(points[k]))
    } else if (k === i + 1) {
      if (endIsPin) out.push(moved(points[k]), { ...points[k] })
      else out.push(moved(points[k]))
    } else {
      out.push({ ...points[k] })
    }
  }
  return simplifyWirePoints(out)
}

/** Distance from point p to segment v→w (for wire hit-testing). */
export function distanceToSegment(p: Pt, v: Pt, w: Pt): number {
  const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y)
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)))
}

/** SVG points="" string for a polyline. */
export function ptsStr(points: Pt[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}
