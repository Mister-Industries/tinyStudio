/**
 * circuit/core/commands — every document mutation as a Command.
 *
 * Commands are PURE: `apply(doc)` returns a new doc (structural sharing, no
 * mutation), which makes undo trivial (the store keeps the previous doc) and
 * React integration free. `mergeKey` lets high-frequency gestures (drags)
 * collapse into a single undo step: consecutive commands with the same
 * mergeKey replace the top stack entry instead of pushing a new one.
 *
 * Geometry-dependent updates (wire re-anchoring while a part moves) are
 * computed by the VIEW (it owns pin positions via the registry) and passed in
 * as data — core stays free of parts/geometry knowledge.
 */

import {
  isJunction,
  newId,
  splitPinRef,
  type Analysis,
  type CircuitDoc,
  type CircuitPart,
  type CircuitWire,
  type NetLabel,
  type Placement,
  type Probe,
  type ViewId,
  type WireEnd
} from './model'

export interface Command {
  label: string
  /** Same key on consecutive commands ⇒ they merge into one undo step. */
  mergeKey?: string
  apply(doc: CircuitDoc): CircuitDoc
}

export interface WireReroute {
  wireId: string
  route: string[]
}

// ── parts ────────────────────────────────────────────────────────────────────

export function addPart(part: CircuitPart): Command {
  return {
    label: `Add ${part.id}`,
    apply: (doc) => ({ ...doc, parts: [...doc.parts, part] })
  }
}

/** Move/replace a part's placement in one view; `reroutes` keeps its wires' bends fixed. */
export function placePart(
  id: string,
  view: ViewId,
  placement: Placement | undefined,
  reroutes: WireReroute[] = [],
  merge = false
): Command {
  return {
    label: `Move ${id}`,
    mergeKey: merge ? `place:${view}:${id}` : undefined,
    apply: (doc) => ({
      ...doc,
      parts: doc.parts.map((p) =>
        p.id === id ? { ...p, [view]: placement } : p
      ),
      wires: applyReroutes(doc.wires, reroutes)
    })
  }
}

export function setPartAttr(id: string, key: string, value: string | number | boolean | undefined): Command {
  return {
    label: `Set ${id}.${key}`,
    mergeKey: `attr:${id}:${key}`,
    apply: (doc) => ({
      ...doc,
      parts: doc.parts.map((p) => {
        if (p.id !== id) return p
        const attrs = { ...(p.attrs || {}) }
        if (value === undefined) delete attrs[key]
        else attrs[key] = value
        return { ...p, attrs }
      })
    })
  }
}

/** Rename a part (refdes). Rewrites every wire endpoint that references it. */
export function renamePart(oldId: string, next: string): Command {
  return {
    label: `Rename ${oldId} → ${next}`,
    apply: (doc) => {
      if (doc.parts.some((p) => p.id === next)) return doc // uniqueness guard — no-op
      const fixEnd = (e: WireEnd): WireEnd => {
        if (typeof e !== 'string') return e
        const { part, pin } = splitPinRef(e)
        return part === oldId ? `${next}:${pin}` : e
      }
      return {
        ...doc,
        parts: doc.parts.map((p) => (p.id === oldId ? { ...p, id: next } : p)),
        wires: doc.wires.map((w) => ({ ...w, from: fixEnd(w.from), to: fixEnd(w.to) }))
      }
    }
  }
}

/**
 * Delete parts (both views) and cascade: wires touching them are removed,
 * junction riders on removed wires are repaired (§ junction cascade).
 */
export function deleteParts(ids: string[]): Command {
  const idSet = new Set(ids)
  return {
    label: ids.length === 1 ? `Delete ${ids[0]}` : `Delete ${ids.length} parts`,
    apply: (doc) => {
      const touchesDeleted = (e: WireEnd): boolean =>
        typeof e === 'string' && idSet.has(splitPinRef(e).part)
      const goneWires = new Set(
        doc.wires.filter((w) => touchesDeleted(w.from) || touchesDeleted(w.to)).map((w) => w.id)
      )
      return {
        ...doc,
        parts: doc.parts.filter((p) => !idSet.has(p.id)),
        wires: cascadeWireRemoval(doc.wires, goneWires)
      }
    }
  }
}

// ── wires ────────────────────────────────────────────────────────────────────

export function addWire(wire: Omit<CircuitWire, 'id'> & { id?: string }): Command {
  const w: CircuitWire = { id: wire.id ?? newId('w'), ...wire } as CircuitWire
  return {
    label: 'Add wire',
    apply: (doc) => {
      // duplicate guard (B5): identical endpoints in either order, same view
      const dup = doc.wires.some(
        (x) =>
          x.view === w.view &&
          ((sameEnd(x.from, w.from) && sameEnd(x.to, w.to)) ||
            (sameEnd(x.from, w.to) && sameEnd(x.to, w.from)))
      )
      if (dup) return doc
      return { ...doc, wires: [...doc.wires, w] }
    }
  }
}

export function rerouteWire(id: string, route: string[], merge = false): Command {
  return {
    label: 'Reshape wire',
    mergeKey: merge ? `route:${id}` : undefined,
    apply: (doc) => ({
      ...doc,
      wires: doc.wires.map((w) => (w.id === id ? { ...w, route } : w))
    })
  }
}

export function setWireEnds(id: string, from: WireEnd | undefined, to: WireEnd | undefined, route?: string[]): Command {
  return {
    label: 'Reconnect wire',
    apply: (doc) => ({
      ...doc,
      wires: doc.wires.map((w) =>
        w.id === id
          ? { ...w, from: from ?? w.from, to: to ?? w.to, ...(route ? { route } : {}) }
          : w
      )
    })
  }
}

export function recolorWire(id: string, color: string): Command {
  return {
    label: 'Recolor wire',
    apply: (doc) => ({
      ...doc,
      wires: doc.wires.map((w) => (w.id === id ? { ...w, color } : w))
    })
  }
}

export function deleteWires(ids: string[]): Command {
  return {
    label: ids.length === 1 ? 'Delete wire' : `Delete ${ids.length} wires`,
    apply: (doc) => ({ ...doc, wires: cascadeWireRemoval(doc.wires, new Set(ids)) })
  }
}

// ── net labels ───────────────────────────────────────────────────────────────

export function addNetLabel(label: NetLabel): Command {
  return {
    label: `Add label ${label.name}`,
    apply: (doc) => ({ ...doc, netLabels: [...(doc.netLabels ?? []), label] })
  }
}
export function deleteNetLabel(id: string): Command {
  return {
    label: 'Delete label',
    apply: (doc) => ({
      ...doc,
      netLabels: (doc.netLabels ?? []).filter((l) => l.id !== id),
      wires: cascadeWireRemoval(
        doc.wires,
        new Set(
          doc.wires
            .filter(
              (w) =>
                (typeof w.from === 'string' && splitPinRef(w.from).part === id) ||
                (typeof w.to === 'string' && splitPinRef(w.to).part === id)
            )
            .map((w) => w.id)
        )
      )
    })
  }
}

// ── sim ──────────────────────────────────────────────────────────────────────

export function setAnalyses(analyses: Analysis[]): Command {
  return {
    label: 'Configure simulation',
    apply: (doc) => ({ ...doc, sim: { ...(doc.sim ?? {}), analyses } })
  }
}
export function setProbes(probes: Probe[]): Command {
  return {
    label: 'Update probes',
    apply: (doc) => ({ ...doc, sim: { ...(doc.sim ?? {}), probes } })
  }
}

// ── batch ────────────────────────────────────────────────────────────────────

/** Compose several commands into one undo step (cross-view cascades, paste…). */
export function composite(label: string, commands: Command[]): Command {
  return {
    label,
    apply: (doc) => commands.reduce((d, c) => c.apply(d), doc)
  }
}

// ── internals ────────────────────────────────────────────────────────────────

function sameEnd(a: WireEnd, b: WireEnd): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b
  return a.wire === b.wire && Math.abs(a.t - b.t) < 0.01
}

function applyReroutes(wires: CircuitWire[], reroutes: WireReroute[]): CircuitWire[] {
  if (!reroutes.length) return wires
  const byId = new Map(reroutes.map((r) => [r.wireId, r.route]))
  return wires.map((w) => (byId.has(w.id) ? { ...w, route: byId.get(w.id)! } : w))
}

/**
 * Remove a set of wires and repair junction riders that referenced them:
 * a rider's junction end is re-anchored to the removed host's `from` endpoint
 * (which keeps it on the same net); if that is itself removed, the repair
 * recurses; unrepairable riders are removed too. (B9 cascade.)
 */
export function cascadeWireRemoval(wires: CircuitWire[], gone: Set<string>): CircuitWire[] {
  const byId = new Map(wires.map((w) => [w.id, w]))
  const resolveAnchor = (hostId: string, seen: Set<string>): WireEnd | null => {
    if (seen.has(hostId)) return null
    seen.add(hostId)
    const host = byId.get(hostId)
    if (!host) return null
    if (!gone.has(hostId)) return { wire: hostId, t: 0.5 } // host survives — shouldn't happen, keep rider
    if (typeof host.from === 'string') return host.from
    return resolveAnchor(host.from.wire, seen)
  }
  const out: CircuitWire[] = []
  for (const w of wires) {
    if (gone.has(w.id)) continue
    let from = w.from
    let to = w.to
    let dead = false
    if (isJunction(from) && gone.has(from.wire)) {
      const a = resolveAnchor(from.wire, new Set([w.id]))
      if (a) from = a
      else dead = true
    }
    if (!dead && isJunction(to) && gone.has(to.wire)) {
      const a = resolveAnchor(to.wire, new Set([w.id]))
      if (a) to = a
      else dead = true
    }
    if (dead) continue
    // collapse degenerate wires (both ends now identical)
    if (sameEnd(from, to)) continue
    out.push(from === w.from && to === w.to ? w : { ...w, from, to })
  }
  return out
}
