/**
 * circuit/core/refdes — reference-designator assignment (R1, C2, LED3, U4…).
 * Part ids ARE refdes in circuit.json v2 (§6.4 of the tech spec).
 */

import type { CircuitDoc } from './model'

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
  label: 'NL'
}

export function prefixForFamily(family?: string, explicit?: string): string {
  if (explicit) return explicit
  if (!family) return 'P'
  const f = family.toLowerCase()
  for (const key of Object.keys(FAMILY_PREFIX)) {
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
