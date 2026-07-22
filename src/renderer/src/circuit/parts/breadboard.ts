/**
 * circuit/parts/breadboard — procedural breadboard PartDefs (spec §5.1).
 *
 * Generates crisp SVG + pin maps for three sizes; sizes are parametric so a
 * new size is one line. Hole pitch is GRID_BB (2.54 mm @ 96 DPI) and the
 * FIRST PIN sits exactly on a pitch multiple, so snap-by-first-pin placement
 * puts every hole on the canvas grid — which is what makes drop-to-connect
 * degenerate to exact coordinate matches.
 *
 * Pin naming: main grid `a1…j63` (rows a–e top bank, f–j bottom bank, column
 * numbers 1..N). Power rails: `t+1…`, `t-1…` (top), `b+1…`, `b-1…` (bottom).
 * Buses (internally common groups): each column's [a…e] and [f…j], plus one
 * bus per rail — consumed by buildNets via `busesFor`.
 *
 * Registered into the (legacy, M1-era) partsLibrary at Circuit View mount;
 * the M2+ pack registry will take over ownership without changing geometry.
 */

import type { PartDef } from '../../lib/partsLibrary'
import { GRID_BB } from '../core/model'

const P = GRID_BB // 9.6 px hole pitch

export interface BreadboardSpec {
  type: string
  label: string
  cols: number
  rails: boolean
}

export const BREADBOARDS: BreadboardSpec[] = [
  { type: 'breadboard-mini', label: 'Breadboard (mini)', cols: 17, rails: false },
  { type: 'breadboard-half', label: 'Breadboard (half+)', cols: 30, rails: true },
  { type: 'breadboard-full', label: 'Breadboard (full+)', cols: 63, rails: true }
]

export function isBreadboard(type: string): boolean {
  return type.startsWith('breadboard-')
}

const ROWS_TOP = ['a', 'b', 'c', 'd', 'e']
const ROWS_BOT = ['f', 'g', 'h', 'i', 'j']

interface Layout {
  w: number
  h: number
  holeX: (col: number) => number
  mainY: (rowIdx: number, bank: 'top' | 'bot') => number
  railY: Record<'t-' | 't+' | 'b+' | 'b-', number> | null
}

function layout(spec: BreadboardSpec): Layout {
  const holeX = (col: number): number => P * 2 + (col - 1) * P
  const w = P * 2 + spec.cols * P + P // margin + columns + margin
  if (!spec.rails) {
    // mini: rows a–e at 1P..5P, channel, f–j at 7P..11P
    return {
      w,
      h: P * 12.5,
      holeX,
      mainY: (i, bank) => (bank === 'top' ? P * (1 + i) : P * (7 + i)),
      railY: null
    }
  }
  // railed: t- 1P, t+ 2P · a–e 4P..8P · channel · f–j 10P..14P · b+ 16P, b- 17P
  return {
    w,
    h: P * 18.5,
    holeX,
    mainY: (i, bank) => (bank === 'top' ? P * (4 + i) : P * (10 + i)),
    railY: { 't-': P * 1, 't+': P * 2, 'b+': P * 16, 'b-': P * 17 }
  }
}

export interface GeneratedBreadboard {
  def: PartDef
  buses: string[][]
}

export function generateBreadboard(spec: BreadboardSpec): GeneratedBreadboard {
  const L = layout(spec)
  const pins: Record<string, [number, number]> = {}
  const buses: string[][] = []

  for (let c = 1; c <= spec.cols; c++) {
    const topBus: string[] = []
    const botBus: string[] = []
    ROWS_TOP.forEach((r, i) => {
      pins[`${r}${c}`] = [L.holeX(c), L.mainY(i, 'top')]
      topBus.push(`${r}${c}`)
    })
    ROWS_BOT.forEach((r, i) => {
      pins[`${r}${c}`] = [L.holeX(c), L.mainY(i, 'bot')]
      botBus.push(`${r}${c}`)
    })
    buses.push(topBus, botBus)
  }
  if (L.railY) {
    for (const rail of ['t-', 't+', 'b+', 'b-'] as const) {
      const bus: string[] = []
      for (let c = 1; c <= spec.cols; c++) {
        const name = `${rail[0]}${rail[1]}${c}` // "t-3", "b+12"
        pins[name] = [L.holeX(c), L.railY[rail]]
        bus.push(name)
      }
      buses.push(bus)
    }
  }

  const def: PartDef = {
    type: spec.type,
    label: spec.label,
    family: 'Breadboards',
    builtin: true,
    views: { breadboard: { svg: renderSvg(spec, L), w: L.w, h: L.h, pins } }
  }
  return { def, buses }
}

/** buses per breadboard type (memoized), for buildNets({ busesFor }). */
const busCache = new Map<string, string[][]>()
export function breadboardBuses(type: string): string[][] | undefined {
  if (!isBreadboard(type)) return undefined
  if (!busCache.has(type)) {
    const spec = BREADBOARDS.find((s) => s.type === type)
    if (!spec) return undefined
    busCache.set(type, generateBreadboard(spec).buses)
  }
  return busCache.get(type)
}

// ── SVG ──────────────────────────────────────────────────────────────────────

function renderSvg(spec: BreadboardSpec, L: Layout): string {
  const parts: string[] = []
  const hole = (x: number, y: number): string =>
    `<rect x="${(x - 2.1).toFixed(2)}" y="${(y - 2.1).toFixed(2)}" width="4.2" height="4.2" rx="0.9" fill="#1f2125" stroke="#494e57" stroke-width="0.7"/>`

  // body
  parts.push(
    `<rect x="0.5" y="0.5" width="${L.w - 1}" height="${L.h - 1}" rx="4" fill="#e4e1da" stroke="#b9b4aa" stroke-width="1"/>`
  )
  // center channel
  const chTop = L.mainY(4, 'top') + P * 0.55
  const chBot = L.mainY(0, 'bot') - P * 0.55
  parts.push(
    `<rect x="1.5" y="${chTop.toFixed(2)}" width="${L.w - 3}" height="${(chBot - chTop).toFixed(2)}" fill="#d4d0c8"/>`,
    `<line x1="1.5" y1="${chTop.toFixed(2)}" x2="${L.w - 1.5}" y2="${chTop.toFixed(2)}" stroke="#c0bbb1" stroke-width="0.8"/>`,
    `<line x1="1.5" y1="${chBot.toFixed(2)}" x2="${L.w - 1.5}" y2="${chBot.toFixed(2)}" stroke="#c0bbb1" stroke-width="0.8"/>`
  )
  // rail stripes + rail holes
  if (L.railY) {
    const stripe = (y: number, color: string): string =>
      `<line x1="${P * 1.1}" y1="${y}" x2="${L.w - P * 1.1}" y2="${y}" stroke="${color}" stroke-width="1.4"/>`
    parts.push(
      stripe(L.railY['t-'] - P * 0.55, '#3b6fd4'),
      stripe(L.railY['t+'] + P * 0.55, '#d84a44'),
      stripe(L.railY['b+'] - P * 0.55, '#d84a44'),
      stripe(L.railY['b-'] + P * 0.55, '#3b6fd4')
    )
    for (let c = 1; c <= spec.cols; c++) {
      for (const rail of ['t-', 't+', 'b+', 'b-'] as const) {
        parts.push(hole(L.holeX(c), L.railY[rail]))
      }
    }
  }
  // main holes
  for (let c = 1; c <= spec.cols; c++) {
    ROWS_TOP.forEach((_, i) => parts.push(hole(L.holeX(c), L.mainY(i, 'top'))))
    ROWS_BOT.forEach((_, i) => parts.push(hole(L.holeX(c), L.mainY(i, 'bot'))))
  }
  // row letters
  const letterY: [string, number][] = [
    ...ROWS_TOP.map((r, i): [string, number] => [r, L.mainY(i, 'top')]),
    ...ROWS_BOT.map((r, i): [string, number] => [r, L.mainY(i, 'bot')])
  ]
  for (const [r, y] of letterY) {
    parts.push(
      `<text x="${P * 0.9}" y="${y + 2.4}" fill="#8d8779" font-family="monospace" font-size="5.6" text-anchor="middle">${r}</text>`
    )
  }
  // column numbers every 5
  for (let c = 1; c <= spec.cols; c++) {
    if (c !== 1 && c % 5 !== 0) continue
    const x = L.holeX(c)
    const yTop = L.mainY(0, 'top') - P * 0.75
    const yBot = L.mainY(4, 'bot') + P * 0.95
    parts.push(
      `<text x="${x}" y="${yTop}" fill="#8d8779" font-family="monospace" font-size="5.6" text-anchor="middle">${c}</text>`,
      `<text x="${x}" y="${yBot}" fill="#8d8779" font-family="monospace" font-size="5.6" text-anchor="middle">${c}</text>`
    )
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.w} ${L.h}">${parts.join('')}</svg>`
}
