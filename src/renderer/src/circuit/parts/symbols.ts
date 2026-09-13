/**
 * circuit/parts/symbols — schematic symbol resolution (spec §5.1, §8).
 *
 * A part's schematic art is resolved in this order:
 *   1. a hand-authored standard symbol from the symbol library (the IEEE-style
 *      zigzag resistor, capacitor plates, diode triangle, BJT, source circles…)
 *   2. the part file's own schematic view, normalised to our ink weight, font
 *      and scale so an imported Fritzing symbol doesn't sit on the sheet at a
 *      different size and line weight than everything around it
 *   3. a generated IC-style box symbol: type label on top, pins distributed
 *      left/right in definition order, pin names inked inside the body
 *
 * Step 3 guarantees the schematic view (and, later, KiCad export) never blocks
 * on missing artwork.
 *
 * Everything here draws with the tokens in parts/style.ts, so line weight,
 * font and pin pitch are identical across all three paths. Ink is a CSS
 * variable so symbols follow the tinyStudio theme; the image exporter inlines
 * it at export time (resolveCssVars).
 *
 * Pin positions land on the 9.6 px major grid (spec §4 pin-on-grid contract).
 */

import type { PartDef, PartView } from '../../lib/partsLibrary'
import { normalizeAuthoredSymbol } from './normalizeSymbol'
import { SYMBOLS, SYMBOL_BY_TYPE, bindSymbol, symbolIdForKeywords } from './symbolLibrary'
import {
  FONT_PIN,
  FONT_SYMBOL,
  INK,
  PIN_LEAD,
  SCH_GRID,
  STROKE,
  line,
  round,
  symbolSvg,
  text
} from './style'

const P = SCH_GRID // 9.6 — schematic major grid

const cache = new Map<string, PartView>()

/** The pin names a symbol has to account for, in the part's own order. */
function pinNamesOf(def: PartDef): string[] {
  const source = def.views.schematic?.pins ?? def.views.breadboard?.pins ?? {}
  return Object.keys(source)
}

/**
 * Schematic art for a part, resolved in preference order (see the module
 * header). Cached per type — resolution walks several fallbacks and every
 * render of every instance asks for it.
 */
export function schematicVisual(def: PartDef): PartView {
  const hit = cache.get(def.type)
  if (hit) return hit
  const v = resolveSchematic(def)
  cache.set(def.type, v)
  return v
}

/**
 * Parts whose own schematic art is technically fine but unusable on a shared
 * sheet: a 7-segment display drawn as a 4x8 LED matrix is twenty times the
 * size of the diode beside it, and the breakout modules ship overlapping
 * coloured captions. A generated box symbol is both smaller and clearer.
 */
const PREFER_BOX = new Set([
  '7segment-100-cat',
  'servo',
  'ir-receiver-v14',
  'voltage-regulator-7805'
])

function resolveSchematic(def: PartDef): PartView {
  const pins = pinNamesOf(def)

  // 1. a hand-authored standard symbol for this exact part
  const id = SYMBOL_BY_TYPE[def.type]
  if (id && SYMBOLS[id]) {
    const bound = bindSymbol(SYMBOLS[id], pins)
    if (bound) return bound
  }

  // 2. the part's own schematic art, re-inked to the sheet's weight and type
  if (def.views.schematic && !PREFER_BOX.has(def.type))
    return normalizeAuthoredSymbol(def.views.schematic)

  // 3. no art at all: a standard symbol beats a box if we can identify the part
  const guess = symbolIdForKeywords(
    `${def.type} ${def.simFamily ?? ''} ${def.family ?? ''} ${def.label}`
  )
  if (guess && SYMBOLS[guess]) {
    const bound = bindSymbol(SYMBOLS[guess], pins)
    if (bound) return bound
  }

  // 4. generated IC-style box — never blocks on missing artwork
  return generateBoxSymbol(def)
}

/** Drop cached symbol art (part re-registered, e.g. edited in the Parts Editor). */
export function invalidateSymbol(type?: string): void {
  if (type) cache.delete(type)
  else cache.clear()
}

export function generateBoxSymbol(def: PartDef): PartView {
  const source = def.views.breadboard?.pins ?? {}
  const names = Object.keys(source)
  // pin order: definition order; left gets the first half, right the rest
  const nLeft = Math.ceil(names.length / 2)
  const left = names.slice(0, nLeft)
  const right = names.slice(nLeft)
  const rows = Math.max(left.length, right.length, 1)

  const stub = PIN_LEAD // lead length from body to pin tip
  const title = def.label || def.type
  // The body has to hold the widest LEFT name and the widest RIGHT name side
  // by side without them colliding in the middle, and the whole symbol has to
  // be wide enough that the title above it isn't clipped by the viewBox.
  const gutter = 4
  const inner = textWidth(widest(left), FONT_PIN) + textWidth(widest(right), FONT_PIN) + P * 2
  const bodyW = Math.max(P * 4, Math.ceil(inner / P) * P)
  const bodyH = P * (rows + 1)
  const w = Math.max(bodyW + stub * 2, textWidth(title, FONT_SYMBOL) + gutter * 2)
  const h = bodyH + P // headroom for the label

  const pins: Record<string, [number, number]> = {}
  const parts: string[] = []
  const bodyX = (w - bodyW) / 2
  const bodyY = P

  parts.push(
    `<rect x="${round(bodyX)}" y="${bodyY}" width="${round(bodyW)}" height="${bodyH}" rx="2" fill="none" stroke="${INK}" stroke-width="${STROKE}"/>`,
    text(w / 2, bodyY - 3, title, { size: FONT_SYMBOL, anchor: 'middle' })
  )

  left.forEach((name, i) => {
    const y = bodyY + P * (i + 1)
    pins[name] = [0, y]
    parts.push(line(0, y, bodyX, y), text(bodyX + gutter, y + 2.6, name, { size: FONT_PIN }))
  })
  right.forEach((name, i) => {
    const y = bodyY + P * (i + 1)
    pins[name] = [w, y]
    parts.push(
      line(bodyX + bodyW, y, w, y),
      text(bodyX + bodyW - gutter, y + 2.6, name, { size: FONT_PIN, anchor: 'end' })
    )
  })

  return { svg: symbolSvg(parts.join(''), w, h), w, h, pins }
}

/**
 * Rough advance width of a string at a font size. The renderer has no text
 * metrics (this runs in a worker and under node too), and 0.58 em is a good
 * average for the sans stack across mixed-case pin names — erring wide, since
 * a slightly roomy box is invisible and a tight one collides.
 */
function textWidth(s: string, size: number): number {
  return s.length * size * 0.58
}

function widest(names: string[]): string {
  return names.reduce((m, n) => (n.length > m.length ? n : m), '')
}
