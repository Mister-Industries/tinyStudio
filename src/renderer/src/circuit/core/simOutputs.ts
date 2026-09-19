/**
 * circuit/core/simOutputs: which points of the circuit an analysis reports
 * (spec §10.4, CircuitLab-style output selection).
 *
 * ngspice hands back every node in the circuit; a schematic of any size turns
 * that into an unreadable plot. CircuitLab's answer is to make the user name
 * the outputs (click a node, or pick it from a list) and plot only those.
 * This module is the pure half of that: the stable references we persist, and
 * their resolution against a generated netlist.
 *
 * WHY REFERENCES AND NOT VECTOR NAMES: the netlist's node names (`n1`, `n2`…)
 * are assigned in net order and change the moment a wire is added, so storing
 * `v(n3)` in circuit.json would silently start pointing at a different node.
 * We persist what the user actually picked instead:
 *
 *   "v@R1:1"     the net that R1's pin 1 sits on
 *   "i@V1"       the current through V1 (a voltage source / current probe)
 *   "d@P2"       a differential probe's own reading
 *
 * ZERO React, ZERO DOM: same rule as the rest of core/.
 */

import { newId, type CircuitDoc, type Probe, type ViewId } from './model'
import { describeNet, type NetModel } from './nets'
import { nodeNamesForNets, type NetlistResult } from './netlist'

export type OutputKind = 'v' | 'i' | 'd'

/** Persisted form: `"<kind>@<target>"`. */
export type OutputRef = string

export interface OutputChoice {
  ref: OutputRef
  kind: OutputKind
  /** short display name ("VOUT", "node 3", "I(V1)") */
  label: string
  /** longer explanation for a tooltip / secondary line */
  detail?: string
  /** net index this output reads, when it has one (canvas highlighting) */
  netIndex?: number
}

export interface ResolvedOutput extends OutputChoice {
  /** lowercase vector name as ngspice reports it, when it can be resolved */
  vector?: string
}

export function makeOutputRef(kind: OutputKind, target: string): OutputRef {
  return `${kind}@${target}`
}

export function parseOutputRef(ref: OutputRef): { kind: OutputKind; target: string } | null {
  const i = ref.indexOf('@')
  if (i < 0) return null
  const kind = ref.slice(0, i)
  if (kind !== 'v' && kind !== 'i' && kind !== 'd') return null
  return { kind, target: ref.slice(i + 1) }
}

/** Parts whose netlist card is a voltage source, so ngspice reports a current
 * through them. Current sources are excluded: their current is the value the
 * user typed, not a result. Kept in step with core/netlist's EMITTERS table. */
const CURRENT_CAPABLE = /sim-vdc|sim-vsin|sim-probe-i|voltage source|battery|sine|waveform/i

/** The stable pin reference we use to name a net: its lowest-sorted member. */
function anchorPinOf(net: NetModel, index: number): string | undefined {
  return (net.nets[index] ?? [])[0]
}

/** Output reference for whichever net a pin belongs to. */
export function netOutputRef(net: NetModel, pinRef: string): OutputRef | null {
  const idx = net.pinToNet.get(pinRef)
  if (idx == null) return null
  const anchor = anchorPinOf(net, idx)
  return anchor ? makeOutputRef('v', anchor) : null
}

/** Output reference for a net given by index (a wire click resolves to this). */
export function netOutputRefByIndex(net: NetModel, index: number): OutputRef | null {
  const anchor = anchorPinOf(net, index)
  return anchor ? makeOutputRef('v', anchor) : null
}

/** Net an output reads, or undefined for a current/diff output. */
export function netIndexOfOutput(ref: OutputRef, net: NetModel): number | undefined {
  const p = parseOutputRef(ref)
  if (!p || p.kind !== 'v') return undefined
  return net.pinToNet.get(p.target)
}

/**
 * What a net is called on screen: its label if it has one, otherwise the same
 * `n<k>` token the netlist will hand ngspice, so the tag on the canvas, the
 * row in the Outputs list and the vector in the results all read alike.
 */
export function netLabelFor(net: NetModel, index: number, nodeNames?: string[]): string {
  const name = net.netNames[index]
  if (name) return name
  const node = (nodeNames ?? nodeNamesForNets(net))[index]
  if (node && node !== '0') return node
  const anchor = anchorPinOf(net, index)
  return anchor ? `node ${anchor}` : `net ${index + 1}`
}

/**
 * Everything this circuit can report, ready for a checkbox list: one entry per
 * multi-pin net (ground excluded; it is 0 by definition), one per
 * current-measuring part, one per differential probe.
 */
export function availableOutputs(
  doc: CircuitDoc,
  net: NetModel,
  familyOf?: (type: string) => string | undefined
): OutputChoice[] {
  const out: OutputChoice[] = []
  const nodeNames = nodeNamesForNets(net)
  net.nets.forEach((members, i) => {
    if (members.length < 2) return
    if ((net.netNames[i] ?? '').toUpperCase() === 'GND') return
    const ref = netOutputRefByIndex(net, i)
    if (!ref) return
    out.push({
      ref,
      kind: 'v',
      label: netLabelFor(net, i, nodeNames),
      detail: describeNet(net, i),
      netIndex: i
    })
  })
  for (const p of doc.parts) {
    if (p.type === 'sim-probe-vdiff') {
      out.push({
        ref: makeOutputRef('d', p.id),
        kind: 'd',
        label: String(p.attrs?.label ?? p.id),
        detail: `differential voltage across ${p.id}`
      })
      continue
    }
    if (CURRENT_CAPABLE.test(`${p.type} ${familyOf?.(p.type) ?? ''}`)) {
      out.push({
        ref: makeOutputRef('i', p.id),
        kind: 'i',
        label: `I(${p.id})`,
        detail: `current through ${p.id}`
      })
    }
  }
  return out
}

/** Attach the ngspice vector name each reference resolves to for THIS run. */
export function resolveOutputs(
  refs: readonly OutputRef[],
  doc: CircuitDoc,
  net: NetModel,
  gen: NetlistResult | null,
  familyOf?: (type: string) => string | undefined
): ResolvedOutput[] {
  const known = new Map(availableOutputs(doc, net, familyOf).map((c) => [c.ref, c]))
  const out: ResolvedOutput[] = []
  for (const ref of refs) {
    const parsed = parseOutputRef(ref)
    if (!parsed) continue
    const base: OutputChoice = known.get(ref) ?? {
      ref,
      kind: parsed.kind,
      label: parsed.target,
      detail: 'no longer in the circuit'
    }
    out.push({ ...base, vector: vectorForOutput(ref, net, gen) })
  }
  return out
}

/** The lowercase ngspice vector name a reference reads, for a given run. */
export function vectorForOutput(
  ref: OutputRef,
  net: NetModel,
  gen: NetlistResult | null
): string | undefined {
  const parsed = parseOutputRef(ref)
  if (!parsed) return undefined
  if (parsed.kind === 'd') return `vdiff(${parsed.target})`.toLowerCase()
  if (parsed.kind === 'i') {
    const devices = gen?.elementOfPart[parsed.target] ?? []
    const source = devices.find((d) => d.startsWith('v'))
    return source ? `i(${source})`.toLowerCase() : undefined
  }
  const idx = net.pinToNet.get(parsed.target)
  if (idx == null || !gen) return undefined
  const node = gen.nodeOfNet[idx]
  return node ? `v(${node})`.toLowerCase() : undefined
}

/**
 * Predicate for "does this result vector belong to the picked outputs?".
 * An empty pick means "everything": same as before outputs existed, so a
 * circuit the user hasn't curated still plots.
 */
export function outputFilter(resolved: readonly ResolvedOutput[]): (vecName: string) => boolean {
  if (!resolved.length) return () => true
  const want = new Set(
    resolved.map((r) => r.vector).filter((v): v is string => typeof v === 'string')
  )
  if (!want.size) return () => true
  return (name: string) => want.has(name.toLowerCase())
}

/** Display name for a resolved vector, preferring the picked output's label. */
export function outputLabelFor(
  resolved: readonly ResolvedOutput[]
): (vecName: string) => string | undefined {
  const byVector = new Map<string, string>()
  for (const r of resolved) if (r.vector) byVector.set(r.vector, r.label)
  return (name: string) => byVector.get(name.toLowerCase())
}

// ── placed probes ────────────────────────────────────────────────────────────
//
// A picked output is not a highlight; it is a tag on the sheet. These helpers
// keep doc.sim.probes and the Outputs list describing the same set, so ticking
// a box in the panel and clicking a wire on the canvas do the same thing.

/** Default distance a fresh tag sits above the point that was clicked. */
export const PROBE_DEFAULT_OFFSET: [number, number] = [0, -26]

export function probeKindForRef(ref: OutputRef): Probe['kind'] {
  const parsed = parseOutputRef(ref)
  if (parsed?.kind === 'i') return 'current'
  if (parsed?.kind === 'd') return 'diff'
  return 'voltage'
}

/** The probe measuring a given output, if one is placed. */
export function probeFor(probes: readonly Probe[], ref: OutputRef): Probe | undefined {
  return probes.find((p) => p.at === ref)
}

/** The outputs the placed probes ask for: the panel's "picked" set. */
export function outputRefsOf(probes: readonly Probe[]): OutputRef[] {
  return probes.map((p) => p.at)
}

/**
 * A new probe for an output. `offset` is where its tag sits relative to the
 * anchor in the view it was placed from; the other view gets the default, so
 * a probe dropped on the schematic is still findable on the breadboard.
 */
export function makeProbe(
  ref: OutputRef,
  view: ViewId,
  offset: [number, number] = PROBE_DEFAULT_OFFSET
): Probe {
  return {
    id: newId('pb'),
    kind: probeKindForRef(ref),
    at: ref,
    [view]: offset,
    ...(view === 'sch' ? { bb: PROBE_DEFAULT_OFFSET } : { sch: PROBE_DEFAULT_OFFSET })
  }
}

/** Which part a probe hangs off: the anchor for its leader line. */
export function probeAnchor(
  ref: OutputRef
): { kind: OutputKind; part: string; pin?: string } | null {
  const parsed = parseOutputRef(ref)
  if (!parsed) return null
  if (parsed.kind === 'v') {
    const i = parsed.target.lastIndexOf(':')
    if (i < 0) return { kind: 'v', part: parsed.target }
    return { kind: 'v', part: parsed.target.slice(0, i), pin: parsed.target.slice(i + 1) }
  }
  return { kind: parsed.kind, part: parsed.target }
}
