/**
 * circuit/core/erc — lightweight electrical-rule checks over the net model
 * (spec §9). Non-blocking: every finding is a severity-tagged ErcIssue the UI
 * renders in a panel. Pure + registry-free (component floating-pin checks that
 * need pin geometry live in the view layer and are merged in there).
 */

import { splitPinRef, type CircuitDoc } from './model'
import { danglingJunctions, type NetModel } from './nets'

export type ErcSeverity = 'error' | 'warning' | 'info'

export interface ErcIssue {
  id: string
  severity: ErcSeverity
  message: string
  ref?: { part?: string; wire?: string; label?: string; pin?: string }
}

/** Net-model rule checks (rail shorts, floating labels, dangling junctions, ground). */
export function runErc(doc: CircuitDoc, net: NetModel): ErcIssue[] {
  const out: ErcIssue[] = []
  const labels = doc.netLabels ?? []

  // dangling junction hosts — a rider references a wire that no longer exists.
  for (const wid of danglingJunctions(doc)) {
    out.push({
      id: `dangling:${wid}`,
      severity: 'error',
      message: `Wire ${wid} rides a junction on a missing wire.`,
      ref: { wire: wid }
    })
  }

  // rail short — one net carries two different named rails/grounds (GND + 5V…).
  const railsByNet = new Map<number, Set<string>>()
  for (const l of labels) {
    if (l.kind === 'net') continue
    const idx = net.pinToNet.get(`${l.id}:1`)
    if (idx === undefined) continue
    let set = railsByNet.get(idx)
    if (!set) railsByNet.set(idx, (set = new Set()))
    set.add(l.name)
  }
  for (const [, names] of railsByNet) {
    if (names.size > 1) {
      const list = [...names].sort().join(' / ')
      out.push({
        id: `short:${list}`,
        severity: 'error',
        message: `Rail short — ${list} are tied to the same net.`
      })
    }
  }

  // floating net label — placed but nothing is wired to it.
  const wiredParts = new Set<string>()
  for (const w of doc.wires) {
    for (const e of [w.from, w.to]) if (typeof e === 'string') wiredParts.add(splitPinRef(e).part)
  }
  for (const l of labels) {
    if (!wiredParts.has(l.id)) {
      out.push({
        id: `floatlabel:${l.id}`,
        severity: 'info',
        message: `Net label “${l.name}” isn't wired to anything.`,
        ref: { label: l.id }
      })
    }
  }

  // missing ground — power rails present but no ground reference for node 0.
  const kinds = new Set(labels.map((l) => l.kind))
  if (kinds.has('power') && !kinds.has('ground')) {
    out.push({
      id: 'noground',
      severity: 'info',
      message: 'No ground (GND) reference — add a Ground label for a complete schematic.'
    })
  }

  return out
}
