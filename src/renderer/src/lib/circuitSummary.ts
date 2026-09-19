/**
 * circuitSummary: a circuit as plain text for Studio AI's inspect_circuit.
 *
 * Pure: the caller builds the net model (with breadboard seating and buses from
 * the parts registry, see lib/agentCircuit.ts) and says what each part type is.
 * tinyCore pins are annotated with their GPIO and what to write in code, so the
 * agent can take pin constants straight from the wiring.
 */

import { splitPinRef, type CircuitDoc } from '../circuit/core/model'
import type { NetModel } from '../circuit/core/nets'
import { describeTinyCorePin, tinyCorePin } from '../../../shared/tinycorePins'

export interface PartInfo {
  /** Display name from the parts library. */
  label: string
  /** Breadboards and protoboards: their hole pins are hidden from the summary. */
  breadboard?: boolean
}

const TINYCORE = 'tinycore'

export function summarizeCircuit(
  doc: CircuitDoc,
  nets: NetModel,
  info: (type: string) => PartInfo | undefined,
  notes: string[] = []
): string {
  if (doc.parts.length === 0) return ['The circuit is empty.', ...notes].join('\n')

  const typeOf = new Map(doc.parts.map((p) => [p.id, p.type]))
  const isHole = (ref: string): boolean => {
    const type = typeOf.get(splitPinRef(ref).part)
    return !!type && !!info(type)?.breadboard
  }
  const pinText = (ref: string): string => {
    const { part, pin } = splitPinRef(ref)
    if (typeOf.get(part) !== TINYCORE) return ref
    const tc = tinyCorePin(pin)
    return tc ? `${ref} [tinyCore ${describeTinyCorePin(tc)}]` : ref
  }

  const bbWires = doc.wires.filter((w) => w.view === 'bb').length
  const out = [
    `Circuit: ${doc.parts.length} parts, ${doc.wires.length} wires (${bbWires} breadboard, ${doc.wires.length - bbWires} schematic).`,
    '',
    'Parts:'
  ]
  for (const part of doc.parts) {
    const pi = info(part.type)
    const attrs = Object.entries(part.attrs ?? {}).map(([k, v]) => `${k}=${v}`)
    const extra = [
      ...attrs,
      !pi && '(type not in the parts library)',
      pi?.breadboard && '(connections through its holes are included below)',
      !part.bb && !part.sch && '(unplaced, in the tray)'
    ].filter(Boolean)
    out.push(
      `- ${part.id}: ${pi?.label ?? part.type} (${part.type})${extra.length ? ' ' + extra.join(' ') : ''}`
    )
  }

  // One line per net with 2+ real pins; breadboard holes are just conductors.
  const connected = new Set<string>()
  const tinyCoreUse: string[] = []
  const netLines: string[] = []
  const onTinyCore = (ref: string): boolean => typeOf.get(splitPinRef(ref).part) === TINYCORE
  nets.nets.forEach((members, i) => {
    // tinyCore pins lead, so each line reads "board pin ↔ what's on it"
    const pins = members
      .filter((m) => !isHole(m))
      .sort((a, b) => Number(onTinyCore(b)) - Number(onTinyCore(a)))
    if (pins.length < 2) return
    pins.forEach((m) => connected.add(splitPinRef(m).part))
    const name = nets.netNames[i]
    netLines.push(`- ${name ? `${name}: ` : ''}${pins.map(pinText).join(' ↔ ')}`)
    for (const m of pins) {
      if (typeOf.get(splitPinRef(m).part) !== TINYCORE) continue
      const others = pins.filter((o) => o !== m)
      tinyCoreUse.push(`- ${pinText(m)} → ${others.join(', ')}`)
    }
  })

  out.push('', 'Connections (each line is one electrical net):')
  out.push(...(netLines.length ? netLines : ['- none yet']))
  if (typeOf.size && [...typeOf.values()].includes(TINYCORE)) {
    out.push('', 'tinyCore pins in use:')
    out.push(...(tinyCoreUse.length ? tinyCoreUse : ['- none: nothing is wired to the tinyCore']))
  }

  const loose = doc.parts.filter((p) => !connected.has(p.id) && !info(p.type)?.breadboard)
  if (loose.length) out.push('', `Not connected to anything: ${loose.map((p) => p.id).join(', ')}`)
  if (notes.length) out.push('', 'Notes:', ...notes.map((n) => `- ${n}`))
  return out.join('\n')
}
