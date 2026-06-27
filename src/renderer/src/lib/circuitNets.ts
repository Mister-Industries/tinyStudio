/**
 * circuitNets — equipotential ("net") model for the Circuit view.
 *
 * A faithful TypeScript port of tinySchematic's `js/net.js`, after Fritzing's
 * `collectEqualPotential` flood fill (BREADBOARD_AND_WIRING_TECHNICAL_SPEC.md
 * §3.3). A net is a connected component of the electrical graph over three
 * edge types:
 *   1. physical edges — every connection ties its two endpoints together.
 *   2. bus edges      — pins internally common on a part (a part whose .fzp
 *                       declares a <bus>); supplied via `busesFor`, default none.
 *   3. junctions      — a free {x,y} endpoint lying on another wire joins that
 *                       wire's net (a bendpoint touching a wire body).
 *
 * A connection endpoint is either a pin ref "partId:pinName" or a free point
 * {x,y}. The model recomputes cheaply; sketches are small.
 */

import { distanceToSegment, type Connection, type PinRef, type Pt } from './wireRouting'

export interface NetPart {
  id: string
  type: string
}

export interface NetModel {
  nets: string[][]
  pinToNet: Map<string, number>
  connToNet: number[]
  keyToNet: Map<string, number>
}

/** Stable string key for any endpoint reference. */
export function refKey(ref: PinRef): string {
  if (ref && typeof ref === 'object' && (ref as Pt).x !== undefined) {
    const p = ref as Pt
    return `@${Math.round(p.x * 100) / 100},${Math.round(p.y * 100) / 100}`
  }
  return String(ref)
}

function isPinRef(ref: PinRef): ref is string {
  return typeof ref === 'string' && ref.includes(':')
}

/** Tiny union-find over endpoint keys. */
class DSU {
  private parent = new Map<string, string>()
  add(k: string): void {
    if (!this.parent.has(k)) this.parent.set(k, k)
  }
  find(k: string): string {
    this.add(k)
    let root = k
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    let cur = k
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }
  union(a: string, b: string): void {
    this.parent.set(this.find(a), this.find(b))
  }
}

/**
 * Build all nets for the current sketch.
 * `pointsFor` resolves a connection's rendered point list (so per-view route
 * overlays are honoured); `busesFor` optionally returns internally-common pin
 * groups for a part type.
 */
export function buildNets(
  parts: NetPart[],
  connections: Connection[],
  pointsFor: (c: Connection, i: number) => Pt[],
  busesFor?: (type: string) => string[][] | undefined
): NetModel {
  const dsu = new DSU()

  // 1. physical edges
  connections.forEach((conn) => {
    dsu.union(refKey(conn[0]), refKey(conn[1]))
  })

  // 2. bus edges
  parts.forEach((part) => {
    const buses = busesFor?.(part.type)
    if (!Array.isArray(buses)) return
    buses.forEach((group) => {
      for (let i = 1; i < group.length; i++) {
        dsu.union(`${part.id}:${group[0]}`, `${part.id}:${group[i]}`)
      }
    })
  })

  // 3. junctions: a free-point endpoint sitting on another wire joins its net.
  const wirePointsCache = connections.map((c, i) => pointsFor(c, i))
  connections.forEach((conn, ci) => {
    ;[conn[0], conn[1]].forEach((ref) => {
      if (isPinRef(ref) || !(ref && typeof ref === 'object')) return
      const pt = { x: (ref as Pt).x, y: (ref as Pt).y }
      for (let oi = 0; oi < connections.length; oi++) {
        if (oi === ci) continue
        const pts = wirePointsCache[oi]
        for (let s = 0; s < pts.length - 1; s++) {
          if (distanceToSegment(pt, pts[s], pts[s + 1]) < 2) {
            dsu.union(refKey(ref), refKey(connections[oi][0]))
            return
          }
        }
      }
    })
  })

  const rootToNet = new Map<string, number>()
  const nets: string[][] = []
  const pinToNet = new Map<string, number>()
  const keyToNet = new Map<string, number>()

  const allKeys = new Set<string>()
  connections.forEach((c) => {
    allKeys.add(refKey(c[0]))
    allKeys.add(refKey(c[1]))
  })
  parts.forEach((part) => {
    const buses = busesFor?.(part.type)
    if (Array.isArray(buses)) buses.forEach((g) => g.forEach((p) => allKeys.add(`${part.id}:${p}`)))
  })

  const netIndexForRoot = (root: string): number => {
    if (!rootToNet.has(root)) {
      rootToNet.set(root, nets.length)
      nets.push([])
    }
    return rootToNet.get(root)!
  }

  allKeys.forEach((key) => {
    keyToNet.set(key, netIndexForRoot(dsu.find(key)))
  })

  connections.forEach((conn) => {
    ;[conn[0], conn[1]].forEach((ref) => {
      if (!isPinRef(ref)) return
      const idx = keyToNet.get(refKey(ref))
      if (idx === undefined) return
      if (!pinToNet.has(ref)) {
        pinToNet.set(ref, idx)
        nets[idx].push(ref)
      }
    })
  })
  parts.forEach((part) => {
    const buses = busesFor?.(part.type)
    if (!Array.isArray(buses)) return
    buses.forEach((g) =>
      g.forEach((p) => {
        const ref = `${part.id}:${p}`
        const idx = keyToNet.get(refKey(ref))
        if (idx !== undefined && !pinToNet.has(ref)) {
          pinToNet.set(ref, idx)
          nets[idx].push(ref)
        }
      })
    )
  })

  const connToNet = connections.map((c) => {
    const k = refKey(c[0])
    return keyToNet.has(k) ? keyToNet.get(k)! : -1
  })

  return { nets, pinToNet, connToNet, keyToNet }
}

/** Count of nets that contain 2+ real pins (an electrically meaningful net). */
export function meaningfulNetCount(netModel: NetModel): number {
  return netModel.nets.filter((n) => n.length >= 2).length
}
