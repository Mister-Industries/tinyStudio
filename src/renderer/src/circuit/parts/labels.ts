/**
 * circuit/parts/labels — the text that rides beside a schematic symbol.
 *
 * A schematic is only half symbols; the other half is "R1" and "220 Ω". The
 * spec (§8) puts the reference designator above the symbol and the value
 * below it, and that is what makes a sheet readable at a glance: you find the
 * part by its refdes and read its behaviour off its value without opening an
 * inspector.
 *
 * The value shown is the value that will actually be SIMULATED. It comes from
 * the same `simAttrsFor` table the netlist generator uses, including the same
 * defaults — so a resistor the user never edited reads "220 Ω" on the sheet
 * and emits 220 Ω into SPICE. A sheet that showed nothing until you typed a
 * value would quietly lie about what the simulator is doing.
 *
 * Pure formatting, no React and no DOM: the canvas and the image exporter both
 * render from this, so the exported PNG matches the screen.
 */

import { simAttrsFor } from '../core/netlist'
import type { CircuitPart } from '../core/model'
import { defaultAttrsFor } from './naming'
import { FONT_REFDES } from './style'

/** SPICE magnitude suffix → the prefix a human expects to read. */
const PREFIX: Record<string, string> = {
  t: 'T',
  g: 'G',
  meg: 'M',
  k: 'k',
  m: 'm',
  u: 'µ',
  n: 'n',
  p: 'p',
  f: 'f'
}

/** Units we're willing to print. Everything else (0–1, true/false) is a
 * setting, not a value, and belongs in the inspector rather than on the sheet. */
const PRINTABLE_UNIT = /^(V|A|Ω|F|H|Hz|W|s)$/

/**
 * Render a SPICE-style value with its unit: ("100n", "F") → "100 nF",
 * ("10k", "Ω") → "10 kΩ", ("5", "V") → "5 V".
 */
export function formatValue(raw: string, unit: string): string {
  const m = /^\s*(-?[\d.]+(?:[eE][-+]?\d+)?)\s*(Meg|meg|[a-zA-Z])?\s*$/.exec(String(raw))
  if (!m) return `${String(raw).trim()} ${unit}`.trim()
  const n = m[1]
  const suffix = m[2] ? PREFIX[m[2].toLowerCase()] : ''
  // an unrecognised suffix is probably already a unit ("5V") — don't double it
  if (m[2] && suffix === undefined) return `${n} ${unit}`
  return `${n} ${suffix ?? ''}${unit}`.replace(/\s+/g, ' ').trim()
}

/** The reference designator drawn above the symbol (R1, C3, LED2…). */
export function refdesOf(part: CircuitPart): string {
  return String(part.attrs?.label ?? part.id)
}

/**
 * The value line drawn below the symbol, or '' when the part has no value
 * worth printing (a board, an LED, a bare diode). Sources print two terms —
 * a sine source is meaningless without both amplitude and frequency.
 */
export function valueOf(part: CircuitPart, simFamily?: string): string {
  const specs = simAttrsFor(part.type, simFamily ?? '')
  if (!specs.length) return ''
  const terms: string[] = []
  const partDefaults = defaultAttrsFor(part.type)
  for (const spec of specs) {
    const unit = (spec.hint ?? '').split(/\s+/)[0]
    if (!PRINTABLE_UNIT.test(unit)) continue
    const raw = part.attrs?.[spec.key] ?? partDefaults?.[spec.key]
    const value = raw === undefined || raw === '' ? spec.default : String(raw)
    if (value === undefined || value === '') continue
    // a zero DC offset is noise on the sheet, not information
    if (spec.key === 'offset' && parseFloat(value) === 0) continue
    terms.push(formatValue(value, unit))
    if (terms.length === 2) break
  }
  return terms.join(' ')
}

/** The on-screen box a symbol occupies once its placement rotation is applied. */
export interface VisibleBox {
  /** Offset from the placement origin to the visible top-left. */
  left: number
  top: number
  w: number
  h: number
}

/**
 * Where a rotated symbol actually sits. Rotation happens about the symbol's
 * centre, so a 90°-turned part keeps its placement origin but its ink moves:
 * a 57.6 x 19.2 resistor stood on end covers 19.2 x 57.6, offset up and right.
 * Labels anchor to THIS box, not the unrotated one — otherwise a vertical
 * part's value text lands on top of the wire running past it.
 */
export function visibleBox(w: number, h: number, rotate?: number): VisibleBox {
  const quarter = rotate === 90 || rotate === 270
  if (!quarter) return { left: 0, top: 0, w, h }
  return { left: (w - h) / 2, top: (h - w) / 2, w: h, h: w }
}

/** Gap between a symbol's visible edge and its text. */
const GAP = 5

export interface LabelLayout {
  /** The box the symbol visibly occupies, offset from the placement origin. */
  box: VisibleBox
  /** True when the part runs vertically, so text sits beside it rather than under. */
  side: boolean
  /** Top-left of the refdes text block, offset from the placement origin. */
  refdes: [number, number]
  /** Top-left of the value text block. */
  value: [number, number]
}

/**
 * Where a symbol's refdes and value go.
 *
 * The deciding factor is which way the part's PINS run, not its rotation: a
 * source drawn tall (pins top and bottom) and a resistor turned on its end are
 * the same problem. Text under a vertical part lands on the wire leaving its
 * bottom pin, so vertical parts get their text stacked beside them — which is
 * also what every schematic tool does, and what a reader expects.
 */
export function labelLayout(
  w: number,
  h: number,
  pins: Record<string, [number, number]>,
  rotate?: number
): LabelLayout {
  const box = visibleBox(w, h, rotate)
  const xs = Object.values(pins).map(([x]) => x)
  const ys = Object.values(pins).map(([, y]) => y)
  let spreadX = xs.length ? Math.max(...xs) - Math.min(...xs) : 0
  let spreadY = ys.length ? Math.max(...ys) - Math.min(...ys) : 0
  if (rotate === 90 || rotate === 270) [spreadX, spreadY] = [spreadY, spreadX]
  const side = spreadY > spreadX

  if (side) {
    const x = box.left + box.w + GAP
    const mid = box.top + box.h / 2
    return {
      box,
      side,
      refdes: [x, mid - FONT_REFDES - 2],
      value: [x, mid + 2]
    }
  }
  return {
    box,
    side,
    refdes: [box.left, box.top - (FONT_REFDES + GAP)],
    value: [box.left, box.top + box.h + 3]
  }
}
