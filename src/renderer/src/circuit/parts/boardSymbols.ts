/**
 * circuit/parts/boardSymbols: tinyStudio boards on the schematic.
 *
 * A tinyCore is drawn as a black-box module, the way SparkFun draws a board in
 * KiCad: power on top, ground at the bottom, analog and serial pins down the
 * left, digital and bus pins down the right, each pin named as on the
 * silkscreen with its ESP32-S3 GPIO beside it. The internals (LEDs, IMU, SD)
 * are not drawn; the simulator and exporters treat the board the same way.
 *
 * The header repeats its power pins (two 3V3, three GND). They are one net on
 * the board, so they share one pin position here and one bus in the net model.
 */

import { TINYCORE_PINS } from '../../../../shared/tinycorePins'
import type { PartView } from '../../lib/partsLibrary'
import {
  BODY_FILL,
  FONT_PIN,
  FONT_SYMBOL,
  INK,
  INK_MUTED,
  SCH_GRID,
  STROKE,
  line,
  round,
  symbolSvg,
  text
} from './style'

const P = SCH_GRID

/** Boards that carry the tinyCore header: tinyCore itself, every HAT, tinyProto. */
export function isTinyHeaderBoard(type: string): boolean {
  return /^tiny[a-z]+$/.test(type)
}

/**
 * Pins that are the same copper on a tinyStudio board: `GND`, `GND.2`, `GND.3`
 * (and `3V3`, `3V3.2`) differ only by the header they sit on.
 */
export function headerBuses(pinNames: string[]): string[][] {
  const groups = new Map<string, string[]>()
  for (const name of pinNames) {
    const base = name.replace(/\.\d+$/, '')
    if (base !== 'GND' && base !== '3V3') continue
    groups.set(base, [...(groups.get(base) ?? []), name])
  }
  return [...groups.values()].filter((g) => g.length > 1)
}

// row layout: null leaves a gap between pin groups
const LEFT: (string | null)[] = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', null, 'RX', 'TX']
const RIGHT: (string | null)[] = [
  'D8',
  'D9',
  'D10',
  'D11',
  'D12',
  'D13',
  null,
  'SCK',
  'MO',
  'MI',
  null,
  'SDA',
  'SCL'
]

const W = 16 * P // pins at x = 0 and x = W; body from P to W - P
const ROW0 = 3 * P // first side pin, leaving room under the top pins' names
const BODY_TOP = P
const BODY_BOTTOM = ROW0 + (RIGHT.length + 1) * P
const H = BODY_BOTTOM + P
const GAP = 3 // pin name inset from the body edge

let cached: PartView | null = null

/** The tinyCore module symbol, with every part.json pin bound to a position. */
export function tinyCoreSymbol(): PartView {
  if (cached) return cached
  const byLabel = new Map(TINYCORE_PINS.map((p) => [p.label, p]))
  const pins: Record<string, [number, number]> = {}
  const parts: string[] = [
    `<rect x="${P}" y="${BODY_TOP}" width="${W - 2 * P}" height="${BODY_BOTTOM - BODY_TOP}" rx="2" ` +
      `fill="${BODY_FILL}" stroke="${INK}" stroke-width="${STROKE}"/>`
  ]

  // the silkscreen's bare numbers (8, 9…) read as values on a schematic; keep D8
  const name = (label: string): string => {
    const silk = byLabel.get(label)?.silk
    return silk && !/^\d+$/.test(silk) ? silk : label
  }
  const gpio = (label: string): string => {
    const g = byLabel.get(label)?.gpio
    return g === undefined ? '' : `IO${g}`
  }

  LEFT.forEach((label, i) => {
    if (!label) return
    const y = ROW0 + i * P
    pins[label] = [0, y]
    const n = name(label)
    parts.push(
      line(0, y, P, y),
      text(P + GAP, y + 2.5, n, { size: FONT_PIN, weight: 600 }),
      text(P + GAP + n.length * FONT_PIN * 0.62 + 3, y + 2.5, gpio(label), {
        size: FONT_PIN - 1,
        ink: INK_MUTED
      })
    )
  })
  RIGHT.forEach((label, i) => {
    if (!label) return
    const y = ROW0 + i * P
    pins[label] = [W, y]
    const n = name(label)
    parts.push(
      line(W - P, y, W, y),
      text(W - P - GAP, y + 2.5, n, { size: FONT_PIN, weight: 600, anchor: 'end' }),
      text(W - P - GAP - n.length * FONT_PIN * 0.62 - 3, y + 2.5, gpio(label), {
        size: FONT_PIN - 1,
        ink: INK_MUTED,
        anchor: 'end'
      })
    )
  })

  // power on top, ground at the bottom; duplicates share the position
  const top: [string[], number, string][] = [
    [['3V3', '3V3.2'], 6 * P, '3V3'],
    [['PWR'], 10 * P, 'I2C_PWR']
  ]
  for (const [labels, x, shown] of top) {
    for (const l of labels) pins[l] = [x, 0]
    parts.push(
      line(x, 0, x, BODY_TOP),
      text(x, BODY_TOP + FONT_PIN + 3, shown, { size: FONT_PIN, weight: 600, anchor: 'middle' })
    )
  }
  const gx = 8 * P
  for (const l of ['GND', 'GND.2', 'GND.3']) pins[l] = [gx, H]
  parts.push(
    line(gx, BODY_BOTTOM, gx, H),
    text(gx, BODY_BOTTOM - 4, 'GND', { size: FONT_PIN, weight: 600, anchor: 'middle' })
  )

  // the board's name in the open middle of the body
  const mid = (ROW0 + (RIGHT.length - 1) * P) / 2 + P
  parts.push(
    text(W / 2, round(mid), 'tinyCore', { size: FONT_SYMBOL + 2, weight: 700, anchor: 'middle' }),
    text(W / 2, round(mid + 11), 'ESP32-S3', { size: FONT_PIN, ink: INK_MUTED, anchor: 'middle' })
  )

  cached = { svg: symbolSvg(parts.join(''), W, H), w: W, h: H, pins }
  return cached
}
