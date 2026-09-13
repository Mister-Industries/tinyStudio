/**
 * circuit/parts/style — the schematic drawing tokens.
 *
 * Everything that draws schematic ink — generated symbols, the hand-authored
 * symbol library, net labels, sources, probes, annotations, the canvas overlay
 * and the image exporter — pulls its stroke widths, ink colour, fonts and
 * grid pitch from here. Before this existed each module picked its own (2 px
 * here, 1.2 px there, `monospace` in one place and the UI font in another),
 * which is why symbols looked like they came from four different programs.
 *
 * The look is the conventional US/IEEE schematic style the tech spec asks for
 * (§8): black ink on paper, uniform 2 px bodies, thinner pin leads, sans-serif
 * refdes and value text, everything on the 9.6 px major grid.
 *
 * Colours are CSS variables so symbols follow the tinyStudio theme; the image
 * exporter inlines them at export time (resolveCssVars).
 */

import { GRID_BB, GRID_SCH } from '../core/model'

/** Major grid — pin pitch. Every pin tip lands on a multiple of this. */
export const SCH_GRID = GRID_BB // 9.6
/** Fine grid — the snap used for wire bends and annotation handles. */
export const SCH_FINE = GRID_SCH // 4.8

/** Schematic ink (theme-aware; inlined on export). */
export const INK = 'var(--text-strong)'
/** Secondary ink — pin names, unit suffixes, anything supporting. */
export const INK_MUTED = 'var(--text-muted)'
/** Selection / probe accent. */
export const ACCENT = 'var(--brand)'
/** Fill for symbol bodies that are closed shapes (IC boxes, meter circles). */
export const BODY_FILL = 'none'

/** Symbol body stroke — the single weight every symbol outline uses. */
export const STROKE = 2
/** Pin lead stroke: same weight as the body, so a lead reads as one line. */
export const PIN_STROKE = 2
/** Schematic wire stroke. Matches PIN_STROKE so a wire continues a lead. */
export const WIRE_STROKE = 2
/** Junction dot radius (a filled dot where 3+ wires meet). */
export const JUNCTION_R = 3.2
/** Standard pin lead length from the body edge to the connection point. */
export const PIN_LEAD = SCH_GRID // 9.6 — one grid square

/** Type stack. Sans for everything; the schematic is not a code listing. */
export const FONT = 'var(--font-sans)'
/** Reference designator text (R1, C3, LED2). */
export const FONT_REFDES = 9
/** Value / parameter text (220 Ω, 10 µF, 1 kHz). */
export const FONT_VALUE = 9
/** Pin names inked inside an IC body. */
export const FONT_PIN = 7
/** Text drawn as part of a symbol (the `+` on a source, `A` in an ammeter). */
export const FONT_SYMBOL = 8
/** Net-label and power-rail names. */
export const FONT_NET = 8.5

/** Gap between a symbol's bounding box and its refdes/value text. */
export const LABEL_GAP = 4

/**
 * Wrap symbol body markup in a correctly-sized SVG. Every symbol in the
 * library goes through here so viewBox, namespace and shape-rendering are
 * identical across parts (mismatched viewBoxes are why imported symbols used
 * to render at wildly different sizes).
 */
export function symbolSvg(inner: string, w: number, h: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(w)} ${round(h)}" ` +
    `fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
  )
}

/** A body line/lead at the standard weight. */
export function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width = STROKE,
  ink = INK
): string {
  return (
    `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" ` +
    `stroke="${ink}" stroke-width="${width}"/>`
  )
}

/** A body path at the standard weight. */
export function path(d: string, width = STROKE, ink = INK, fill = 'none'): string {
  return `<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="${width}"/>`
}

export function circle(
  cx: number,
  cy: number,
  r: number,
  width = STROKE,
  ink = INK,
  fill = 'none'
): string {
  return (
    `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="${fill}" ` +
    `stroke="${ink}" stroke-width="${width}"/>`
  )
}

export interface TextOpts {
  size?: number
  anchor?: 'start' | 'middle' | 'end'
  ink?: string
  weight?: number | string
  italic?: boolean
}

/** Schematic text at the shared type stack. */
export function text(x: number, y: number, s: string, opts: TextOpts = {}): string {
  const { size = FONT_SYMBOL, anchor = 'start', ink = INK, weight, italic } = opts
  return (
    `<text x="${round(x)}" y="${round(y)}" fill="${ink}" font-family="${FONT}" ` +
    `font-size="${size}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}` +
    `${weight ? ` font-weight="${weight}"` : ''}${italic ? ' font-style="italic"' : ''}` +
    ` stroke="none">${escapeXml(s)}</text>`
  )
}

/** Snap a length to the major grid. */
export function snapGrid(n: number, grid = SCH_GRID): number {
  return Math.round(n / grid) * grid
}

export function round(n: number): number {
  return Math.round(n * 100) / 100
}

export function escapeXml(s: string): string {
  return String(s).replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string
  )
}
