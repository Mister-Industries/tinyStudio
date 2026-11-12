/**
 * circuit/export/kicadLibInfo: what a library symbol says about the part it
 * stands for: its value, SparkFun PROD_ID and datasheet. SparkFun's KiCad
 * symbols are one per stocked part ("10k_Axial_1/6W" is RES-08375), so the
 * PROD_ID only goes on a part whose value is that part's.
 */

import { KICAD_LIB_SYMBOLS } from './kicadSymbols.gen'

export interface LibInfo {
  value: string
  prodId: string
  datasheet: string
}

const field = (def: string, key: string): string => {
  const m = new RegExp(`\\(property "${key}" "((?:[^"\\\\]|\\\\.)*)"`).exec(def)
  return m ? m[1].replace(/\\"/g, '"') : ''
}

export function libInfo(symbol: string): LibInfo | null {
  const def = KICAD_LIB_SYMBOLS[symbol]
  if (!def) return null
  return {
    value: field(def, 'Value'),
    prodId: field(def, 'PROD_ID'),
    datasheet: /^https?:/.test(field(def, 'Datasheet')) ? field(def, 'Datasheet') : ''
  }
}

const norm = (v: string): string =>
  v
    .toLowerCase()
    .replace(/\s+|Ω|ohms?|linear/g, '')
    .replace(/^(\d+)(\.0+)?([kmu]?)$/, '$1$3')

/** Whether a part's own value is the stocked part's ("10k" vs the 10k symbol). */
export function sameValue(a: string, b: string): boolean {
  return norm(a) === norm(b)
}

/** A symbol pin's name ("A", "K"), or '' when it has none ("~") or isn't known. */
export function pinName(symbol: string, number: string): string {
  const def = KICAD_LIB_SYMBOLS[symbol]
  if (!def) return ''
  const re =
    /\(pin \w+ \w+\s(?:(?!\(pin )[\s\S])*?\(name "((?:[^"\\]|\\.)*)"(?:(?!\(pin )[\s\S])*?\(number "((?:[^"\\]|\\.)*)"/g
  let m
  while ((m = re.exec(def))) if (m[2] === number) return m[1] === '~' ? '' : m[1]
  return ''
}
