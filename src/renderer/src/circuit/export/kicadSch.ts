/**
 * circuit/export/kicadSch: the circuit as a KiCad 10 schematic (.kicad_sch).
 *
 * Every exported component (the same set, refs, values, footprints and pads as
 * the netlist: export/kicadNetlist) is placed as KiCad's own stock symbol
 * (Device:R, Device:LED, Switch:SW_Push…, copied into the file from
 * kicadSymbols.gen.ts so it opens without any library installed), at the spot
 * the part has in tinyStudio's schematic view. Parts with no stock symbol get a
 * generated box with their pin names.
 *
 * Connections are drawn the way a lot of real schematics are: each connected
 * pin gets a short wire and a net label, GND gets a ground symbol, and an unused
 * pin gets a no-connect flag. KiCad joins pins by label name, so the schematic
 * carries exactly the netlist's nets, passes ERC without pin errors, and
 * "Update PCB from Schematic" gives the same board the netlist import does.
 *
 * UUIDs are derived from the project name and refdes, so re-exporting the same
 * circuit links to the same footprints in a board that's already been laid out.
 */

import type { CircuitDoc, CircuitPart } from '../core/model'
import type { NetModel } from '../core/nets'
import { compareRefs, today, type ExportContext } from './common'
import {
  kicadNetlist,
  q,
  type ExportComponent,
  type NetlistExport,
  type StandIn
} from './kicadNetlist'
import { KICAD_LIB_SYMBOLS } from './kicadSymbols.gen'

/** The .kicad_sch format version KiCad 10 writes. */
export const KICAD_SCH_VERSION = '20260306'

const MM_PER_PX = 25.4 / 96
/** tinyStudio's schematic symbols are smaller than KiCad's; spread the layout out to match. */
const SPREAD = 1.6
const GRID = 2.54
const STUB = 2.54
const MARGIN = 25.4

export interface SchematicOptions {
  /** file stem: the sheet is `<name>.kicad_sch`, the KiCad project `<name>` */
  name: string
  /** the title block's title */
  title?: string
  /** components exported in a part's place (a tinyCore's HAT headers) */
  standIns?: Map<string, StandIn[]>
}

export interface SchematicExport {
  text: string
  warnings: string[]
  /** the sheet's uuid: the .kicad_pro's top-level sheet and every instance path */
  sheetUuid: string
  /** refdes → the placed symbol's uuid (a footprint's `path` is "/" + this) */
  symbolUuids: Map<string, string>
  /** the netlist built alongside, so other files can agree on net names */
  netlist: NetlistExport
  /** KiCad's stock symbol libraries the sheet uses (Device, power, …), for a project sym-lib-table */
  symbolLibs: string[]
}

// ── ids ──────────────────────────────────────────────────────────────────────

/** A stable UUID-shaped id from a string: 4 × 32-bit FNV-1a with different seeds. */
export function stableUuid(seed: string): string {
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((basis, k) => {
    let h = basis >>> 0
    const s = `${k}:${seed}`
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  })
  const hex = words.join('')
  // version 4 / RFC 4122 variant bits, so it looks like any other KiCad uuid
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32)
  ].join('-')
}

// ── symbol geometry ──────────────────────────────────────────────────────────

interface SymPin {
  number: string
  /** connection point in symbol coordinates (KiCad: y up) */
  x: number
  y: number
  /** direction from the connection point into the body, degrees */
  rot: number
}

/** The balanced s-expression starting at `start`, quoted strings respected. */
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

/** The pins of a symbol definition. */
export function symbolPins(def: string): SymPin[] {
  const pins: SymPin[] = []
  const re = /\(pin \w+ \w+\s/g
  let m
  while ((m = re.exec(def))) {
    const block = blockAt(def, m.index)
    const at = /\(at ([-\d.]+) ([-\d.]+)(?: ([-\d.]+))?\)/.exec(block)
    const num = /\(number "((?:[^"\\]|\\.)*)"/.exec(block)
    if (at && num)
      pins.push({ number: num[1], x: +at[1], y: +at[2], rot: Math.round(+(at[3] ?? 0)) % 360 })
    re.lastIndex = m.index + block.length
  }
  return pins
}

/**
 * Where a symbol's library puts one of its fields (Reference, Value), relative
 * to the symbol, in library coordinates (y up): its authors' default spot,
 * clear of the pins.
 */
export function libField(
  def: string,
  key: string
): { x: number; y: number; angle: number; justify: string } | null {
  const i = def.indexOf(`(property ${q(key)} `)
  if (i < 0) return null
  const block = blockAt(def, i)
  const at = /\(at ([-\d.]+) ([-\d.]+)(?: ([-\d.]+))?\)/.exec(block)
  if (!at) return null
  return {
    x: +at[1],
    y: +at[2],
    angle: Math.round(+(at[3] ?? 0)),
    justify: /\(justify ([a-z ]+)\)/.exec(block)?.[1] ?? ''
  }
}

const f = (n: number): string => String(Math.round(n * 10000) / 10000)
const snap = (v: number): number => Math.round(v / GRID) * GRID
const font = (extra = ''): string => `(effects (font (size 1.27 1.27))${extra})`

/** A box symbol for a part KiCad has no stock symbol for: its pins, named, on both sides. */
function genericSymbol(libId: string, pins: { number: string; name: string }[]): string {
  const left = pins.slice(0, Math.ceil(pins.length / 2))
  const right = pins.slice(left.length)
  const rows = Math.max(left.length, right.length, 1)
  const longest = Math.max(4, ...pins.map((p) => p.name.length))
  const half = Math.max(5.08, snap(longest * 0.85 + 2.54))
  const top = snap(((rows - 1) * GRID) / 2) + GRID
  const bare = libId.slice(libId.indexOf(':') + 1)
  const pin = (p: { number: string; name: string }, x: number, y: number, rot: number): string =>
    `\t\t\t(pin passive line (at ${f(x)} ${f(y)} ${rot}) (length 2.54)\n` +
    `\t\t\t\t(name ${q(p.name)} ${font()})\n\t\t\t\t(number ${q(p.number)} ${font()})\n\t\t\t)`
  const pinRows = [
    ...left.map((p, i) => pin(p, -half - 2.54, top - GRID - i * GRID, 0)),
    ...right.map((p, i) => pin(p, half + 2.54, top - GRID - i * GRID, 180))
  ]
  return [
    `(symbol ${q(libId)}`,
    `\t(pin_names (offset 1.016))`,
    `\t(exclude_from_sim no) (in_bom yes) (on_board yes) (in_pos_files yes)`,
    `\t(duplicate_pin_numbers_are_jumpers no)`,
    `\t(property "Reference" "U" (at 0 ${f(top + 1.27)} 0) ${font()})`,
    `\t(property "Value" ${q(bare)} (at 0 ${f(-top - 1.27)} 0) ${font()})`,
    `\t(property "Footprint" "" (at 0 0 0) (hide yes) ${font()})`,
    `\t(property "Datasheet" "" (at 0 0 0) (hide yes) ${font()})`,
    `\t(property "Description" "Generated by tinyStudio" (at 0 0 0) (hide yes) ${font()})`,
    `\t(symbol ${q(`${bare}_0_1`)}`,
    `\t\t(rectangle (start ${f(-half)} ${f(top)}) (end ${f(half)} ${f(-top)})`,
    `\t\t\t(stroke (width 0.254) (type default)) (fill (type background)))`,
    `\t)`,
    `\t(symbol ${q(`${bare}_1_1`)}`,
    ...pinRows,
    `\t)`,
    `\t(embedded_fonts no)`,
    `)`
  ].join('\n')
}

/** lib_id for a component: the mapped stock symbol, a stock header, or a generated box. */
function libIdFor(c: ExportComponent): { libId: string; stock: boolean } {
  if (c.symbol && KICAD_LIB_SYMBOLS[c.symbol]) return { libId: c.symbol, stock: true }
  const conn = /Conn_01x(\d\d)/.exec(c.symbol)
  if (conn && KICAD_LIB_SYMBOLS[`Connector_Generic:Conn_01x${conn[1]}`])
    return { libId: `Connector_Generic:Conn_01x${conn[1]}`, stock: true }
  const name = (c.symbol.split(':')[1] || c.description || c.ref).replace(/[^\w.-]+/g, '_')
  return { libId: `tinyStudio:${name}`, stock: false }
}

/** Outward unit vector (schematic coords, y down) for a pin whose body lies at `rot`. */
function outward(rot: number): [number, number] {
  switch (((rot % 360) + 360) % 360) {
    case 0:
      return [-1, 0] // body to the right: the pin sticks out left
    case 90:
      return [0, 1] // body above (KiCad's y is up): sticks out down
    case 180:
      return [1, 0]
    default:
      return [0, -1]
  }
}

// ── the sheet ────────────────────────────────────────────────────────────────

interface Placed {
  comp: ExportComponent
  libId: string
  def: string
  pins: SymPin[]
  x: number
  y: number
  /** extents relative to (x, y), labels included */
  box: { minX: number; minY: number; maxX: number; maxY: number }
}

export function kicadSchematic(
  doc: CircuitDoc,
  net: NetModel,
  ctx: ExportContext = {},
  opts: SchematicOptions
): SchematicExport {
  const netlist = kicadNetlist(doc, net, ctx, { standIns: opts.standIns })
  const warnings = [...netlist.warnings]
  const sheetUuid = stableUuid(`sheet:${opts.name}`)
  const uid = (what: string): string => stableUuid(`${opts.name}:${what}`)

  // how many pads each net reaches: a pin alone on its net (an unused header
  // pin, a leg wired only to a tinyProto hole) gets a no-connect flag, not a
  // label that ERC would report as dangling
  const fanout = new Map<string, number>()
  for (const name of netlist.padNets.values()) fanout.set(name, (fanout.get(name) ?? 0) + 1)

  const partById = new Map<string, CircuitPart>(doc.parts.map((p) => [p.id, p]))
  const libSymbols = new Map<string, string>()

  // where each symbol goes: the part's schematic-view spot, scaled to KiCad's
  // larger symbols; a stand-in stacks under its board; unplaced parts form a
  // row below everything else
  const standInIndex = new Map<string, number>()
  const draft = netlist.components.map((comp, i) => {
    const { libId, stock } = libIdFor(comp)
    let def = KICAD_LIB_SYMBOLS[libId]
    if (!stock) {
      const byPad = new Map<string, string>()
      for (const [pin, pad] of Object.entries(comp.pads)) if (!byPad.has(pad)) byPad.set(pad, pin)
      const pins = [...byPad]
        .sort((a, b) => Number(a[0]) - Number(b[0]) || a[0].localeCompare(b[0]))
        .map(([number, name]) => ({ number, name }))
      def = genericSymbol(libId, pins)
      warnings.push(`${comp.ref}: no KiCad symbol for this part; the schematic uses a generic box`)
    }
    libSymbols.set(libId, def)
    const pins = symbolPins(def)
    const part = partById.get(comp.partId)
    let px: number | undefined
    let py: number | undefined
    if (part?.sch) {
      px = part.sch.x * MM_PER_PX * SPREAD
      py = part.sch.y * MM_PER_PX * SPREAD
      if (comp.ref !== comp.partId) {
        // a stand-in: the board's headers, one under another
        const k = standInIndex.get(comp.partId) ?? 0
        standInIndex.set(comp.partId, k + 1)
        py += k * 33
      }
    }
    return { comp, libId, def, pins, px, py, order: i }
  })

  // a symbol's footprint on the sheet, its labels included
  const labelLen = (pinNumber: string, comp: ExportComponent): number => {
    const n = netlist.padNets.get(`${comp.ref}:${pinNumber}`)
    return n ? STUB + n.length * 1.0 + 1.27 : 1.27
  }
  const boxOf = (pins: SymPin[], comp: ExportComponent): Placed['box'] => {
    let minX = -2.54
    let maxX = 2.54
    let minY = -2.54
    let maxY = 2.54
    for (const p of pins) {
      const [ox, oy] = outward(p.rot)
      const sx = p.x
      const sy = -p.y
      const reach = labelLen(p.number, comp)
      minX = Math.min(minX, sx, sx + ox * reach)
      maxX = Math.max(maxX, sx, sx + ox * reach)
      minY = Math.min(minY, sy, sy + oy * reach)
      maxY = Math.max(maxY, sy, sy + oy * reach)
    }
    // the reference and value sit to the right
    maxX = Math.max(maxX, 2.54 + 1.27 + 12)
    return { minX, minY, maxX, maxY }
  }

  const placedOnes = draft.filter((d) => d.px !== undefined)
  const minPx = Math.min(...placedOnes.map((d) => d.px!), 0)
  const minPy = Math.min(...placedOnes.map((d) => d.py!), 0)
  let maxBottom = MARGIN
  const placed: Placed[] = []
  const overlaps = (a: Placed['box'], ax: number, ay: number): boolean =>
    placed.some(
      (b) =>
        ax + a.minX < b.x + b.box.maxX + GRID &&
        ax + a.maxX + GRID > b.x + b.box.minX &&
        ay + a.minY < b.y + b.box.maxY + GRID &&
        ay + a.maxY + GRID > b.y + b.box.minY
    )
  const ordered = [...draft].sort((a, b) =>
    a.px === undefined || b.px === undefined
      ? (a.px === undefined ? 1 : 0) - (b.px === undefined ? 1 : 0) || a.order - b.order
      : a.py! - b.py! || a.px - b.px || a.order - b.order
  )
  let rowX = MARGIN
  for (const d of ordered) {
    const box = boxOf(d.pins, d.comp)
    let x: number
    let y: number
    if (d.px !== undefined) {
      x = snap(MARGIN - box.minX + d.px - minPx)
      y = snap(MARGIN - box.minY + d.py! - minPy)
    } else {
      x = snap(rowX - box.minX)
      y = snap(maxBottom + 12.7 - box.minY)
      rowX = x + box.maxX + 5.08
    }
    for (let guard = 0; overlaps(box, x, y) && guard < 400; guard++) y += GRID
    placed.push({ comp: d.comp, libId: d.libId, def: d.def, pins: d.pins, x, y, box })
    if (d.px !== undefined) maxBottom = Math.max(maxBottom, y + box.maxY)
  }
  placed.sort((a, b) => compareRefs(a.comp.ref, b.comp.ref))

  // ── emit ──────────────────────────────────────────────────────────────────
  const symbolUuids = new Map<string, string>()
  const items: string[] = []
  const prop = (
    key: string,
    value: string,
    x: number,
    y: number,
    hide: boolean,
    justify = '',
    angle = 0
  ): string =>
    `\t\t(property ${q(key)} ${q(value)}\n\t\t\t(at ${f(x)} ${f(y)} ${angle})\n` +
    (hide ? '\t\t\t(hide yes)\n' : '') +
    `\t\t\t(show_name no)\n\t\t\t(do_not_autoplace no)\n\t\t\t${font(justify ? ` (justify ${justify})` : '')}\n\t\t)`

  let pwr = 0
  /** A power symbol (power:GND, power:PWR_FLAG) with its pin at (x, y). */
  const powerSymbol = (
    libId: string,
    value: string,
    prefix: string,
    key: string,
    x: number,
    y: number,
    angle: number,
    valueAt: [number, number]
  ): string => {
    const ref = `${prefix}${String(++pwr).padStart(2, '0')}`
    libSymbols.set(libId, KICAD_LIB_SYMBOLS[libId])
    return [
      `\t(symbol`,
      `\t\t(lib_id ${q(libId)})`,
      `\t\t(at ${f(x)} ${f(y)} ${angle})`,
      `\t\t(unit 1)`,
      `\t\t(body_style 1)`,
      `\t\t(exclude_from_sim no)`,
      `\t\t(in_bom yes)`,
      `\t\t(on_board yes)`,
      `\t\t(in_pos_files yes)`,
      `\t\t(dnp no)`,
      `\t\t(uuid ${q(uid(`pwr:${key}`))})`,
      prop('Reference', ref, x, y, true),
      prop('Value', value, valueAt[0], valueAt[1], false),
      prop('Footprint', '', x, y, true),
      prop('Datasheet', '', x, y, true),
      prop('Description', '', x, y, true),
      `\t\t(pin "1" (uuid ${q(uid(`pwrpin:${key}`))}))`,
      `\t\t(instances`,
      `\t\t\t(project ${q(opts.name)}`,
      `\t\t\t\t(path ${q(`/${sheetUuid}`)} (reference ${q(ref)}) (unit 1))`,
      `\t\t\t)`,
      `\t\t)`,
      `\t)`
    ].join('\n')
  }
  for (const p of placed) {
    const { comp } = p
    const uuid = uid(`symbol:${comp.ref}`)
    symbolUuids.set(comp.ref, uuid)
    // the reference and value where the library puts them, else to the right
    const field = (key: string, dy: number): string => {
      const at = libField(p.def, key)
      return at
        ? prop(
            key,
            key === 'Reference' ? comp.ref : comp.value,
            p.x + at.x,
            p.y - at.y,
            false,
            at.justify,
            at.angle
          )
        : prop(
            key,
            key === 'Reference' ? comp.ref : comp.value,
            p.x + 5.08,
            p.y + dy,
            false,
            'left'
          )
    }
    items.push(
      [
        `\t(symbol`,
        `\t\t(lib_id ${q(p.libId)})`,
        `\t\t(at ${f(p.x)} ${f(p.y)} 0)`,
        `\t\t(unit 1)`,
        `\t\t(body_style 1)`,
        `\t\t(exclude_from_sim no)`,
        `\t\t(in_bom yes)`,
        `\t\t(on_board yes)`,
        `\t\t(in_pos_files yes)`,
        `\t\t(dnp no)`,
        `\t\t(uuid ${q(uuid)})`,
        field('Reference', -1.27),
        field('Value', 1.27),
        prop('Footprint', comp.footprint, p.x, p.y, true),
        prop('Datasheet', '', p.x, p.y, true),
        prop('Description', comp.description, p.x, p.y, true),
        ...p.pins.map(
          (pin) => `\t\t(pin ${q(pin.number)} (uuid ${q(uid(`pin:${comp.ref}:${pin.number}`))}))`
        ),
        `\t\t(instances`,
        `\t\t\t(project ${q(opts.name)}`,
        `\t\t\t\t(path ${q(`/${sheetUuid}`)} (reference ${q(comp.ref)}) (unit 1))`,
        `\t\t\t)`,
        `\t\t)`,
        `\t)`
      ].join('\n')
    )

    for (const pin of p.pins) {
      const ax = p.x + pin.x
      const ay = p.y - pin.y
      const name = netlist.padNets.get(`${comp.ref}:${pin.number}`)
      if (!name || (name !== 'GND' && (fanout.get(name) ?? 0) < 2)) {
        items.push(
          `\t(no_connect (at ${f(ax)} ${f(ay)}) (uuid ${q(uid(`nc:${comp.ref}:${pin.number}`))}))`
        )
        continue
      }
      const [ox, oy] = outward(pin.rot)
      const ex = ax + ox * STUB
      const ey = ay + oy * STUB
      items.push(
        `\t(wire (pts (xy ${f(ax)} ${f(ay)}) (xy ${f(ex)} ${f(ey)}))\n` +
          `\t\t(stroke (width 0) (type default))\n\t\t(uuid ${q(uid(`stub:${comp.ref}:${pin.number}`))})\n\t)`
      )
      if (name === 'GND') {
        // a ground symbol hangs off the stub, turned so it points away from the part
        const angle = oy < 0 ? 180 : ox < 0 ? 270 : ox > 0 ? 90 : 0
        items.push(
          powerSymbol('power:GND', 'GND', '#PWR', `${comp.ref}:${pin.number}`, ex, ey, angle, [
            ex + ox * 3.81,
            ey + (oy === 0 ? 3.81 : oy * 5.08)
          ])
        )
        continue
      }
      // label text runs away from the part: 0 = right, 90 = up, 180 = left, 270 = down
      const angle = ox > 0 ? 0 : ox < 0 ? 180 : oy < 0 ? 90 : 270
      const justify = angle === 0 || angle === 90 ? 'left bottom' : 'right bottom'
      items.push(
        `\t(label ${q(name)}\n\t\t(at ${f(ex)} ${f(ey)} ${angle})\n\t\t(fields_autoplaced yes)\n` +
          `\t\t${font(` (justify ${justify})`)}\n\t\t(uuid ${q(uid(`label:${comp.ref}:${pin.number}`))})\n\t)`
      )
    }
  }

  // the smallest sheet that holds it all
  let maxX = 0
  let maxY = 0
  for (const p of placed) {
    maxX = Math.max(maxX, p.x + p.box.maxX)
    maxY = Math.max(maxY, p.y + p.box.maxY)
  }
  // nothing in a tinyStudio circuit drives GND as far as ERC can tell (every
  // pin on it is passive), so a PWR_FLAG says where it comes from: on its own
  // ground symbol, right of the circuit
  if (pwr > 0) {
    const fx = snap(maxX + 12.7)
    const fy = snap(MARGIN + 12.7)
    items.push(
      powerSymbol('power:GND', 'GND', '#PWR', 'flag-gnd', fx, fy, 0, [fx, fy + 5.08]),
      powerSymbol('power:PWR_FLAG', 'PWR_FLAG', '#FLG', 'flag', fx, fy, 0, [fx, fy - 3.81])
    )
    maxX = fx + 12.7
  }
  // the smallest ISO sheet that holds it all, turned upright for a tall layout
  const SHEETS: [string, number, number][] = [
    ['A4', 297, 210],
    ['A3', 420, 297],
    ['A2', 594, 420],
    ['A1', 841, 594]
  ]
  const needW = maxX + MARGIN
  const needH = maxY + MARGIN
  let paper = '"A1"'
  for (const [size, long, short] of SHEETS) {
    if (needW <= long && needH <= short) {
      paper = q(size)
      break
    }
    if (needW <= short && needH <= long) {
      paper = `${q(size)} portrait`
      break
    }
  }

  const indent = (s: string): string =>
    s
      .split('\n')
      .map((l) => '\t\t' + l)
      .join('\n')
  const text = [
    `(kicad_sch`,
    `\t(version ${KICAD_SCH_VERSION})`,
    `\t(generator "tinystudio")`,
    `\t(generator_version "0.5")`,
    `\t(uuid ${q(sheetUuid)})`,
    `\t(paper ${paper})`,
    `\t(title_block`,
    `\t\t(title ${q(opts.title?.trim() || opts.name)})`,
    `\t\t(date ${q(today(ctx))})`,
    `\t\t(comment 1 "Exported from tinyStudio")`,
    `\t)`,
    `\t(lib_symbols`,
    ...[...libSymbols.keys()].sort().map((id) => indent(libSymbols.get(id)!)),
    `\t)`,
    ...items,
    `\t(sheet_instances`,
    `\t\t(path "/" (page "1"))`,
    `\t)`,
    `\t(embedded_fonts no)`,
    `)`,
    ''
  ].join('\n')

  const symbolLibs = [...new Set([...libSymbols.keys()].map((id) => id.split(':')[0]))]
    .filter((lib) => lib !== 'tinyStudio')
    .sort()
  return { text, warnings, sheetUuid, symbolUuids, netlist, symbolLibs }
}
