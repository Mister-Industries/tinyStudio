/**
 * circuit/parts/resistorBands — resistor color-code decoration.
 *
 * The Fritzing resistor art carries clean band ids (`band_1_st`, `band_2_nd`,
 * `band_rd_multiplier`; `gold_band` is tolerance and stays gold). When a part
 * has a `resistance` attr we recolor those bands to the 4-band code, so the
 * breadboard art always tells the truth about the value. Pure string work
 * (regex on the id'd elements), cached per (svg, value).
 */

/** "4.7k", "220", "1M", "10 Ω" → ohms (number), or null if unparseable. */
export function parseOhms(v: string | number | boolean | undefined): number | null {
  if (v === undefined || typeof v === 'boolean') return null
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  const s = v
    .trim()
    .replace(/[ΩΩ]|ohms?/gi, '')
    .replace(/\s+/g, '')
  const m = /^([0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)(Meg|meg|MEG|[GgkKMmunp])?$/.exec(s)
  if (!m) return null
  const base = parseFloat(m[1])
  const suffix = m[2]
  const mult = !suffix
    ? 1
    : /^meg$/i.test(suffix)
      ? 1e6
      : { G: 1e9, g: 1e9, k: 1e3, K: 1e3, M: 1e6, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 }[
          suffix as 'G' | 'g' | 'k' | 'K' | 'M' | 'm' | 'u' | 'n' | 'p'
        ]
  const ohms = base * (mult ?? 1)
  return Number.isFinite(ohms) && ohms > 0 ? ohms : null
}

/** IEC 60062 digit colors 0–9 (hexes tuned to the Fritzing art palette). */
export const DIGIT_COLORS = [
  '#000000', // 0 black
  '#8A3D06', // 1 brown
  '#C40808', // 2 red
  '#E87800', // 3 orange
  '#F5D100', // 4 yellow
  '#189E30', // 5 green
  '#2456D6', // 6 blue
  '#7C2BC1', // 7 violet
  '#8C8C8C', // 8 grey
  '#F5F5F5' // 9 white
] as const

const GOLD = '#AD9F4E'
const SILVER = '#BFBFBF'

export interface BandColors {
  d1: string
  d2: string
  mult: string
}

/** 4-band colors for a value (two significant digits + multiplier). */
export function bandColorsFor(ohms: number): BandColors | null {
  if (!Number.isFinite(ohms) || ohms <= 0) return null
  let exp = Math.floor(Math.log10(ohms)) - 1
  let sig = Math.round(ohms / Math.pow(10, exp))
  if (sig >= 100) {
    sig = Math.round(sig / 10)
    exp += 1
  }
  if (sig < 10) {
    // values < 10 Ω land here (e.g. 4.7 → sig 47, exp −1 — already handled);
    // a degenerate rounding can still under-run, renormalize
    sig *= 10
    exp -= 1
  }
  const d1 = Math.floor(sig / 10)
  const d2 = sig % 10
  let mult: string
  if (exp >= 0 && exp <= 9) mult = DIGIT_COLORS[exp]
  else if (exp === -1) mult = GOLD
  else if (exp === -2) mult = SILVER
  else return null
  return { d1: DIGIT_COLORS[d1], d2: DIGIT_COLORS[d2], mult }
}

const BAND_IDS: [keyof BandColors, string][] = [
  ['d1', 'band_1_st'],
  ['d2', 'band_2_nd'],
  ['mult', 'band_rd_multiplier']
]

/** True when this art carries recolorable band elements. */
export function hasResistorBands(svg: string): boolean {
  return svg.includes('band_1_st')
}

const cache = new Map<string, string>()

/** Recolor the value bands of resistor art for a given resistance attr.
 * Unparseable/absent values return the art untouched. */
export function decorateResistor(
  svg: string,
  resistance: string | number | boolean | undefined
): string {
  const ohms = parseOhms(resistance)
  if (ohms === null || !hasResistorBands(svg)) return svg
  const colors = bandColorsFor(ohms)
  if (!colors) return svg
  const key = `${colors.d1}|${colors.d2}|${colors.mult}|${svg.length}|${svg.slice(0, 64)}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  let out = svg
  for (const [slot, id] of BAND_IDS) {
    out = out.replace(
      new RegExp(`(<[^>]*\\bid="${id}"[^>]*?\\bfill=")[^"]*(")`),
      `$1${colors[slot]}$2`
    )
  }
  cache.set(key, out)
  return out
}
