/**
 * circuit/core/geometry — snapping, rotation, and a spatial hash for pin
 * hit-testing / drop-to-connect. Pure math; no document knowledge.
 */

import { GRID_BB, GRID_SCH, type Pt, type ViewId } from './model'

export function gridFor(view: ViewId): number {
  return view === 'bb' ? GRID_BB : GRID_SCH
}

export function snap(v: number, grid: number): number {
  return Math.round(v / grid) * grid
}
export function snapPt(p: Pt, grid: number): Pt {
  return { x: snap(p.x, grid), y: snap(p.y, grid) }
}

/** Rotate/flip a local point inside a w×h part box (flip is horizontal, applied before rotation). */
export function transformLocalPoint(
  px: number,
  py: number,
  w: number,
  h: number,
  rotate = 0,
  flip = false
): Pt {
  let x = flip ? w - px : px
  const y = py
  const rad = (rotate * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = x - w / 2
  const dy = y - h / 2
  return { x: w / 2 + dx * cos - dy * sin, y: h / 2 + dx * sin + dy * cos }
}

/**
 * Pin position in world space for a part placed at (x,y) with rotation/flip.
 * `local` is the pin's PartDef coordinate; `w`/`h` the view's part box.
 */
export function pinWorld(
  local: [number, number],
  placement: { x: number; y: number; rotate?: number; flip?: boolean },
  w: number,
  h: number,
  legOffset?: [number, number]
): Pt {
  const p = transformLocalPoint(
    local[0] + (legOffset?.[0] ?? 0),
    local[1] + (legOffset?.[1] ?? 0),
    w,
    h,
    placement.rotate ?? 0,
    placement.flip ?? false
  )
  return { x: placement.x + p.x, y: placement.y + p.y }
}

/**
 * Snap a part's placement so its PINS land on-grid (not its origin) — the
 * Fritzing behavior that keeps everything lined up. Uses the first pin as the
 * alignment reference.
 */
export function snapPlacementToPinGrid(
  placement: { x: number; y: number; rotate?: number; flip?: boolean },
  firstPinLocal: [number, number] | undefined,
  w: number,
  h: number,
  grid: number
): { x: number; y: number } {
  if (!firstPinLocal) return { x: snap(placement.x, grid), y: snap(placement.y, grid) }
  const pin = pinWorld(firstPinLocal, placement, w, h)
  const snapped = snapPt(pin, grid)
  return {
    x: placement.x + (snapped.x - pin.x),
    y: placement.y + (snapped.y - pin.y)
  }
}

// ── spatial hash ─────────────────────────────────────────────────────────────

/** Uniform-grid spatial hash for point sets (pins, holes). Cell = 2 grid units. */
export class SpatialHash<T> {
  private cells = new Map<string, { p: Pt; v: T }[]>()
  constructor(private cellSize = GRID_BB * 2) {}

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`
  }

  insert(p: Pt, v: T): void {
    const k = this.key(p.x, p.y)
    let cell = this.cells.get(k)
    if (!cell) this.cells.set(k, (cell = []))
    cell.push({ p, v })
  }

  /** Nearest entry within `radius` of `p`, or null. */
  nearest(p: Pt, radius: number): { p: Pt; v: T; dist: number } | null {
    const r = Math.ceil(radius / this.cellSize)
    const cx = Math.floor(p.x / this.cellSize)
    const cy = Math.floor(p.y / this.cellSize)
    let best: { p: Pt; v: T; dist: number } | null = null
    for (let gx = cx - r; gx <= cx + r; gx++) {
      for (let gy = cy - r; gy <= cy + r; gy++) {
        const cell = this.cells.get(`${gx},${gy}`)
        if (!cell) continue
        for (const e of cell) {
          const d = Math.hypot(e.p.x - p.x, e.p.y - p.y)
          if (d <= radius && (!best || d < best.dist)) best = { ...e, dist: d }
        }
      }
    }
    return best
  }

  clear(): void {
    this.cells.clear()
  }
}
