/**
 * circuit/core/refdes: reference-designator assignment (R1, C2, LED3, U4…).
 * Part ids ARE refdes in circuit.json v2 (§6.4 of the tech spec).
 */

import type { CircuitDoc, ViewId } from './model'

/** Family → prefix map (extended by PartDef.prefix when the registry knows better). */
const FAMILY_PREFIX: Record<string, string> = {
  passive: 'R',
  resistor: 'R',
  capacitor: 'C',
  inductor: 'L',
  diode: 'D',
  led: 'LED',
  transistor: 'Q',
  mosfet: 'Q',
  ic: 'U',
  microcontroller: 'U',
  board: 'U',
  switch: 'SW',
  button: 'SW',
  connector: 'J',
  battery: 'BT',
  source: 'V',
  breadboard: 'BB',
  label: 'NL',
  probe: 'P'
}

export function prefixForFamily(family?: string, explicit?: string): string {
  if (explicit) return explicit
  if (!family) return 'P'
  const f = family.toLowerCase()
  // longest key first: "breadboard" must win over "board" (BB1, not U1)
  const keys = Object.keys(FAMILY_PREFIX).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (f.includes(key)) return FAMILY_PREFIX[key]
  }
  return 'P'
}

/** Next free refdes for a prefix: R1, R2, … (fills gaps only via renumberAll). */
export function nextRefdes(doc: CircuitDoc, prefix: string): string {
  let max = 0
  const re = new RegExp(`^${escapeRe(prefix)}(\\d+)$`)
  for (const p of doc.parts) {
    const m = re.exec(p.id)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `${prefix}${max + 1}`
}

export function isValidRefdes(id: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(id)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Assign conventional reference designators to every part in the document.
 *
 * A circuit migrated from a v1 `diagram.json` keeps whatever ids that file
 * used: Fritzing/Wokwi slugs like `led`, `resistor`, `battery-aa_y90`. Those
 * ids ARE what the schematic prints beside each symbol, so a migrated sheet
 * reads like a directory listing instead of a schematic. Renumbering rewrites
 * them to R1, C2, D3, LED4, U5…
 *
 * Order follows how a schematic is read: top to bottom, left to right, with
 * rows banded so parts that sit at roughly the same height number left to
 * right rather than by sub-pixel y. Parts already named correctly still get
 * renumbered; partial renumbering is what produces R1, R7, R12 gaps.
 *
 * Returns a mapping of old id → new id, excluding parts whose id doesn't
 * change; an empty result means there was nothing to do.
 */
export function renumberAll(
  doc: CircuitDoc,
  prefixOf: (type: string) => string,
  view: ViewId = 'sch'
): Record<string, string> {
  const ROW_BAND = 48 // px, parts within this band count as the same row
  const ordered = [...doc.parts].sort((a, b) => {
    const pa = a[view] ?? a.bb ?? a.sch
    const pb = b[view] ?? b.bb ?? b.sch
    if (!pa && !pb) return a.id.localeCompare(b.id)
    if (!pa) return 1
    if (!pb) return -1
    const rowA = Math.round(pa.y / ROW_BAND)
    const rowB = Math.round(pb.y / ROW_BAND)
    if (rowA !== rowB) return rowA - rowB
    return pa.x - pb.x
  })

  const counters: Record<string, number> = {}
  const mapping: Record<string, string> = {}
  for (const part of ordered) {
    const prefix = prefixOf(part.type)
    counters[prefix] = (counters[prefix] ?? 0) + 1
    const next = `${prefix}${counters[prefix]}`
    if (next !== part.id) mapping[part.id] = next
  }
  return mapping
}

/** True when an id looks like a part-file slug rather than a refdes. */
export function looksLikeSlug(id: string): boolean {
  return /[_-]/.test(id) || /^[a-z]+$/.test(id) || /\d{3,}/.test(id)
}
