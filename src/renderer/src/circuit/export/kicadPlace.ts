/**
 * circuit/export/kicadPlace: the parts of a circuit as footprints on an
 * exported board, placed where they sit on the tinyProto.
 *
 * A tinyProto is the same 48.3 mm octagon as the HAT and stacks on the tinyCore
 * pin for pin, so every hole has an exact spot on the board: the tinyCore's
 * header pins in the breadboard view are matched to the HAT's J1/J2 header
 * pads, and each part's legs map through the same transform. A footprint goes
 * where its pads best fit the holes its legs are in (trying the four
 * rotations), so a resistor bent over four holes lands across them even though
 * its footprint's pads are 7.62 mm apart. Parts that aren't on the board are
 * lined up below it.
 *
 * The footprints are SparkFun's or KiCad's own (kicadFootprints.gen.ts), linked
 * to their schematic symbols by path, with every field hidden and Reference and
 * Value on the fab layers (docs/hardware-standards.md SLK-406).
 */

import { KICAD_FOOTPRINTS } from './kicadFootprints.gen'
import { q, type ExportComponent } from './kicadNetlist'
import { stableUuid } from './kicadSch'
import { KICAD_LIB_SYMBOLS } from './kicadSymbols.gen'

export type Pt = { x: number; y: number }

/** 96 px to the inch: breadboard units → mm */
const MM_PER_PX = 25.4 / 96

export interface PlaceOptions {
  /** project name, for uuids and the schematic file the footprints link to */
  name: string
  comps: ExportComponent[]
  padNets: Map<string, string>
  symbolUuids: Map<string, string>
  /** a part's pin in the breadboard view (px), when it is placed there */
  pinAt: (partId: string, pin: string) => Pt | null
  /** breadboard px → board mm, or null when the circuit has no board to map from */
  toBoard: ((p: Pt) => Pt) | null
  /** the board's outline, for deciding what is on it */
  outline: Pt[]
}

export interface Placed {
  ref: string
  footprint: string
  x: number
  y: number
  rot: number
  onBoard: boolean
  text: string
}

const f = (n: number): string => String(Math.round(n * 1e6) / 1e6)

/** The balanced s-expression starting at `start` (an open paren), strings respected. */
function blockAt(src: string, start: number): string {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '"') {
      for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === '\\') i++
      continue
    }
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return src.slice(start, i + 1)
  }
  return src.slice(start)
}

/** A footprint's pads: number → local positions (a button has two of each). */
export function footprintPads(mod: string): Map<string, Pt[]> {
  const out = new Map<string, Pt[]>()
  for (const m of mod.matchAll(/\n\t\(pad "([^"]*)" (?:thru_hole|smd|np_thru_hole|connect)\b/g)) {
    const block = blockAt(mod, m.index! + 2)
    const at = /\(at ([-\d.]+) ([-\d.]+)/.exec(block)
    if (!at || !m[1]) continue
    if (!out.has(m[1])) out.set(m[1], [])
    out.get(m[1])!.push({ x: +at[1], y: +at[2] })
  }
  return out
}

/** Local outline points (courtyard and fab drawing, pads) for a footprint's size. */
function footprintExtent(mod: string): [number, number, number, number] {
  const pts = [...mod.matchAll(/\((?:start|end|xy|center|at) ([-\d.]+) ([-\d.]+)/g)].map(
    (m) => [+m[1], +m[2]] as [number, number]
  )
  if (!pts.length) return [-1, -1, 1, 1]
  return [
    Math.min(...pts.map((p) => p[0])),
    Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])),
    Math.max(...pts.map((p) => p[1]))
  ]
}

/** A local point turned by a footprint's rotation (KiCad: counter-clockwise on the board). */
function turn(p: Pt, rot: number): Pt {
  const a = (rot * Math.PI) / 180
  const c = Math.round(Math.cos(a))
  const s = Math.round(Math.sin(a))
  return { x: p.x * c + p.y * s, y: -p.x * s + p.y * c }
}

const mean = (ps: Pt[]): Pt => ({
  x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
  y: ps.reduce((s, p) => s + p.y, 0) / ps.length
})

/** Where a footprint goes so its pads sit best on `targets` (pad number → board points). */
export function fit(
  pads: Map<string, Pt[]>,
  targets: Map<string, Pt>
): { x: number; y: number; rot: number; error: number } | null {
  const nums = [...targets.keys()].filter((n) => pads.has(n))
  if (!nums.length) return null
  let best: { x: number; y: number; rot: number; error: number } | null = null
  for (const rot of [0, 90, 180, 270]) {
    const local = nums.map((n) => turn(mean(pads.get(n)!), rot))
    const want = nums.map((n) => targets.get(n)!)
    const lc = mean(local)
    const wc = mean(want)
    const x = wc.x - lc.x
    const y = wc.y - lc.y
    const error = nums.reduce(
      (s, _n, i) => s + (local[i].x + x - want[i].x) ** 2 + (local[i].y + y - want[i].y) ** 2,
      0
    )
    if (!best || error < best.error - 1e-9) best = { x, y, rot, error }
  }
  return best
}

/** Inside a convex outline (the HAT's octagon). */
function inside(p: Pt, poly: Pt[]): boolean {
  if (poly.length < 3) return false
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (Math.abs(cross) < 1e-9) continue
    const s = Math.sign(cross)
    if (sign && s !== sign) return false
    sign = s
  }
  return true
}

/**
 * The .kicad_mod as a board footprint: named by lib id, at its place, fields
 * set and hidden, pads on their nets, linked to the schematic symbol.
 */
function boardFootprint(
  mod: string,
  id: string,
  c: ExportComponent,
  at: { x: number; y: number; rot: number },
  o: PlaceOptions
): string {
  let n = 0
  const uid = (): string => stableUuid(`${o.name}:fp:${c.ref}:${n++}`)
  let t = mod
    .replace(/^\(footprint "(?:[^"\\]|\\.)*"/, `(footprint ${q(id)}`)
    .replace(/\n\t\((?:version|generator|generator_version) [^\n]*/g, '')
    .replace(/\(uuid "[^"]*"\)/g, () => `(uuid ${q(uid())})`)
  // place it
  t = t.replace(
    /\n\t\(layer "F\.Cu"\)/,
    `\n\t(layer "F.Cu")\n\t(uuid ${q(stableUuid(`${o.name}:footprint:${c.ref}`))})\n\t(at ${f(at.x)} ${f(at.y)}${at.rot ? ` ${at.rot}` : ''})`
  )
  // pads and text carry their absolute angle on a board
  t = t.replace(
    /(\n\t\((?:pad|property|fp_text) [^\n]*\n\t\t\(at ([-\d.]+) ([-\d.]+)(?: ([-\d.]+))?\))/g,
    (whole, _h, x, y, a) => {
      if (!at.rot) return whole
      const angle = (((+(a ?? 0) + at.rot) % 360) + 360) % 360
      return whole.replace(/\(at [^)]*\)$/, `(at ${x} ${y} ${angle})`)
    }
  )
  // every field the schematic symbol has, so the board matches it (parity)
  const want = ['Datasheet', 'Description']
  if (c.prodId !== undefined && KICAD_LIB_SYMBOLS[c.symbol]?.includes('"PROD_ID"'))
    want.push('PROD_ID')
  const valueAt = t.indexOf('\n\t(property "Value" ')
  if (valueAt >= 0) {
    const end = t.indexOf('\n\t)', valueAt) + 3
    const add = want
      .filter((k) => !t.includes(`\n\t(property ${q(k)} `))
      .map(
        (k) =>
          `\n\t(property ${q(k)} ${q(k === 'PROD_ID' ? (c.prodId ?? '') : '')}\n\t\t(at 0 0${at.rot ? ` ${at.rot}` : ''})\n\t\t(layer "F.Fab")\n\t\t(hide yes)\n\t\t(uuid ${q(stableUuid(`${o.name}:field:${c.ref}:${k}`))})\n\t\t(effects\n\t\t\t(font\n\t\t\t\t(size 1.27 1.27)\n\t\t\t\t(thickness 0.15)\n\t\t\t)\n\t\t)\n\t)`
      )
      .join('')
    t = t.slice(0, end) + add + t.slice(end)
  }
  // fields: the values, all hidden, Reference and Value on fab (SLK-406)
  t = t.replace(
    /\n\t\(property "(Reference|Value|Datasheet|Description)" "(?:[^"\\]|\\.)*"\n/g,
    (_m, key) => {
      const value =
        key === 'Reference'
          ? c.ref
          : key === 'Value'
            ? c.value
            : key === 'Datasheet'
              ? (c.datasheet ?? '')
              : c.description
      return `\n\t(property ${q(key)} ${q(value)}\n`
    }
  )
  t = t.replace(
    /(\n\t\(property "(?:Reference|Value)" [^\n]*\n(?:\t\t[^\n]*\n)*?)\t\t\(layer "F\.SilkS"\)/g,
    '$1\t\t(layer "F.Fab")'
  )
  t = t.replace(
    /(\n\t\(property "[^"]*" [^\n]*\n\t\t\(at [^\n]*\n)(?!(?:\t\t[^\n]*\n)*?\t\t\(hide yes\))/g,
    (m) => m
  )
  t = t.replace(
    /(\n\t\(property "[^"]*" [^\n]*\n\t\t\(at [^\n]*\n(?:\t\t\(unlocked yes\)\n)?\t\t\(layer [^\n]*\n)(?!\t\t\(hide yes\))/g,
    '$1\t\t(hide yes)\n'
  )
  // link to the schematic symbol, so Update PCB keeps it
  const sym = o.symbolUuids.get(c.ref)
  if (sym) {
    const link = `\n\t(path ${q(`/${sym}`)})\n\t(sheetname "/")\n\t(sheetfile ${q(`${o.name}.kicad_sch`)})`
    const anchor = t.search(/\n\t\((?:attr|fp_|pad|model|embedded_fonts)\b/)
    t = anchor >= 0 ? t.slice(0, anchor) + link + t.slice(anchor) : t
  }
  // pads on their nets
  t = t.replace(/\n\t\(pad "([^"]*)" [\s\S]*?\n\t\)/g, (block, num: string) => {
    const net = o.padNets.get(`${c.ref}:${num}`)
    if (!net) return block
    const tag = `\n\t\t(net ${q(net)})`
    // the net goes before the pad's uuid, or at the end of a pad without one
    return /\n\t\t\(uuid /.test(block)
      ? block.replace(/\n\t\t\(uuid /, `${tag}\n\t\t(uuid `)
      : block.replace(/\n\t\)$/, `${tag}\n\t)`)
  })
  return t
    .split('\n')
    .map((l) => '\t' + l)
    .join('\n')
}

/** Every exported part (not the headers) as a placed footprint. */
export function placeFootprints(o: PlaceOptions): { placed: Placed[]; warnings: string[] } {
  const warnings: string[] = []
  const placed: Placed[] = []
  const xs = o.outline.map((p) => p.x)
  const ys = o.outline.map((p) => p.y)
  const box = xs.length
    ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
    : { x0: 100, y0: 100, x1: 150, y1: 150 }
  let rowX = box.x0
  for (const c of o.comps) {
    if (c.ref !== c.partId) continue // the headers are the template's
    const mod = KICAD_FOOTPRINTS[c.footprint]
    if (!mod) {
      if (c.footprint)
        warnings.push(`${c.ref}: footprint ${c.footprint} isn't bundled; add it in pcbnew`)
      continue
    }
    const pads = footprintPads(mod)
    // where the part's legs are, per pad number
    const targets = new Map<string, Pt>()
    if (o.toBoard) {
      const byPad = new Map<string, Pt[]>()
      for (const [pin, pad] of Object.entries(c.pads)) {
        const p = o.pinAt(c.partId, pin)
        if (!p) continue
        if (!byPad.has(pad)) byPad.set(pad, [])
        byPad.get(pad)!.push(o.toBoard(p))
      }
      for (const [pad, ps] of byPad) targets.set(pad, mean(ps))
    }
    const onBoard = targets.size > 0 && [...targets.values()].every((p) => inside(p, o.outline))
    let at: { x: number; y: number; rot: number }
    const fitted = onBoard ? fit(pads, targets) : null
    if (fitted) at = fitted
    else {
      // off the board: in a row underneath, for the designer to place
      const [ex0, ey0, ex1] = footprintExtent(mod)
      at = { x: rowX - ex0 + 1, y: box.y1 + 8 - ey0, rot: 0 }
      rowX += ex1 - ex0 + 3
    }
    placed.push({
      ref: c.ref,
      footprint: c.footprint,
      x: at.x,
      y: at.y,
      rot: at.rot,
      onBoard: !!fitted,
      text: boardFootprint(mod, c.footprint, c, at, o)
    })
  }
  const off = placed.filter((p) => !p.onBoard).map((p) => p.ref)
  if (off.length)
    warnings.push(
      `${off.join(', ')} ${off.length > 1 ? "aren't" : "isn't"} on the tinyProto; placed below the board`
    )
  return { placed, warnings }
}

/** Point on a mm grid of `step` relative to `origin`. */
export function snapTo(p: Pt, origin: Pt, step: number): Pt {
  return {
    x: origin.x + Math.round((p.x - origin.x) / step) * step,
    y: origin.y + Math.round((p.y - origin.y) / step) * step
  }
}

/**
 * Breadboard px → board mm, from two header pins of the tinyCore and where the
 * HAT template puts their pads: scale is fixed (96 px/in), the rotation snaps
 * to a quarter turn, and the offset is the average of the two.
 */
export function boardTransform(a: { px: Pt; mm: Pt }, b: { px: Pt; mm: Pt }): (p: Pt) => Pt {
  const v = { x: b.px.x - a.px.x, y: b.px.y - a.px.y }
  const w = { x: b.mm.x - a.mm.x, y: b.mm.y - a.mm.y }
  const turnBy = Math.round((Math.atan2(w.y, w.x) - Math.atan2(v.y, v.x)) / (Math.PI / 2)) * 90
  const rot = (p: Pt): Pt => {
    const r = (turnBy * Math.PI) / 180
    const c = Math.round(Math.cos(r))
    const s = Math.round(Math.sin(r))
    return { x: (p.x * c - p.y * s) * MM_PER_PX, y: (p.x * s + p.y * c) * MM_PER_PX }
  }
  const ra = rot(a.px)
  const rb = rot(b.px)
  const off = {
    x: (a.mm.x - ra.x + b.mm.x - rb.x) / 2,
    y: (a.mm.y - ra.y + b.mm.y - rb.y) / 2
  }
  return (p) => {
    const r = rot(p)
    return { x: r.x + off.x, y: r.y + off.y }
  }
}
