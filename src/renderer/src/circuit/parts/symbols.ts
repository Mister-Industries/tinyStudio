/**
 * circuit/parts/symbols — generated schematic symbols (spec §5.1).
 *
 * Parts whose PartDef lacks schematic art get an auto-generated IC-style box
 * symbol: type label on top, pins distributed left/right in definition order,
 * pin names inked inside the body. This guarantees the schematic view (and,
 * later, KiCad export) never blocks on missing artwork.
 *
 * Ink is `var(--text-strong)` so symbols follow the tinyStudio theme; the
 * image exporter inlines the variable at export time (resolveCssVars).
 *
 * Pin positions land on the 9.6 px major grid (spec §4 pin-on-grid contract).
 */

import type { PartDef, PartView } from '../../lib/partsLibrary'
import { GRID_BB } from '../core/model'

const P = GRID_BB // 9.6 — schematic major grid
const INK = 'var(--text-strong)'
const STROKE = 2

const cache = new Map<string, PartView>()

/** Schematic view for a part: authored art if present, else a generated box. */
export function schematicVisual(def: PartDef): PartView {
  if (def.views.schematic) return def.views.schematic
  let v = cache.get(def.type)
  if (!v) {
    v = generateBoxSymbol(def)
    cache.set(def.type, v)
  }
  return v
}

export function generateBoxSymbol(def: PartDef): PartView {
  const source = def.views.breadboard?.pins ?? {}
  const names = Object.keys(source)
  // pin order: definition order; left gets the first half, right the rest
  const nLeft = Math.ceil(names.length / 2)
  const left = names.slice(0, nLeft)
  const right = names.slice(nLeft)
  const rows = Math.max(left.length, right.length, 1)

  const stub = P // lead length from body to pin tip
  const bodyW = P * Math.max(4, Math.min(10, 2 + Math.ceil(longest(names) * 0.62)))
  const bodyH = P * (rows + 1)
  const w = bodyW + stub * 2
  const h = bodyH + P // headroom for the label

  const pins: Record<string, [number, number]> = {}
  const parts: string[] = []
  const bodyX = stub
  const bodyY = P

  parts.push(
    `<rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="2" fill="none" stroke="${INK}" stroke-width="${STROKE}"/>`,
    `<text x="${w / 2}" y="${bodyY - 3}" fill="${INK}" font-family="monospace" font-size="8" text-anchor="middle">${escape(def.label || def.type)}</text>`
  )

  left.forEach((name, i) => {
    const y = bodyY + P * (i + 1)
    pins[name] = [0, y]
    parts.push(
      `<line x1="0" y1="${y}" x2="${bodyX}" y2="${y}" stroke="${INK}" stroke-width="${STROKE}"/>`,
      `<text x="${bodyX + 3}" y="${y + 2.6}" fill="${INK}" font-family="monospace" font-size="7">${escape(name)}</text>`
    )
  })
  right.forEach((name, i) => {
    const y = bodyY + P * (i + 1)
    pins[name] = [w, y]
    parts.push(
      `<line x1="${bodyX + bodyW}" y1="${y}" x2="${w}" y2="${y}" stroke="${INK}" stroke-width="${STROKE}"/>`,
      `<text x="${bodyX + bodyW - 3}" y="${y + 2.6}" fill="${INK}" font-family="monospace" font-size="7" text-anchor="end">${escape(name)}</text>`
    )
  })

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`,
    w,
    h,
    pins
  }
}

function longest(names: string[]): number {
  return names.reduce((m, n) => Math.max(m, n.length), 0)
}

function escape(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] as string)
}
