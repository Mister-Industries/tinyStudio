/**
 * circuit/core/autoroute: obstacle-aware routing for schematic wires.
 *
 * Every automatic schematic wire is routed on the fine grid with A*: part
 * bodies are walls, text is something to avoid, and every bend, crossing and
 * run alongside another net costs extra, so wires go around parts instead of
 * through them and don't stack on top of each other. Each wire still leaves
 * its pins outward by one stub (routing.pinExitPath) before the search starts.
 *
 * Wires are routed one at a time, shortest first; each routed wire becomes a
 * cost for the ones after it. Same-net wires may share a track (they are one
 * conductor); different nets may cross but not overlap.
 *
 * Pure and deterministic: same input, same routes. No React, no DOM.
 */

import type { Pt } from './model'
import { calculateOrthogonalPath, pinExitPath, simplifyWirePoints, type PinDir } from './routing'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface RouteRequest {
  id: string
  /** wires on one net may share a track */
  net: string
  s: Pt
  sDir: PinDir | null
  t: Pt
  tDir: PinDir | null
}

export interface RouteOptions {
  /** grid pitch the routes snap to */
  grid: number
  /** part bodies: never crossed */
  walls: Rect[]
  /** text and other things to keep clear of, at a cost */
  soft?: Rect[]
  /** distance a wire leaves its pin before turning */
  stub: number
}

const BEND = 6
const SOFT = 4
const CROSS = 3
const OVERLAP = 60
/** running right next to another net: legal, but reads as one blob */
const CROWD = 4
/** above this many cells the search falls back to a plain pin-exit route */
const MAX_CELLS = 250_000

const DIRS: Pt[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 }
]
const DIR_INDEX: Record<PinDir, number> = { r: 0, l: 1, d: 2, u: 3 }

/** Binary min-heap keyed on f. */
class Heap {
  private items: { f: number; s: number }[] = []
  get size(): number {
    return this.items.length
  }
  push(f: number, s: number): void {
    const a = this.items
    a.push({ f, s })
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].f <= a[i].f) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop(): number {
    const a = this.items
    const top = a[0].s
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l].f < a[m].f) m = l
        if (r < a.length && a[r].f < a[m].f) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

const stubEnd = (p: Pt, d: PinDir | null, stub: number): Pt => {
  if (!d) return p
  const v = DIRS[DIR_INDEX[d]]
  return { x: p.x + v.x * stub, y: p.y + v.y * stub }
}

/** Route a batch of wires. Returns a polyline per wire id. */
export function autoroute(reqs: RouteRequest[], opts: RouteOptions): Map<string, Pt[]> {
  const out = new Map<string, Pt[]>()
  if (!reqs.length) return out
  const g = opts.grid
  const fallback = (r: RouteRequest): Pt[] => pinExitPath(r.s, r.sDir, r.t, r.tDir, opts.stub)

  // grid extent: every endpoint and wall, plus room to go around
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (x: number, y: number): void => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const r of reqs) {
    grow(r.s.x, r.s.y)
    grow(r.t.x, r.t.y)
  }
  for (const w of opts.walls) {
    grow(w.x, w.y)
    grow(w.x + w.w, w.y + w.h)
  }
  const pad = 8 * g
  const x0 = Math.floor((minX - pad) / g) * g
  const y0 = Math.floor((minY - pad) / g) * g
  const cols = Math.ceil((maxX + pad - x0) / g) + 1
  const rows = Math.ceil((maxY + pad - y0) / g) + 1
  if (cols * rows > MAX_CELLS) {
    for (const r of reqs) out.set(r.id, fallback(r))
    return out
  }

  const N = cols * rows
  const idx = (cx: number, cy: number): number => cy * cols + cx
  const cellOf = (p: Pt): [number, number] => [
    Math.round((p.x - x0) / g),
    Math.round((p.y - y0) / g)
  ]

  // walls: a cell is blocked when its centre is inside a body (edges included,
  // so a wire never runs along a body's outline)
  const blocked = new Uint8Array(N)
  const soft = new Uint8Array(N)
  const mark = (arr: Uint8Array, r: Rect, inset: number): void => {
    const ax = Math.ceil((r.x - inset - x0) / g)
    const bx = Math.floor((r.x + r.w + inset - x0) / g)
    const ay = Math.ceil((r.y - inset - y0) / g)
    const by = Math.floor((r.y + r.h + inset - y0) / g)
    for (let cy = Math.max(0, ay); cy <= Math.min(rows - 1, by); cy++)
      for (let cx = Math.max(0, ax); cx <= Math.min(cols - 1, bx); cx++) arr[idx(cx, cy)] = 1
  }
  for (const w of opts.walls) mark(blocked, w, 0)
  for (const s of opts.soft ?? []) mark(soft, s, 0)

  // tracks already used: per cell, the net on its horizontal and vertical run
  const usedH: (string | undefined)[] = new Array(N)
  const usedV: (string | undefined)[] = new Array(N)
  const occupy = (pts: Pt[], net: string): void => {
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = cellOf(pts[i - 1])
      const [bx, by] = cellOf(pts[i])
      const horiz = ay === by
      const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay))
      for (let k = 0; k <= n; k++) {
        const cx = ax + Math.sign(bx - ax) * k
        const cy = ay + Math.sign(by - ay) * k
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue
        const c = idx(cx, cy)
        if (horiz) usedH[c] = net
        else usedV[c] = net
      }
    }
  }

  const order = [...reqs].sort(
    (a, b) =>
      Math.abs(a.s.x - a.t.x) +
        Math.abs(a.s.y - a.t.y) -
        (Math.abs(b.s.x - b.t.x) + Math.abs(b.s.y - b.t.y)) || a.id.localeCompare(b.id)
  )

  // search state = cell * 4 + direction of travel into the cell
  const gScore = new Float64Array(N * 4)
  const from = new Int32Array(N * 4)

  for (const r of order) {
    const s1 = stubEnd(r.s, r.sDir, opts.stub)
    const t1 = stubEnd(r.t, r.tDir, opts.stub)
    const [sx, sy] = cellOf(s1)
    const [tx, ty] = cellOf(t1)
    if (
      sx < 0 ||
      sy < 0 ||
      tx < 0 ||
      ty < 0 ||
      sx >= cols ||
      tx >= cols ||
      sy >= rows ||
      ty >= rows
    ) {
      out.set(r.id, fallback(r))
      continue
    }
    const goal = idx(tx, ty)
    // arriving at t1 we must then turn toward the pin (opposite of tDir)
    const finalDir = r.tDir ? DIR_INDEX[({ l: 'r', r: 'l', u: 'd', d: 'u' } as const)[r.tDir]] : -1
    gScore.fill(Infinity)
    from.fill(-1)
    const heap = new Heap()
    const h = (cx: number, cy: number): number => Math.abs(cx - tx) + Math.abs(cy - ty)
    const startDirs = r.sDir ? [DIR_INDEX[r.sDir]] : [0, 1, 2, 3]
    for (const d of startDirs) {
      const st = idx(sx, sy) * 4 + d
      gScore[st] = 0
      heap.push(h(sx, sy), st)
    }
    let found = -1
    while (heap.size) {
      const st = heap.pop()
      const cell = st >> 2
      const d = st & 3
      const cost = gScore[st]
      if (cell === goal) {
        found = st
        break
      }
      const cx = cell % cols
      const cy = (cell / cols) | 0
      for (let nd = 0; nd < 4; nd++) {
        // never reverse in place
        if ((d ^ 1) === nd && d >> 1 === nd >> 1) continue
        const v = DIRS[nd]
        const nx = cx + v.x
        const ny = cy + v.y
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
        const nc = idx(nx, ny)
        if (blocked[nc] && nc !== goal) continue
        const horiz = nd < 2
        const along = horiz ? usedH[nc] : usedV[nc]
        const across = horiz ? usedV[nc] : usedH[nc]
        let step = 1
        if (nd !== d) step += BEND
        if (along !== undefined && along !== r.net) step += OVERLAP
        if (across !== undefined && across !== r.net) step += CROSS
        // a parallel neighbour of another net one fine step away
        const side = horiz ? [nc - cols, nc + cols] : [nc - 1, nc + 1]
        for (const sc of side) {
          if (sc < 0 || sc >= N) continue
          const par = horiz ? usedH[sc] : usedV[sc]
          if (par !== undefined && par !== r.net) step += CROWD
        }
        if (soft[nc]) step += SOFT
        if (nc === goal && finalDir >= 0 && nd !== finalDir) step += BEND
        const ns = nc * 4 + nd
        const ng = cost + step
        if (ng < gScore[ns]) {
          gScore[ns] = ng
          from[ns] = st
          heap.push(ng + h(nx, ny), ns)
        }
      }
    }
    if (found < 0) {
      out.set(r.id, fallback(r))
      continue
    }
    const cells: Pt[] = []
    for (let st = found; st >= 0; st = from[st]) {
      const c = st >> 2
      cells.push({ x: x0 + (c % cols) * g, y: y0 + ((c / cols) | 0) * g })
    }
    cells.reverse()
    const pts = simplifyWirePoints([r.s, ...cells, r.t])
    occupy(pts, r.net)
    out.set(r.id, pts)
  }
  return out
}

// ── interactive drawing ──────────────────────────────────────────────────────

/** Does any segment of `pts` pass through the inside of a wall? Running along
 * an edge or ending on it (a pin on a body's outline) doesn't count. */
export function crossesWall(pts: Pt[], walls: Rect[]): boolean {
  const e = 0.5
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const x0 = Math.min(a.x, b.x)
    const x1 = Math.max(a.x, b.x)
    const y0 = Math.min(a.y, b.y)
    const y1 = Math.max(a.y, b.y)
    for (const w of walls) {
      if (x1 <= w.x + e || x0 >= w.x + w.w - e || y1 <= w.y + e || y0 >= w.y + w.h - e) continue
      return true
    }
  }
  return false
}

/**
 * The bend a wire being drawn takes from its last point to the cursor: the
 * usual L when it is clear, the other L when only that one is, and otherwise a
 * route around the parts in the way. A straight run (the two points line up)
 * is the user's own line and is left alone even across a part, as is the L
 * when nothing clear exists.
 *
 * A wall that holds an end is cut back to clear it (see carve, below).
 */
export function drawingPath(
  s: Pt,
  t: Pt,
  walls: Rect[],
  grid: number,
  endOnMajorAxis: boolean,
  /** text to stay off when a detour is needed (refdes, values) */
  soft: Rect[] = []
): Pt[] {
  const first = calculateOrthogonalPath(s.x, s.y, t.x, t.y, endOnMajorAxis)
  if (s.x === t.x || s.y === t.y) return first
  const inside = (p: Pt, w: Rect): boolean =>
    p.x >= w.x && p.x <= w.x + w.w && p.y >= w.y && p.y <= w.y + w.h
  // only what is near the stroke can be in the way
  const pad = 12 * grid
  const bx0 = Math.min(s.x, t.x) - pad
  const bx1 = Math.max(s.x, t.x) + pad
  const by0 = Math.min(s.y, t.y) - pad
  const by1 = Math.max(s.y, t.y) + pad
  // A part whose box holds an end: on a schematic that's the pin's own
  // symbol (its box includes the leads), so cut the box back to the body,
  // past the pin; on a breadboard a pin deep inside a board's art means the
  // board can't be in the way at all.
  const carve = (w: Rect, p: Pt): Rect | null => {
    if (!inside(p, w)) return w
    const dl = p.x - w.x
    const dr = w.x + w.w - p.x
    const dt = p.y - w.y
    const db = w.y + w.h - p.y
    const m = Math.min(dl, dr, dt, db)
    if (m > 0.3 * Math.min(w.w, w.h)) return null
    if (m === dl) return { x: p.x + grid, y: w.y, w: w.x + w.w - p.x - grid, h: w.h }
    if (m === dr) return { x: w.x, y: w.y, w: p.x - grid - w.x, h: w.h }
    if (m === dt) return { x: w.x, y: p.y + grid, w: w.w, h: w.y + w.h - p.y - grid }
    return { x: w.x, y: w.y, w: w.w, h: p.y - grid - w.y }
  }
  const local: Rect[] = []
  for (const w0 of walls) {
    if (w0.x >= bx1 || w0.x + w0.w <= bx0 || w0.y >= by1 || w0.y + w0.h <= by0) continue
    const a = carve(w0, s)
    const w = a && carve(a, t)
    if (w && w.w > 0 && w.h > 0) local.push(w)
  }
  if (!crossesWall(first, local)) return first
  const corner = first[1].x === t.x && first[1].y === s.y ? { x: s.x, y: t.y } : { x: t.x, y: s.y }
  const other = [s, corner, t]
  if (!crossesWall(other, local)) return other
  const r = autoroute([{ id: 'draw', net: 'draw', s, sDir: null, t, tDir: null }], {
    grid,
    walls: local,
    soft,
    stub: 0
  }).get('draw')
  if (!r || crossesWall(r, local)) return first
  // grid arithmetic leaves 95.99999…; land exactly on the two ends' lines
  const fix = (v: number, a: number, b: number): number =>
    Math.abs(v - a) < 1e-6 ? a : Math.abs(v - b) < 1e-6 ? b : v
  return simplifyWirePoints(
    r.map((p, i) =>
      i === 0 ? s : i === r.length - 1 ? t : { x: fix(p.x, s.x, t.x), y: fix(p.y, s.y, t.y) }
    )
  )
}
