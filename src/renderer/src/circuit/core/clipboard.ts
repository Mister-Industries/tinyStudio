/**
 * circuit/core/clipboard — copy/paste/duplicate as pure document logic.
 *
 * The clipboard payload is JSON (spec §6.2): a self-contained fragment of
 * parts + wires. It travels on the system clipboard as text (a custom MIME
 * type is unreliable across the desktop and web builds), detected by shape.
 *
 * Rules:
 *  - a wire is included only if BOTH its endpoints stay resolvable inside the
 *    payload: pin ends must reference included parts; junction ends must
 *    reference included wires (filtered to a fixpoint).
 *  - on paste, parts get fresh refdes ids (prefix derived from the old id),
 *    wires get fresh ids, endpoints are rewritten, placements are offset.
 */

import { newId, splitPinRef, isJunction, type CircuitDoc, type CircuitPart, type CircuitWire, type WireEnd } from './model'

export const CLIPBOARD_FORMAT = 'tinystudio-circuit-clipboard'

export interface ClipboardPayload {
  format: typeof CLIPBOARD_FORMAT
  version: 2
  parts: CircuitPart[]
  wires: CircuitWire[]
}

/** Build a payload from a selection. Returns null when nothing copyable. */
export function buildClipboard(
  doc: CircuitDoc,
  partIds: Iterable<string>,
  wireIds: Iterable<string> = []
): ClipboardPayload | null {
  const pset = new Set(partIds)
  const wsel = new Set(wireIds)
  const parts = doc.parts.filter((p) => pset.has(p.id))

  // candidates: explicitly selected wires + wires whose pin ends all sit on
  // selected parts (junction ends are provisionally in — the fixpoint below
  // keeps them only if their host wire survives)
  const pinIn = (e: WireEnd): boolean => typeof e === 'string' && pset.has(splitPinRef(e).part)
  const endIn = (e: WireEnd): boolean => isJunction(e) || pinIn(e)
  const candidates = doc.wires.filter(
    (w) => wsel.has(w.id) || (endIn(w.from) && endIn(w.to) && (pinIn(w.from) || pinIn(w.to)))
  )

  // filter to a fixpoint: every endpoint must resolve inside the payload
  let keep = new Map(candidates.map((w) => [w.id, w]))
  for (;;) {
    const next = new Map<string, CircuitWire>()
    for (const w of keep.values()) {
      const ok = (e: WireEnd): boolean =>
        isJunction(e) ? keep.has(e.wire) : pset.has(splitPinRef(e).part)
      if (ok(w.from) && ok(w.to)) next.set(w.id, w)
    }
    if (next.size === keep.size) break
    keep = next
  }

  if (parts.length === 0 && keep.size === 0) return null
  return {
    format: CLIPBOARD_FORMAT,
    version: 2,
    parts: parts.map((p) => structuredClone(p)),
    wires: [...keep.values()].map((w) => structuredClone(w))
  }
}

/** Parse clipboard text into a payload, or null when it isn't ours. */
export function parseClipboard(text: string): ClipboardPayload | null {
  try {
    const raw = JSON.parse(text)
    if (raw?.format !== CLIPBOARD_FORMAT || raw.version !== 2) return null
    return {
      format: CLIPBOARD_FORMAT,
      version: 2,
      parts: Array.isArray(raw.parts) ? raw.parts : [],
      wires: Array.isArray(raw.wires) ? raw.wires : []
    }
  } catch {
    return null
  }
}

/** Refdes prefix of an existing id: "R12" → "R", "led_3a" → "led". */
function idPrefix(id: string): string {
  const m = /^([A-Za-z][A-Za-z_-]*?)[_-]?\d*$/.exec(id)
  return m ? m[1] : 'P'
}

export interface MaterializedPaste {
  parts: CircuitPart[]
  wires: CircuitWire[]
  /** old part id → new part id (for selecting the pasted set). */
  idMap: Map<string, string>
}

/**
 * Re-id a payload against a target document and offset its placements.
 * Pure — the caller wraps the result in addPart/addWire commands.
 */
export function materializePaste(
  doc: CircuitDoc,
  payload: ClipboardPayload,
  offset: { x: number; y: number }
): MaterializedPaste {
  // seed per-prefix counters from the target doc
  const counters = new Map<string, number>()
  const bump = (prefix: string): number => {
    if (!counters.has(prefix)) {
      let max = 0
      const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`)
      for (const p of doc.parts) {
        const m = re.exec(p.id)
        if (m) max = Math.max(max, parseInt(m[1], 10))
      }
      counters.set(prefix, max)
    }
    const n = counters.get(prefix)! + 1
    counters.set(prefix, n)
    return n
  }

  const idMap = new Map<string, string>()
  const parts = payload.parts.map((src) => {
    const p = structuredClone(src)
    const prefix = idPrefix(p.id)
    p.id = `${prefix}${bump(prefix)}`
    idMap.set(src.id, p.id)
    if (p.bb) {
      p.bb.x += offset.x
      p.bb.y += offset.y
    }
    if (p.sch) {
      p.sch.x += offset.x
      p.sch.y += offset.y
    }
    return p
  })

  const wireIdMap = new Map<string, string>()
  for (const w of payload.wires) wireIdMap.set(w.id, newId('w'))
  const fixEnd = (e: WireEnd): WireEnd => {
    if (isJunction(e)) return { ...e, wire: wireIdMap.get(e.wire) ?? e.wire }
    const { part, pin } = splitPinRef(e)
    const mapped = idMap.get(part)
    return mapped ? `${mapped}:${pin}` : e
  }
  const wires = payload.wires.map((src) => {
    const w = structuredClone(src)
    w.id = wireIdMap.get(src.id)!
    w.from = fixEnd(w.from)
    w.to = fixEnd(w.to)
    return w
  })

  return { parts, wires, idMap }
}
