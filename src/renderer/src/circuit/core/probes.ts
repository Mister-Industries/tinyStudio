/**
 * circuit/core/probes: placeable sim probes, the pure/testable half (M4
 * leftover, spec §10.3). Part art + registration live in parts/simProbes.ts
 * (renderer-facing); the emitted SPICE for the current probe lives in
 * core/netlist.ts. This module only needs to:
 *   - recognize probe part types (probesIn), and
 *   - compute a differential-voltage probe's subtraction vector from a
 *     completed run (diffProbeVector/diffProbeVectors); voltage/diff probes
 *     emit no SPICE element, so there's nothing else to derive.
 *
 * Zero React, zero Node: same rule as the rest of core/.
 */

import type { CircuitDoc, CircuitPart } from './model'
import type { NetModel } from './nets'
import type { NetlistResult } from './netlist'
import { readableNetName } from './simOutputs'
import type { SimRun, SimVector } from '../sim/backend'

export type ProbeKind = 'voltage' | 'diff' | 'current'

export const PROBE_TYPES: Record<string, ProbeKind> = {
  'sim-probe-v': 'voltage',
  'sim-probe-vdiff': 'diff',
  'sim-probe-i': 'current'
}

export function isProbeType(type: string): boolean {
  return type in PROBE_TYPES
}

export interface ProbeInfo {
  part: CircuitPart
  kind: ProbeKind
  /** attrs.label if the user set one, else the part id (refdes) */
  label: string
}

/** Every placed probe part in the doc, in part order. */
export function probesIn(doc: CircuitDoc): ProbeInfo[] {
  const out: ProbeInfo[] = []
  for (const p of doc.parts) {
    const kind = PROBE_TYPES[p.type]
    if (!kind) continue
    out.push({ part: p, kind, label: String(p.attrs?.label ?? p.id) })
  }
  return out
}

function vectorOfNode(run: SimRun, node: string): SimVector | undefined {
  if (node === '0')
    return { name: 'v(0)', type: 'voltage', values: new Array(run.numPoints).fill(0) }
  const key = `v(${node.toLowerCase()})`
  return run.vectors.find((v) => v.name.toLowerCase() === key)
}

/**
 * A diff probe's `+`/`-` pins land on two nets; ngspice already reports each
 * node's voltage, so the probe's own value is just their subtraction. Returns
 * undefined if either pin isn't wired into a net, or the run has no matching
 * vector for one side (e.g. that node was excluded/unreachable).
 */
export function diffProbeVector(
  probe: CircuitPart,
  net: NetModel,
  gen: NetlistResult,
  run: SimRun
): SimVector | undefined {
  const plusIdx = net.pinToNet.get(`${probe.id}:+`)
  const minusIdx = net.pinToNet.get(`${probe.id}:-`)
  if (plusIdx == null || minusIdx == null) return undefined
  const a = vectorOfNode(run, gen.nodeOfNet[plusIdx])
  const b = vectorOfNode(run, gen.nodeOfNet[minusIdx])
  if (!a || !b || a.values.length !== b.values.length) return undefined
  const values = a.values.map((v, i) => v - b.values[i])
  const vec: SimVector = { name: `vdiff(${probe.id})`, type: 'voltage', values }
  if (a.imag && b.imag) vec.imag = a.imag.map((v, i) => v - b.imag![i])
  return vec
}

/** All synthetic diff-probe vectors for the current doc + completed run. */
export function diffProbeVectors(
  doc: CircuitDoc,
  net: NetModel,
  gen: NetlistResult,
  run: SimRun
): SimVector[] {
  const out: SimVector[] = []
  for (const p of probesIn(doc)) {
    if (p.kind !== 'diff') continue
    const v = diffProbeVector(p.part, net, gen, run)
    if (v) out.push(v)
  }
  return out
}

/**
 * Friendly label for a vector name, preferring a probe's attrs.label over
 * the raw SPICE name: `v(n3)` → "Probe1" when a voltage probe sits on that
 * node; `i(v<id>)` → the current probe's label; `vdiff(<id>)` → its label.
 */
export function probeLabelFor(
  vecName: string,
  doc: CircuitDoc,
  net: NetModel,
  gen: NetlistResult
): string | undefined {
  const diffM = /^vdiff\((.+)\)$/i.exec(vecName)
  if (diffM) {
    const p = doc.parts.find((p) => p.id.toLowerCase() === diffM[1].toLowerCase())
    return p ? String(p.attrs?.label ?? p.id) : undefined
  }
  const iM = /^i\(v(.+)\)$/i.exec(vecName)
  if (iM) {
    const p = doc.parts.find(
      (p) => p.type === 'sim-probe-i' && p.id.toLowerCase() === iM[1].toLowerCase()
    )
    return p ? String(p.attrs?.label ?? p.id) : undefined
  }
  const vM = /^v\((.+)\)$/i.exec(vecName)
  if (vM) {
    const node = vM[1].toLowerCase()
    const netIdx = gen.nodeOfNet.findIndex((n) => n.toLowerCase() === node)
    if (netIdx < 0) return undefined
    for (const p of probesIn(doc)) {
      if (p.kind !== 'voltage') continue
      if (net.pinToNet.get(`${p.part.id}:+`) === netIdx) return p.label
    }
  }
  return undefined
}

/** tinyStudio boards whose header pins name the nets they touch */
const isBoardType = (type: string): boolean => /^tiny[a-z]+$/.test(type) && type !== 'tinyproto'

/**
 * A readable name for a result vector when no probe or output label names it:
 * auto-numbered nodes ("v(n3)") become the board pin they touch ("V(D9)") or
 * the parts they join ("V(R1–LED1)"); a source's current ("i(vv1)") becomes
 * "I(V1)". Named nets print as written ("V(3V3)"). Display only: the netlist and the
 * vector names are unchanged.
 */
export function traceNameFor(
  vecName: string,
  doc: CircuitDoc,
  net: NetModel,
  gen: NetlistResult
): string | undefined {
  const vM = /^v\((.+)\)$/i.exec(vecName)
  if (vM) {
    const node = vM[1].toLowerCase()
    const i = gen.nodeOfNet.findIndex((n) => n.toLowerCase() === node)
    if (i < 0) return undefined
    // a named net reads as its name, as written on the sheet
    if (net.netNames[i]) return `V(${net.netNames[i]})`
    const readable = readableNetName(doc, net, i)
    return readable ? `V(${readable})` : undefined
  }
  const iM = /^i\((.+)\)$/i.exec(vecName)
  if (iM) {
    const dev = iM[1].toLowerCase()
    for (const [id, els] of Object.entries(gen.elementOfPart)) {
      if (!els.includes(dev)) continue
      const p = doc.parts.find((q) => q.id === id)
      // a board's own supply: name the rail, not the board
      if (p && isBoardType(p.type)) {
        const rail = /_(\w+)$/.exec(dev)?.[1]
        return rail ? `I(${rail.toUpperCase()})` : `I(${id})`
      }
      return `I(${id})`
    }
  }
  return undefined
}
