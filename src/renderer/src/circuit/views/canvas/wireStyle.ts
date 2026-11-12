/**
 * circuit/views/canvas/wireStyle: how wires are drawn in both views (stroke widths,
 * corner radii, the net-highlight glow) and the path helper that draws them.
 */

import type { Pt } from '../../core/model'
import { WIRE_STROKE } from '../../parts/style'

// wire look (identical to DiagramEditor / tinySchematic)
export const WIRE_W = 2.8
// schematic ink: one stroke, same weight as a symbol's pin lead so a wire
// reads as a continuation of the lead it lands on (parts/style.ts)
export const WIRE_SCH_W = WIRE_STROKE
export const WIRE_OUTLINE_W = WIRE_W + 1.8
export const WIRE_GLOW_W = WIRE_W + 5
export const WIRE_CORNER = 4
// schematics turn square: a filleted corner reads as a hand-drawn sketch,
// and every schematic convention (and CircuitLab) uses a hard 90°
export const WIRE_CORNER_SCH = 0
export const NET_GLOW = 'rgba(243, 203, 0, 0.30)'

export function darken(hex: string, f = 0.55): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return 'rgba(0,0,0,0.45)'
  const n = parseInt(m[1], 16)
  return `rgb(${Math.round(((n >> 16) & 255) * f)}, ${Math.round(((n >> 8) & 255) * f)}, ${Math.round((n & 255) * f)})`
}

export function roundedPath(points: Pt[], r = WIRE_CORNER): string {
  if (points.length < 2) return ''
  if (points.length === 2) return `M${points[0].x} ${points[0].y} L${points[1].x} ${points[1].y}`
  let d = `M${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1]
    const c = points[i]
    const n = points[i + 1]
    const d1 = Math.hypot(c.x - p.x, c.y - p.y) || 1
    const d2 = Math.hypot(n.x - c.x, n.y - c.y) || 1
    const rr = Math.max(0, Math.min(r, d1 / 2, d2 / 2))
    const a = { x: c.x - ((c.x - p.x) / d1) * rr, y: c.y - ((c.y - p.y) / d1) * rr }
    const b = { x: c.x + ((n.x - c.x) / d2) * rr, y: c.y + ((n.y - c.y) / d2) * rr }
    d += ` L${a.x} ${a.y} Q${c.x} ${c.y} ${b.x} ${b.y}`
  }
  const last = points[points.length - 1]
  d += ` L${last.x} ${last.y}`
  return d
}
