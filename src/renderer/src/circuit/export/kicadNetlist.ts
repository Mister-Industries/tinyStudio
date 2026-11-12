/**
 * circuit/export/kicadNetlist: the circuit as a KiCad netlist (.net, format
 * "E"), for pcbnew's File → Import → Netlist. It needs only nets, refdes and
 * footprints, so it's the quickest path from a tinyStudio circuit to a PCB.
 *
 * Net names: a named net (GND, 3V3, SDA) keeps its name; any other net takes
 * KiCad's own `Net-(R1-Pad2)` form from its first node, so a re-export of an
 * unchanged circuit produces the same names.
 */

import type { CircuitDoc } from '../core/model'
import type { NetModel } from '../core/nets'
import { compareRefs, exportValue, today, type ExportContext } from './common'
import { isExportedPart, kicadMappingFor, type ResolvedMapping } from './kicadMap'

export interface ExportResult {
  text: string
  warnings: string[]
}

/**
 * A component exported in a part's place. A tinyCore under a HAT becomes the
 * HAT's three headers: each carries some of the board's pins, by pin name.
 */
export interface StandIn {
  ref: string
  footprint: string
  /** lib:symbol */
  symbol: string
  value: string
  /** the replaced part's pin name → this component's pad number */
  pads: Record<string, string>
  /**
   * pad → net name it always carries, wired or not (a header's GND and 3V3),
   * and the name its net takes when the circuit doesn't name it
   */
  fixed?: Record<string, string>
  /** pad → name for its net when the circuit doesn't name it ("D8") */
  names?: Record<string, string>
}

export interface NetlistOptions {
  /** part id → the components exported instead of it */
  standIns?: Map<string, StandIn[]>
}

/** One component as the netlist exports it; the schematic writer places the same set. */
export interface ExportComponent {
  ref: string
  value: string
  footprint: string
  /** lib:symbol, or '' when no KiCad symbol is mapped */
  symbol: string
  description: string
  /** the circuit part it comes from (a stand-in's replaced part) */
  partId: string
  /** the part's pin name → pad number */
  pads: Record<string, string>
}

export interface NetlistExport extends ExportResult {
  /** "<ref>:<pad>" → the net name it was given, for files that must agree */
  padNets: Map<string, string>
  /** every component, in refdes order */
  components: ExportComponent[]
}

/** KiCad s-expression string. */
export function q(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

const refOfComp = (line: string): string => /\(ref "([^"]*)"\)/.exec(line)?.[1] ?? ''

const splitLib = (id: string): [string, string] => {
  const i = id.indexOf(':')
  return i < 0 ? ['', id] : [id.slice(0, i), id.slice(i + 1)]
}

export function kicadNetlist(
  doc: CircuitDoc,
  net: NetModel,
  ctx: ExportContext = {},
  opts: NetlistOptions = {}
): NetlistExport {
  const warnings: string[] = []
  const parts = doc.parts
    .filter((p) => isExportedPart(p.type))
    .sort((a, b) => compareRefs(a.id, b.id))
  const mapping = new Map<string, ResolvedMapping>()

  const comps: string[] = []
  const compLine = (
    ref: string,
    value: string,
    footprint: string,
    symbol: string,
    desc: string
  ): string => {
    const [lib, sym] = splitLib(symbol)
    return (
      `    (comp (ref ${q(ref)})\n` +
      `      (value ${q(value)})\n` +
      `      (footprint ${q(footprint)})\n` +
      `      (libsource (lib ${q(lib)}) (part ${q(sym)}) (description ${q(desc)})))`
    )
  }
  // stand-ins replace their part outright: its own mapping never applies
  const standIn = opts.standIns ?? new Map<string, StandIn[]>()
  const standInByRef = new Map([...standIn.values()].flat().map((c) => [c.ref, c]))
  const components: ExportComponent[] = []
  for (const [partId, list] of standIn)
    for (const c of list) {
      comps.push(compLine(c.ref, c.value, c.footprint, c.symbol, ''))
      components.push({
        ref: c.ref,
        value: c.value,
        footprint: c.footprint,
        symbol: c.symbol,
        description: '',
        partId,
        pads: c.pads
      })
    }
  for (const part of parts) {
    if (standIn.has(part.id)) continue
    const m = kicadMappingFor(part.type, ctx.pinsOf?.(part.type) ?? [])
    mapping.set(part.id, m)
    if (m.generic)
      warnings.push(`${part.id} (${part.type}) has no KiCad footprint; assign one in pcbnew`)
    comps.push(
      compLine(
        part.id,
        exportValue(part, ctx),
        m.footprint,
        splitLib(m.symbol)[1] ? m.symbol : `${splitLib(m.symbol)[0]}:${part.type}`,
        ctx.labelOf?.(part.type) ?? ''
      )
    )
    components.push({
      ref: part.id,
      value: exportValue(part, ctx),
      footprint: m.footprint,
      symbol: m.symbol,
      description: ctx.labelOf?.(part.type) ?? '',
      partId: part.id,
      pads: m.pads
    })
  }
  comps.sort((a, b) => compareRefs(refOfComp(a), refOfComp(b)))
  components.sort((a, b) => compareRefs(a.ref, b.ref))

  type Node = { ref: string; pad: string }
  const nets: { name: string; nodes: Node[] }[] = []
  net.nets.forEach((members, i) => {
    const nodes: Node[] = []
    for (const pinRef of members) {
      const idx = pinRef.lastIndexOf(':')
      const ref = pinRef.slice(0, idx)
      const pin = pinRef.slice(idx + 1)
      const stand = standIn.get(ref)
      if (stand) {
        // a pin no stand-in carries (an on-board signal) simply isn't on the HAT
        for (const c of stand)
          if (c.pads[pin] !== undefined) nodes.push({ ref: c.ref, pad: c.pads[pin] })
        continue
      }
      const m = mapping.get(ref)
      if (!m) continue // breadboard holes, sources, probes: they join nets, they aren't components
      const pad = m.pads[pin]
      if (pad === undefined) {
        warnings.push(`${ref}:${pin} has no pad in ${m.footprint || 'its footprint'}; left out`)
        continue
      }
      nodes.push({ ref, pad })
    }
    if (!nodes.length) return
    nodes.sort((a, b) => compareRefs(a.ref, b.ref) || Number(a.pad) - Number(b.pad))
    // a bussed pin (GND, GND.2) lands on the same pad only once
    for (let k = nodes.length - 1; k > 0; k--)
      if (nodes[k].ref === nodes[k - 1].ref && nodes[k].pad === nodes[k - 1].pad) nodes.splice(k, 1)
    const standName = nodes
      .map((nd) => {
        const c = standInByRef.get(nd.ref)
        return c?.fixed?.[nd.pad] ?? c?.names?.[nd.pad]
      })
      .find(Boolean)
    const name = net.netNames[i] ?? standName ?? `Net-(${nodes[0].ref}-Pad${nodes[0].pad})`
    nets.push({ name, nodes })
  })
  // pads that always carry a net (a header's GND, 3V3) join it even unwired
  for (const c of standInByRef.values()) {
    for (const [pad, fixedName] of Object.entries(c.fixed ?? {})) {
      if (nets.some((n) => n.nodes.some((nd) => nd.ref === c.ref && nd.pad === pad))) continue
      const into = nets.find((n) => n.name === fixedName)
      if (into) into.nodes.push({ ref: c.ref, pad })
      else nets.push({ name: fixedName, nodes: [{ ref: c.ref, pad }] })
    }
  }
  // two nets that ended up with one name (GND wired on two separate headers)
  // are one net in KiCad: merge them rather than emit a duplicate
  for (let a = 0; a < nets.length; a++)
    for (let b = nets.length - 1; b > a; b--)
      if (nets[a].name === nets[b].name) {
        nets[a].nodes.push(...nets[b].nodes)
        nets.splice(b, 1)
      }
  for (const n of nets)
    n.nodes.sort((a, b) => compareRefs(a.ref, b.ref) || Number(a.pad) - Number(b.pad))
  nets.sort((a, b) => a.name.localeCompare(b.name))
  const padNets = new Map<string, string>()
  for (const n of nets) for (const nd of n.nodes) padNets.set(`${nd.ref}:${nd.pad}`, n.name)

  const netText = nets.map(
    (n, i) =>
      `    (net (code ${q(String(i + 1))}) (name ${q(n.name)})\n` +
      n.nodes.map((nd) => `      (node (ref ${q(nd.ref)}) (pin ${q(nd.pad)}))`).join('\n') +
      ')'
  )

  const text = [
    '(export (version "E")',
    '  (design',
    `    (source ${q('circuit.json')})`,
    `    (date ${q(today(ctx))})`,
    `    (tool ${q('tinyStudio')}))`,
    '  (components',
    ...comps,
    '  )',
    '  (nets',
    ...netText,
    '  )',
    ')',
    ''
  ].join('\n')
  return { text, warnings, padNets, components }
}
