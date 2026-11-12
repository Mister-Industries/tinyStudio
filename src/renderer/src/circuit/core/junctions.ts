/**
 * circuit/core/junctions: where a schematic needs a solder dot.
 *
 * Convention (CircuitLab, KiCad, every textbook): a dot marks a point where
 * three or more conductors of one net meet; two wires that merely cross carry
 * no dot and are not connected. Automatic wires of one net may share a track
 * and branch off it, so dots can't come from wire endpoints alone. Instead
 * each net's wires are rasterised onto the grid and every grid node with
 * three or more connections (a pin counts as one) gets a dot.
 */

import type { Pt } from './model'

export interface NetWire {
  /** wires with the same key are one net */
  net: string
  pts: Pt[]
}

export function junctionPoints(wires: NetWire[], pins: Pt[], grid: number): Pt[] {
  const key = (x: number, y: number): string => `${Math.round(x / grid)},${Math.round(y / grid)}`
  const pinKeys = new Set(pins.map((p) => key(p.x, p.y)))
  const byNet = new Map<string, NetWire[]>()
  for (const w of wires) byNet.set(w.net, [...(byNet.get(w.net) ?? []), w])

  const out: Pt[] = []
  for (const group of byNet.values()) {
    const edges = new Set<string>()
    const degree = new Map<string, number>()
    const at = new Map<string, Pt>()
    const link = (a: string, b: string, pa: Pt, pb: Pt): void => {
      const e = a < b ? `${a}|${b}` : `${b}|${a}`
      if (edges.has(e)) return
      edges.add(e)
      degree.set(a, (degree.get(a) ?? 0) + 1)
      degree.set(b, (degree.get(b) ?? 0) + 1)
      at.set(a, pa)
      at.set(b, pb)
    }
    for (const { pts } of group) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]
        const b = pts[i]
        const n = Math.round(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / grid)
        let prev = a
        for (let k = 1; k <= n; k++) {
          const cur = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }
          link(key(prev.x, prev.y), key(cur.x, cur.y), prev, cur)
          prev = cur
        }
      }
    }
    for (const [k, d] of degree) {
      if (d + (pinKeys.has(k) ? 1 : 0) >= 3) out.push(at.get(k)!)
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x)
}
