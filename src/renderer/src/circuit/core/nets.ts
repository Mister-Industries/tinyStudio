/**
 * circuit/core/nets — the equipotential net model (the spine of Circuit v2).
 *
 * A net is a connected component of the electrical graph over five edge types:
 *   1. wires        — every wire ties its two endpoints together (BOTH views:
 *                     the net model is shared; wires are per-view)
 *   2. junctions    — a {wire,t} endpoint joins the HOST WIRE's net directly
 *                     (fixes B9: identity-based, no coordinate proximity)
 *   3. buses        — pins internally common inside a part (breadboard rows,
 *                     multi-GND boards), supplied by the parts registry
 *   4. net labels   — schematic labels with the same name share a net (GND…)
 *   5. implicit     — derived connections supplied by callers (breadboard
 *                     pin-in-hole seating, M2), as pin-ref pairs
 *
 * Successor to lib/circuitNets.ts. Keys are canonical strings (B10 fix: one
 * canonicalization for everyone — no more refKey/refStr divergence).
 */

import {
  isJunction,
  splitPinRef,
  type CircuitDoc,
  type WireEnd
} from './model'

/** Canonical endpoint key: pins are "part:pin", junctions collapse to the host wire. */
export function endKey(end: WireEnd): string {
  return isJunction(end) ? `~w:${end.wire}` : end
}
/** Key for a wire's own body (junction riders attach to this). */
export function wireKey(wireId: string): string {
  return `~w:${wireId}`
}
export function labelKey(labelId: string): string {
  return `~l:${labelId}`
}

class DSU {
  private parent = new Map<string, string>()
  find(k: string): string {
    if (!this.parent.has(k)) this.parent.set(k, k)
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
  keys(): IterableIterator<string> {
    return this.parent.keys()
  }
}

export interface NetModel {
  /** Pins per net (only "part:pin" members — the electrically meaningful view). */
  nets: string[][]
  /** Net name (from labels) per net index, if any. */
  netNames: (string | undefined)[]
  pinToNet: Map<string, number>
  wireToNet: Map<string, number>
  labelToNet: Map<string, number>
  /** Count of nets containing 2+ pins. */
  meaningful: number
}

export interface BuildNetsOptions {
  /** Internally-common pin-name groups for a part type (from the registry). */
  busesFor?: (type: string) => string[][] | undefined
  /** Derived pin-ref pairs (e.g. breadboard seating): [["R1:1","bb1:e12"], …] */
  implicit?: [string, string][]
}

export function buildNets(doc: CircuitDoc, opts: BuildNetsOptions = {}): NetModel {
  const dsu = new DSU()
  const allPins = new Set<string>()

  // 1+2. wires and junction endpoints — a wire's body key unions with both of
  // its endpoints, so a rider on the wire is in the same component.
  for (const w of doc.wires) {
    const wk = wireKey(w.id)
    for (const end of [w.from, w.to]) {
      const k = endKey(end)
      dsu.union(wk, k)
      if (!isJunction(end)) allPins.add(end)
    }
  }

  // 3. part-internal buses
  for (const part of doc.parts) {
    const buses = opts.busesFor?.(part.type)
    if (!Array.isArray(buses)) continue
    for (const group of buses) {
      for (let i = 1; i < group.length; i++) {
        const a = `${part.id}:${group[0]}`
        const b = `${part.id}:${group[i]}`
        dsu.union(a, b)
        // NOTE: bus pins are only *listed* in nets when something connects to
        // them (allPins gate) — a bare breadboard is 0 meaningful nets.
      }
    }
  }

  // 4. net labels: wires attach to a label's virtual pin "<labelId>:1"; that
  // pin unions with the label key, and same-named labels union together.
  const byName = new Map<string, string>()
  for (const l of doc.netLabels ?? []) {
    const lk = labelKey(l.id)
    dsu.union(lk, `${l.id}:1`)
    const prev = byName.get(l.name)
    if (prev) dsu.union(lk, prev)
    else byName.set(l.name, lk)
  }

  // 5. implicit connections (breadboard seating etc.)
  for (const [a, b] of opts.implicit ?? []) {
    dsu.union(a, b)
    allPins.add(a)
    allPins.add(b)
  }

  // Assemble components.
  const rootToNet = new Map<string, number>()
  const nets: string[][] = []
  const netNames: (string | undefined)[] = []
  const pinToNet = new Map<string, number>()
  const wireToNet = new Map<string, number>()
  const labelToNet = new Map<string, number>()

  const netFor = (root: string): number => {
    let idx = rootToNet.get(root)
    if (idx === undefined) {
      idx = nets.length
      rootToNet.set(root, idx)
      nets.push([])
      netNames.push(undefined)
    }
    return idx
  }

  for (const pin of allPins) {
    const idx = netFor(dsu.find(pin))
    pinToNet.set(pin, idx)
    nets[idx].push(pin)
  }
  for (const w of doc.wires) {
    wireToNet.set(w.id, netFor(dsu.find(wireKey(w.id))))
  }
  for (const l of doc.netLabels ?? []) {
    const idx = netFor(dsu.find(labelKey(l.id)))
    labelToNet.set(l.id, idx)
    if (netNames[idx] === undefined) netNames[idx] = l.name
  }

  for (const net of nets) net.sort()
  const meaningful = nets.filter((n) => n.length >= 2).length
  return { nets, netNames, pinToNet, wireToNet, labelToNet, meaningful }
}

/** Human description of a net (for tooltips / status): named or by members. */
export function describeNet(model: NetModel, index: number): string {
  const name = model.netNames[index]
  const members = model.nets[index] ?? []
  if (name) return `${name} (${members.length} pins)`
  return members.slice(0, 4).join(', ') + (members.length > 4 ? ` +${members.length - 4}` : '')
}

/** Validate junction endpoints: every rider must reference an existing wire in
 * the same view, and never (transitively) itself. Returns wire ids to repair. */
export function danglingJunctions(doc: CircuitDoc): string[] {
  const byId = new Map(doc.wires.map((w) => [w.id, w]))
  const bad: string[] = []
  for (const w of doc.wires) {
    for (const end of [w.from, w.to]) {
      if (!isJunction(end)) continue
      const host = byId.get(end.wire)
      if (!host || host.view !== w.view || end.wire === w.id) bad.push(w.id)
    }
  }
  return bad
}

/** Pins of a part actually referenced by any wire (used by ERC + delete cascades). */
export function connectedPins(doc: CircuitDoc, partId: string): Set<string> {
  const out = new Set<string>()
  for (const w of doc.wires) {
    for (const end of [w.from, w.to]) {
      if (typeof end === 'string' && splitPinRef(end).part === partId) out.add(splitPinRef(end).pin)
    }
  }
  return out
}
