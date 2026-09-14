/**
 * agentCircuit — the parts-registry half of Studio AI's inspect_circuit and
 * find_parts tools (reached through lib/studioBridge.ts).
 *
 * Connections need the registry: parts seated in breadboard holes connect by
 * pin geometry, and buses (breadboard rows, a board's several GND pins) come
 * from part definitions. That's why these run in the renderer even when the
 * agent itself runs in the main process.
 */

import { parseCircuitFile } from '../circuit/core/model'
import { buildNets } from '../circuit/core/nets'
import { isBreadboard } from '../circuit/parts/breadboard'
import { initPartsLibrary } from '../circuit/parts/partsBoot'
import { circuitBuses, implicitSeats } from '../circuit/views/partsAdapter'
import { summarizeCircuit, type PartInfo } from './circuitSummary'
import { ensureParts, getPart, PART_MANIFEST, viewFor } from './partsLibrary'

const MAX_PART_HITS = 12
const MAX_PINS_LISTED = 40

function partInfo(type: string): PartInfo | undefined {
  const def = getPart(type)
  if (!def) return undefined
  return { label: def.label, breadboard: isBreadboard(type) || !!def.buses?.length }
}

function pinNames(type: string): string[] {
  const def = getPart(type)
  return def ? Object.keys(viewFor(def, 'breadboard')?.pins ?? {}) : []
}

export async function inspectCircuitText(text: string): Promise<string> {
  const { doc, migrated, warnings } = parseCircuitFile(text)
  await initPartsLibrary()
  await ensureParts(doc.parts.map((p) => p.type))
  const nets = buildNets(doc, {
    busesFor: circuitBuses,
    implicit: implicitSeats(doc).map((s): [string, string] => [s.pin, s.hole])
  })
  const notes = [...warnings]
  if (migrated) {
    notes.push(
      'This is a v1 diagram.json. The Circuit view converts it to circuit.json the first time it opens.'
    )
  }
  return summarizeCircuit(doc, nets, partInfo, notes)
}

export async function findParts(query: string): Promise<string> {
  await initPartsLibrary()
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = PART_MANIFEST.filter((m) => {
    const hay = `${m.type} ${m.label} ${m.family}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
  if (matches.length === 0) {
    return `No parts match "${query}". Try one broader word, like "led", "sensor" or "button".`
  }
  const hits = matches.slice(0, MAX_PART_HITS)
  await ensureParts(hits.map((m) => m.type))
  const lines = hits.map((m) => {
    const pins = pinNames(m.type)
    const shown = pins.slice(0, MAX_PINS_LISTED).join(', ')
    const more = pins.length > MAX_PINS_LISTED ? ` … +${pins.length - MAX_PINS_LISTED} more` : ''
    return `- ${m.type} — ${m.label} (${m.family})\n  pins: ${pins.length ? shown + more : 'unknown'}`
  })
  if (matches.length > hits.length) {
    lines.push(`(${matches.length - hits.length} more matches — narrow the query to see them)`)
  }
  return lines.join('\n')
}
