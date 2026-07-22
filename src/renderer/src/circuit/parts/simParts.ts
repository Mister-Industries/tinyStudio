/**
 * circuit/parts/simParts — builtin simulation sources (M4, spec §10.3).
 *
 * Generated two-pin source symbols (DC voltage, sine, DC current) in the
 * classic circle style. Both views get the same art so a source is placeable
 * on the breadboard too (its pins seat in holes like any part). Pins land on
 * the 9.6 grid; ink follows the theme via var(--text-strong) like symbols.ts.
 *
 * The netlist generator maps these by type (sim-vdc / sim-vsin / sim-idc);
 * editable attrs (voltage, amplitude, frequency, current) ride Part attrs and
 * are exposed in the Inspector like any other attr.
 */

import type { PartDef, PartView } from '../../lib/partsLibrary'
import { GRID_BB } from '../core/model'

const P = GRID_BB // 9.6
const INK = 'var(--text-strong)'
const STROKE = 2

export interface SimSourceSpec {
  type: string
  label: string
  /** default attrs applied on placement (editable in the Inspector) */
  attrs: Record<string, string>
  glyph: (cx: number, cy: number, r: number) => string
}

export const SIM_SOURCES: SimSourceSpec[] = [
  {
    type: 'sim-vdc',
    label: 'DC voltage',
    attrs: { voltage: '5' },
    glyph: (cx, cy, r) =>
      `<line x1="${cx - r * 0.35}" y1="${cy - r * 0.45}" x2="${cx + r * 0.35}" y2="${cy - r * 0.45}" stroke="${INK}" stroke-width="${STROKE}"/>` +
      `<line x1="${cx}" y1="${cy - r * 0.45 - r * 0.35}" x2="${cx}" y2="${cy - r * 0.45 + r * 0.35}" stroke="${INK}" stroke-width="${STROKE}"/>` +
      `<line x1="${cx - r * 0.35}" y1="${cy + r * 0.45}" x2="${cx + r * 0.35}" y2="${cy + r * 0.45}" stroke="${INK}" stroke-width="${STROKE}"/>`
  },
  {
    type: 'sim-vsin',
    label: 'Sine source',
    attrs: { amplitude: '1', frequency: '1k' },
    glyph: (cx, cy, r) =>
      `<path d="M ${cx - r * 0.55} ${cy} q ${r * 0.28} ${-r * 0.8} ${r * 0.55} 0 q ${r * 0.28} ${r * 0.8} ${r * 0.55} 0" fill="none" stroke="${INK}" stroke-width="${STROKE}" stroke-linecap="round"/>`
  },
  {
    type: 'sim-idc',
    label: 'DC current',
    attrs: { current: '10m' },
    glyph: (cx, cy, r) =>
      `<line x1="${cx}" y1="${cy + r * 0.55}" x2="${cx}" y2="${cy - r * 0.55}" stroke="${INK}" stroke-width="${STROKE}"/>` +
      `<path d="M ${cx - r * 0.3} ${cy - r * 0.15} L ${cx} ${cy - r * 0.55} L ${cx + r * 0.3} ${cy - r * 0.15}" fill="none" stroke="${INK}" stroke-width="${STROKE}" stroke-linejoin="round"/>`
  }
]

const cache = new Map<string, PartDef>()

export function generateSimSource(spec: SimSourceSpec): PartDef {
  const hit = cache.get(spec.type)
  if (hit) return hit

  const w = 4 * P
  const h = 6 * P
  const cx = 2 * P
  const cy = 3 * P
  const r = 1.5 * P

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
    `<line x1="${cx}" y1="0" x2="${cx}" y2="${cy - r}" stroke="${INK}" stroke-width="${STROKE}"/>` +
    `<line x1="${cx}" y1="${cy + r}" x2="${cx}" y2="${h}" stroke="${INK}" stroke-width="${STROKE}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${INK}" stroke-width="${STROKE}"/>` +
    `<text x="${cx + r + 3}" y="${cy - r}" fill="${INK}" font-family="monospace" font-size="7">+</text>` +
    spec.glyph(cx, cy, r) +
    `</svg>`

  const view: PartView = {
    svg,
    w,
    h,
    pins: { '+': [cx, 0], '-': [cx, h] }
  }
  const def: PartDef = {
    type: spec.type,
    label: spec.label,
    family: 'Source',
    builtin: true,
    views: { breadboard: view, schematic: view }
  }
  cache.set(spec.type, def)
  return def
}

export function isSimSource(type: string): boolean {
  return SIM_SOURCES.some((s) => s.type === type)
}

/** Default attrs for a just-placed source (Inspector-editable). */
export function simSourceDefaultAttrs(type: string): Record<string, string> | undefined {
  return SIM_SOURCES.find((s) => s.type === type)?.attrs
}
