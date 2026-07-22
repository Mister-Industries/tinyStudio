/**
 * circuit/parts/netLabels — generated glyphs for schematic net labels (§8.4).
 *
 * A net label is a 1-pin entity whose virtual pin is "<id>:1"; labels sharing a
 * name merge into one net (the mechanism in core/nets.ts). `ground` is just the
 * name 'GND' drawn with the classic three-bar glyph; `power` is an up-flag with
 * the rail name (5V, 3V3, VCC…); `net` is a named tag (SDA, OUT…). Ink follows
 * the theme via var(--text-strong); the image exporter inlines it at export.
 *
 * Pins land on the 9.6 px major grid after snapNetLabel (spec §4).
 */

import type { PartView } from '../../lib/partsLibrary'
import { pinWorld, snapPlacementToPinGrid } from '../core/geometry'
import { GRID_BB, type NetLabel, type NetLabelKind, type Placement, type Pt } from '../core/model'

const P = GRID_BB // 9.6
const INK = 'var(--text-strong)'
const STROKE = 2
export const NET_LABEL_PIN = '1'

export interface NetLabelKindSpec {
  kind: NetLabelKind
  /** default net name assigned on placement */
  name: string
  /** palette label */
  label: string
}

/** Palette entries for the "Net Labels" section. */
export const NET_LABEL_KINDS: NetLabelKindSpec[] = [
  { kind: 'ground', name: 'GND', label: 'Ground' },
  { kind: 'power', name: '5V', label: 'Power 5V' },
  { kind: 'power', name: '3V3', label: 'Power 3V3' },
  { kind: 'net', name: 'NET', label: 'Named net' }
]

const cache = new Map<string, PartView>()

export function netLabelView(kind: NetLabelKind, name: string): PartView {
  const key = `${kind}:${name}`
  const hit = cache.get(key)
  if (hit) return hit
  const v = kind === 'ground' ? groundGlyph() : kind === 'power' ? powerGlyph(name) : netGlyph(name)
  cache.set(key, v)
  return v
}

export function netLabelVisualOf(label: NetLabel): PartView {
  return netLabelView(label.kind, label.name)
}

/** World position of a label's single connection pin. */
export function netLabelPinWorld(label: NetLabel, placement?: Placement): Pt {
  const pl = placement ?? label.sch
  const v = netLabelVisualOf(label)
  return pinWorld(v.pins[NET_LABEL_PIN], pl, v.w, v.h)
}

/** Snap a label placement so its pin lands on the major grid. */
export function snapNetLabel(kind: NetLabelKind, name: string, pl: Placement): Placement {
  const v = netLabelView(kind, name)
  const { x, y } = snapPlacementToPinGrid(pl, v.pins[NET_LABEL_PIN], v.w, v.h, GRID_BB)
  return { ...pl, x, y }
}

function wrap(inner: string, w: number, h: number, pin: [number, number]): PartView {
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${inner}</svg>`,
    w,
    h,
    pins: { [NET_LABEL_PIN]: pin }
  }
}

function groundGlyph(): PartView {
  const w = 2 * P
  const h = 2 * P
  const cx = w / 2
  const bars: [number, number][] = [
    [7, P],
    [4.5, P + 3.4],
    [2, P + 6.8]
  ]
  const inner =
    `<line x1="${cx}" y1="0" x2="${cx}" y2="${P}" stroke="${INK}" stroke-width="${STROKE}"/>` +
    bars
      .map(
        ([hw, y]) =>
          `<line x1="${cx - hw}" y1="${y}" x2="${cx + hw}" y2="${y}" stroke="${INK}" stroke-width="${STROKE}" stroke-linecap="round"/>`
      )
      .join('')
  return wrap(inner, w, h, [cx, 0])
}

function powerGlyph(name: string): PartView {
  const w = Math.max(2 * P, name.length * 6.2 + 10)
  const h = 2 * P
  const cx = w / 2
  const inner =
    `<text x="${cx}" y="${P - 5}" fill="${INK}" font-family="monospace" font-size="8" text-anchor="middle">${escape(name)}</text>` +
    `<line x1="${cx - P}" y1="${P}" x2="${cx + P}" y2="${P}" stroke="${INK}" stroke-width="${STROKE}" stroke-linecap="round"/>` +
    `<line x1="${cx}" y1="${P}" x2="${cx}" y2="${2 * P}" stroke="${INK}" stroke-width="${STROKE}"/>`
  return wrap(inner, w, h, [cx, 2 * P])
}

function netGlyph(name: string): PartView {
  const stub = P
  const tagW = name.length * 6.2 + 12
  const w = stub + tagW
  const h = 2 * P
  const cy = P
  const inner =
    `<line x1="0" y1="${cy}" x2="${stub}" y2="${cy}" stroke="${INK}" stroke-width="${STROKE}"/>` +
    `<rect x="${stub}" y="${cy - 7}" width="${tagW - 2}" height="14" rx="3" fill="none" stroke="${INK}" stroke-width="${STROKE}"/>` +
    `<text x="${stub + (tagW - 2) / 2}" y="${cy + 3}" fill="${INK}" font-family="monospace" font-size="8" text-anchor="middle">${escape(name)}</text>`
  return wrap(inner, w, h, [0, cy])
}

function escape(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] as string)
}
