/**
 * circuit/parts/symbolDraft: the parts editor's Symbol mode, as data.
 *
 * A draft is a body (rectangle, circle or right-pointing triangle, with a fill
 * choice), a name, and pins placed by side and grid slot. `renderDraft` turns
 * it into a schematic SVG that goes through the parts pipeline like any
 * hand-drawn file: black ink the app re-inks to the theme
 * (normalizeSymbol), pin tips on the 0.1 in grid, and every pin as an
 * invisible `pin-<NAME>` circle at its tip, so scanPins reads the pins back
 * from the art and Illustrator can still open the file.
 *
 * Geometry is in px @ 96 DPI on the schematic grid P (9.6 px = 0.1 in). The
 * body spans `w` × `h` grid squares and sits one square in from every edge,
 * leaving room for the pin leads; pins occupy the interior grid lines of
 * their side (slot 1 … side length − 1), never the corners.
 *
 * Pure: no DOM, so it runs under node --test.
 */

import type { PartView } from '../../lib/partsLibrary'
import { FONT_PIN, FONT_SYMBOL, PIN_LEAD, SCH_GRID, STROKE, escapeXml } from './style'

export type SymbolShape = 'rect' | 'circle' | 'triangle'
export type SymbolFill = 'none' | 'white' | 'yellow'
export type PinSide = 'L' | 'R' | 'T' | 'B'

export interface DraftPin {
  name: string
  side: PinSide
  /** grid slot along the side, 1-based; slot k sits k squares from the top-left */
  pos: number
}

export interface SymbolDraft {
  name: string
  shape: SymbolShape
  fill: SymbolFill
  /** body width in grid squares */
  w: number
  /** body height in grid squares */
  h: number
  pins: DraftPin[]
}

const P = SCH_GRID
export const MIN_BODY = 2
export const MAX_BODY = 30

const FILLS: Record<SymbolFill, string> = { none: 'none', white: '#ffffff', yellow: '#fff3b8' }
/** Ink in the saved file; the app repaints it to the theme when it loads the art. */
const INK = '#000000'

const round = (n: number): number => Math.round(n * 100) / 100

/** How many pin slots a side has: one per interior grid line. */
export function sideLength(draft: SymbolDraft, side: PinSide): number {
  return (side === 'L' || side === 'R' ? draft.h : draft.w) - 1
}

/**
 * Rough advance width of a string at a font size: 0.58 em per character is a
 * fair average for the sans stack, erring wide (a roomy body is invisible, a
 * tight one collides). The same heuristic the generated box symbols use.
 */
const textWidth = (s: string, size: number): number => s.length * size * 0.58

/**
 * The generated-box layout for a set of pin names: the first half down the
 * left side, the rest down the right, tall enough to hold the longer column
 * and wide enough that the longest left and right names don't meet.
 */
export function draftFromPins(names: string[], name: string): SymbolDraft {
  const nLeft = Math.ceil(names.length / 2)
  const rows = Math.max(nLeft, names.length - nLeft, 1)
  const pins: DraftPin[] = names.map((n, i) =>
    i < nLeft ? { name: n, side: 'L', pos: i + 1 } : { name: n, side: 'R', pos: i - nLeft + 1 }
  )
  const widest = (list: string[]): number => Math.max(0, ...list.map((n) => textWidth(n, FONT_PIN)))
  const inner = widest(names.slice(0, nLeft)) + widest(names.slice(nLeft)) + 2 * P
  const w = Math.max(4, Math.ceil(inner / P))
  return { name, shape: 'rect', fill: 'none', w, h: rows + 1, pins }
}

/**
 * A draft that approximates existing schematic art: each pin goes to the
 * side of the bounding box it is nearest, in the order it appears there.
 */
export function draftFromView(view: PartView, name: string): SymbolDraft {
  const entries = Object.entries(view.pins)
  const w = Math.max(MIN_BODY, Math.min(MAX_BODY, Math.round(view.w / P) - 2))
  const h = Math.max(MIN_BODY, Math.min(MAX_BODY, Math.round(view.h / P) - 2))
  const bySide: Record<PinSide, { name: string; along: number }[]> = { L: [], R: [], T: [], B: [] }
  for (const [pinName, [x, y]] of entries) {
    const d = { L: x, R: view.w - x, T: y, B: view.h - y }
    const side = (Object.keys(d) as PinSide[]).reduce((a, b) => (d[b] < d[a] ? b : a))
    bySide[side].push({ name: pinName, along: side === 'L' || side === 'R' ? y : x })
  }
  const draft: SymbolDraft = { name, shape: 'rect', fill: 'none', w, h, pins: [] }
  for (const side of ['L', 'R', 'T', 'B'] as PinSide[]) {
    bySide[side].sort((a, b) => a.along - b.along)
    bySide[side].forEach((p, i) => draft.pins.push({ name: p.name, side, pos: i + 1 }))
  }
  return normalizeDraft(draft)
}

/**
 * Keep a draft well-formed: sizes in range (a circle is square), every pin on
 * a slot its side has, no two pins on one slot (the later one moves down).
 */
export function normalizeDraft(draft: SymbolDraft): SymbolDraft {
  let w = Math.max(MIN_BODY, Math.min(MAX_BODY, Math.round(draft.w)))
  let h = Math.max(MIN_BODY, Math.min(MAX_BODY, Math.round(draft.h)))
  if (draft.shape === 'circle') w = h = Math.max(w, h)
  const out: SymbolDraft = { ...draft, w, h, pins: [] }
  const taken = new Set<string>()
  for (const pin of draft.pins) {
    const len = sideLength(out, pin.side)
    let pos = Math.max(1, Math.min(len, Math.round(pin.pos) || 1))
    // find the nearest free slot on that side, looking down then up
    for (let step = 0; taken.has(`${pin.side}:${pos}`) && step < len * 2; step++) {
      const next = pos + (step % 2 === 0 ? step + 1 : -(step + 1))
      if (next >= 1 && next <= len) pos = next
    }
    if (taken.has(`${pin.side}:${pos}`)) continue // the side is full
    taken.add(`${pin.side}:${pos}`)
    out.pins.push({ name: pin.name, side: pin.side, pos })
  }
  return out
}

/** Overall art size in px. */
export function draftSize(draft: SymbolDraft): { w: number; h: number } {
  return { w: (draft.w + 2) * P, h: (draft.h + 2) * P }
}

/** Where a pin's tip lands, px from the art's top-left; always on the grid. */
export function pinTip(draft: SymbolDraft, pin: DraftPin): [number, number] {
  const { w, h } = draftSize(draft)
  // rounded the way scanPins reports positions, so the file reads back equal
  const along = round((pin.pos + 1) * P)
  switch (pin.side) {
    case 'L':
      return [0, along]
    case 'R':
      return [round(w), along]
    case 'T':
      return [along, 0]
    default:
      return [along, round(h)]
  }
}

/** Where the lead meets the body's outline. */
function attachPoint(draft: SymbolDraft, pin: DraftPin): [number, number] {
  const x0 = P
  const y0 = P
  const x1 = P + draft.w * P
  const y1 = P + draft.h * P
  const [tx, ty] = pinTip(draft, pin)
  if (draft.shape === 'circle') {
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const r = (x1 - x0) / 2
    if (pin.side === 'L' || pin.side === 'R') {
      const dy = ty - cy
      const dx = Math.sqrt(Math.max(0, r * r - dy * dy))
      return [pin.side === 'L' ? cx - dx : cx + dx, ty]
    }
    const dx = tx - cx
    const dy = Math.sqrt(Math.max(0, r * r - dx * dx))
    return [tx, pin.side === 'T' ? cy - dy : cy + dy]
  }
  if (draft.shape === 'triangle') {
    // vertices: top-left, bottom-left, apex at mid-right
    const ym = (y0 + y1) / 2
    if (pin.side === 'L') return [x0, ty]
    if (pin.side === 'R') {
      // on the slanted edge at this row (the apex row meets it at x1)
      const t = Math.abs(ty - ym) / (ym - y0)
      return [x1 - t * (x1 - x0), ty]
    }
    const t = (tx - x0) / (x1 - x0)
    return [tx, pin.side === 'T' ? y0 + t * (ym - y0) : y1 - t * (y1 - ym)]
  }
  if (pin.side === 'L') return [x0, ty]
  if (pin.side === 'R') return [x1, ty]
  return [tx, pin.side === 'T' ? y0 : y1]
}

/** The nearest slot to a point (px) on the art, for dragging pins. */
export function nearestSlot(
  draft: SymbolDraft,
  x: number,
  y: number
): { side: PinSide; pos: number } {
  const { w, h } = draftSize(draft)
  const d: Record<PinSide, number> = { L: x, R: w - x, T: y, B: h - y }
  const side = (Object.keys(d) as PinSide[]).reduce((a, b) => (d[b] < d[a] ? b : a))
  const along = side === 'L' || side === 'R' ? y : x
  const pos = Math.max(1, Math.min(sideLength(draft, side), Math.round(along / P) - 1))
  return { side, pos }
}

export interface RenderedDraft {
  svg: string
  w: number
  h: number
  pins: Record<string, [number, number]>
}

/** The draft as a schematic SVG file the parts pipeline reads back. */
export function renderDraft(input: SymbolDraft): RenderedDraft {
  const draft = normalizeDraft(input)
  const { w, h } = draftSize(draft)
  const x0 = P
  const y0 = P
  const x1 = P + draft.w * P
  const y1 = P + draft.h * P
  const fill = FILLS[draft.fill]
  const parts: string[] = []

  if (draft.shape === 'circle') {
    const r = (x1 - x0) / 2
    parts.push(
      `<circle cx="${round((x0 + x1) / 2)}" cy="${round((y0 + y1) / 2)}" r="${round(r)}" fill="${fill}" stroke="${INK}" stroke-width="${STROKE}"/>`
    )
  } else if (draft.shape === 'triangle') {
    parts.push(
      `<path d="M${round(x0)} ${round(y0)} L${round(x0)} ${round(y1)} L${round(x1)} ${round((y0 + y1) / 2)} Z" fill="${fill}" stroke="${INK}" stroke-width="${STROKE}" stroke-linejoin="round"/>`
    )
  } else {
    parts.push(
      `<rect x="${round(x0)}" y="${round(y0)}" width="${round(x1 - x0)}" height="${round(y1 - y0)}" rx="2" fill="${fill}" stroke="${INK}" stroke-width="${STROKE}"/>`
    )
  }

  const pins: Record<string, [number, number]> = {}
  for (const pin of draft.pins) {
    const [tx, ty] = pinTip(draft, pin)
    const [ax, ay] = attachPoint(draft, pin)
    pins[pin.name] = [tx, ty]
    parts.push(
      `<line x1="${round(tx)}" y1="${round(ty)}" x2="${round(ax)}" y2="${round(ay)}" stroke="${INK}" stroke-width="${STROKE}" stroke-linecap="round"/>`
    )
    const label =
      pin.side === 'L'
        ? `x="${round(ax + 4)}" y="${round(ay + 2.6)}"`
        : pin.side === 'R'
          ? `x="${round(ax - 4)}" y="${round(ay + 2.6)}" text-anchor="end"`
          : pin.side === 'T'
            ? `x="${round(ax)}" y="${round(ay + 9)}" text-anchor="middle"`
            : `x="${round(ax)}" y="${round(ay - 4)}" text-anchor="middle"`
    parts.push(
      `<text ${label} font-family="sans-serif" font-size="${FONT_PIN}" fill="${INK}">${escapeXml(pin.name)}</text>`
    )
    // the pin itself: an unpainted marker the parts pipeline reads
    parts.push(
      `<circle id="pin-${escapeXml(pin.name)}" cx="${round(tx)}" cy="${round(ty)}" r="1.6" fill="none" stroke="none"/>`
    )
  }

  if (draft.name.trim()) {
    // The name sits in the lead band above the body, like the generated box
    // symbols, unless top pins use that band; then below, or inside as a
    // last resort.
    const sides = new Set(draft.pins.map((p) => p.side))
    const cx = (x0 + x1) / 2
    const y = !sides.has('T') ? y0 - 3 : !sides.has('B') ? y1 + FONT_SYMBOL : (y0 + y1) / 2 + 3
    parts.push(
      `<text x="${round(cx)}" y="${round(y)}" text-anchor="middle" font-family="sans-serif" font-size="${FONT_SYMBOL}" font-weight="600" fill="${INK}">${escapeXml(draft.name.trim())}</text>`
    )
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(w)} ${round(h)}" width="${round(w)}" height="${round(h)}">` +
    `<!-- Drawn with tinyStudio's symbol editor. Pins are the circles named pin-<NAME>; the grid is ${P} px = 0.1 in. -->` +
    parts.join('') +
    `</svg>`
  return { svg, w: round(w), h: round(h), pins }
}

export { PIN_LEAD }
