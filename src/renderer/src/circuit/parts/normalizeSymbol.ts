/**
 * circuit/parts/normalizeSymbol — make an imported schematic symbol behave.
 *
 * Parts we don't ship a hand-authored symbol for still have to sit on the same
 * sheet as the ones we do. Their art comes from whoever drew the Fritzing part,
 * and it arrives with three problems:
 *
 *  1. **Hairline strokes.** Fritzing schematic SVGs are authored in inch-based
 *     viewBox units — a typical `stroke-width="0.1524"` in a viewBox that maps
 *     ~3.8 units to the pixel renders as a 0.58 px line. Next to our 2 px
 *     symbols it disappears.
 *  2. **Baked-in colour and type.** Pin names in blue, part names in orange,
 *     `font-family="OCRA"` — none of it follows the app theme, and none of it
 *     matches the rest of the sheet.
 *  3. **Half-a-stroke offsets.** Pin pitch is almost always already correct
 *     (0.1 in = our 9.6 px grid), but the whole drawing sits shifted by the
 *     stroke's half-width, so pins land at 0.47 rather than 0.
 *
 * So: restroke to the shared weight, repaint to theme ink, re-set the type
 * stack, and nudge the drawing onto the grid. Deliberately NOT rescaled —
 * the pitch is right, and scaling would take the pins off-grid to fix a
 * problem that isn't there.
 *
 * Pure string work, no DOM: this runs in the renderer, in the web build and
 * under `node --test` alike.
 */

import type { PartView } from '../../lib/partsLibrary'
import { FONT, FONT_PIN, INK, SCH_GRID, STROKE } from './style'

const P = SCH_GRID

/** Colour keywords that mean "don't paint" and must survive untouched. */
const NO_PAINT = /^(none|transparent)$/i

function round(n: number, places = 4): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}

/** viewBox width of an SVG string, if it declares one. */
function viewBoxWidth(svg: string): number | null {
  const m = /viewBox\s*=\s*"([^"]+)"/i.exec(svg)
  if (!m) return null
  const parts = m[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  return parts.length === 4 && Number.isFinite(parts[2]) && parts[2] > 0 ? parts[2] : null
}

/**
 * Re-ink an SVG: our stroke weight, our ink, our type stack. `unitScale`
 * converts pixels into the drawing's own viewBox units, so a symbol authored
 * in inches ends up with the same ON-SCREEN weight as one authored in pixels.
 */
export function reinkSvg(svg: string, unitScale: number): string {
  const stroke = round(STROKE * unitScale)
  const fontSize = round(FONT_PIN * unitScale)

  let out = svg

  // stroke width, attribute and inline-style forms
  out = out.replace(/stroke-width\s*=\s*"[^"]*"/gi, `stroke-width="${stroke}"`)
  out = out.replace(/stroke-width\s*:\s*[^;"']+/gi, `stroke-width:${stroke}`)

  // stroke colour — leave "none"/"transparent" alone or shapes lose their fill-only look
  out = out.replace(/stroke\s*=\s*"([^"]*)"/gi, (all, c) =>
    NO_PAINT.test(String(c).trim()) ? all : `stroke="${INK}"`
  )
  out = out.replace(/([;"'\s])stroke\s*:\s*([^;"']+)/gi, (all, lead, c) =>
    NO_PAINT.test(String(c).trim()) ? all : `${lead}stroke:${INK}`
  )

  // text: one type stack, one ink, sized in the drawing's units
  out = out.replace(/<text\b([^>]*)>/gi, (_all, attrs: string) => {
    const kept = String(attrs)
      .replace(/\s(font-family|font-size|fill|stroke|style|font-weight)\s*=\s*"[^"]*"/gi, '')
      .trim()
    return (
      `<text ${kept}${kept ? ' ' : ''}font-family="${FONT}" font-size="${fontSize}" ` +
      `fill="${INK}" stroke="none">`
    )
  })

  return out
}

/**
 * Offset that brings a set of pins onto the major grid. Fritzing art is
 * uniformly shifted (usually by half a stroke), so one translation fixes every
 * pin at once — we take the average correction rather than snapping each pin
 * independently, which would slide pins off the art they belong to.
 */
export function gridAlignOffset(pins: Record<string, [number, number]>): [number, number] {
  const vals = Object.values(pins)
  if (!vals.length) return [0, 0]
  const correct = (n: number): number => {
    const d = Math.round(n / P) * P - n
    // ignore pins that are nowhere near a grid line — they'd skew the average
    return Math.abs(d) <= P / 2 ? d : 0
  }
  const dx = vals.reduce((s, [x]) => s + correct(x), 0) / vals.length
  const dy = vals.reduce((s, [, y]) => s + correct(y), 0) / vals.length
  return [round(dx, 2), round(dy, 2)]
}

/**
 * Normalise an authored schematic view: shared ink weight, shared type, pins
 * nudged onto the grid. Returns a new PartView; the input is untouched.
 */
export function normalizeAuthoredSymbol(v: PartView): PartView {
  const vbw = viewBoxWidth(v.svg)
  // viewBox units per pixel — 1 when the art is already authored in px
  const unitScale = vbw && v.w > 0 ? vbw / v.w : 1

  const [dx, dy] = gridAlignOffset(v.pins)
  const inked = reinkSvg(v.svg, unitScale)

  // The translate has to happen in viewBox units, inside the svg, so the art
  // and its pins move together.
  const shifted =
    dx || dy
      ? inked.replace(
          /(<svg\b[^>]*>)/i,
          `$1<g transform="translate(${round(dx * unitScale, 3)},${round(dy * unitScale, 3)})">`
        ) + ''
      : inked
  const closed = dx || dy ? shifted.replace(/<\/svg>\s*$/i, '</g></svg>') : shifted

  const pins: Record<string, [number, number]> = {}
  for (const [name, [x, y]] of Object.entries(v.pins)) {
    pins[name] = [round(x + dx, 2), round(y + dy, 2)]
  }

  return {
    ...v,
    svg: closed,
    w: round(v.w + Math.max(0, dx), 2),
    h: round(v.h + Math.max(0, dy), 2),
    pins
  }
}
