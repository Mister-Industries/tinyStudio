/**
 * circuit/export/common: what every exporter needs to know about a part
 * besides the document itself, plus the shared value and ordering rules.
 */

import type { CircuitPart } from '../core/model'
import { simAttrsFor } from '../core/netlist'
import { defaultAttrsFor } from '../parts/naming'

export interface ExportContext {
  /** keyword family for SPICE/value matching (PartDef.simFamily ?? family) */
  familyOf?: (type: string) => string | undefined
  /** human part name, for the BOM and generic components */
  labelOf?: (type: string) => string | undefined
  /** the part's pin names in definition order */
  pinsOf?: (type: string) => string[]
  /** ISO date stamped into file headers; injectable so tests are stable */
  date?: string
}

/**
 * The value a schematic or BOM should carry: the part's primary simulation
 * attribute as typed ("10k", "4.7u"), unit symbols dropped, or the part's
 * name when it has no value (an LED, a board).
 */
export function exportValue(part: CircuitPart, ctx: ExportContext): string {
  const specs = simAttrsFor(part.type, ctx.familyOf?.(part.type) ?? '')
  const defaults = defaultAttrsFor(part.type)
  for (const spec of specs) {
    const raw = part.attrs?.[spec.key] ?? defaults?.[spec.key] ?? spec.default
    // a state (a switch's "pressed") isn't a value
    if (
      raw === undefined ||
      raw === '' ||
      typeof raw === 'boolean' ||
      /^(true|false)$/.test(String(raw))
    )
      continue
    return String(raw)
      .replace(/\s+/g, '')
      .replace(/(Ω|ohms?)$/i, '')
  }
  return ctx.labelOf?.(part.type) ?? part.type
}

/** R2 before R10: refdes prefix alphabetically, then the number numerically. */
export function compareRefs(a: string, b: string): number {
  const ma = /^(.*?)(\d+)$/.exec(a)
  const mb = /^(.*?)(\d+)$/.exec(b)
  if (ma && mb && ma[1] === mb[1]) return Number(ma[2]) - Number(mb[2])
  return a.localeCompare(b)
}

export function today(ctx: ExportContext): string {
  return ctx.date ?? new Date().toISOString().slice(0, 10)
}
