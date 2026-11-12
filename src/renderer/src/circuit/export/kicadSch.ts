/**
 * circuit/export/kicadSch: the circuit as a KiCad 10 schematic (.kicad_sch).
 *
 * Every exported component (the same set, refs, values, footprints and pads as
 * the netlist: export/kicadNetlist) is drawn with KiCad's own stock symbol
 * (Device:R, Device:LED, Switch:SW_Push…, copied into the file from
 * kicadSymbols.gen.ts so it opens without any library installed). Parts with
 * no stock symbol get a generated box with their pin names.
 *
 * The sheet follows docs/hardware-standards.md:
 *
 *  - US Letter, 50 mil grid, title block filled (SCH-100, -104, -116)
 *  - the circuit split into functional blocks (the tinyCore's headers, the
 *    buttons, the LEDs, decoupling…), each under a 3 mm title, divided by
 *    dashed lines, spread to fill the page around the title block (SCH-112,
 *    -113)
 *  - supplies as power symbols pointing up, GND pointing down (SCH-101)
 *  - nets between blocks as `input` global labels outside the wire end;
 *    nets inside a block drawn as wires (SCH-102, -111)
 *  - simple chains (a button and its pull-down, a resistor and its LED) drawn
 *    as a straight line of parts; unused pins flagged no-connect
 *
 * KiCad joins pins by label and power-symbol name, so the schematic carries
 * exactly the netlist's nets, passes ERC, and "Update PCB from Schematic" gives
 * the same board the netlist import does.
 *
 * UUIDs are derived from the project name and refdes, so re-exporting the same
 * circuit links to the same footprints in a board that's already been laid out.
 */

import type { CircuitDoc } from '../core/model'
import type { NetModel } from '../core/nets'
import { compareRefs, today, type ExportContext } from './common'
import {
  GROUND,
  SUPPLY,
  kicadNetlist,
  q,
  type ExportComponent,
  type NetlistExport,
  type StandIn
} from './kicadNetlist'
import { KICAD_LIB_SYMBOLS } from './kicadSymbols.gen'

/** The .kicad_sch format version KiCad 10 writes. */
export const KICAD_SCH_VERSION = '20260306'

/** 100 mil: the step for everything placed (half of it is SCH-100's 50 mil grid). */
const GRID = 2.54
/** pin-to-label / pin-to-symbol gap (SCH-103) */
const STUB = 2.54
/** room between two parts of a chain */
const LINK = 5.08
const FONT = 1.27

export interface SchematicOptions {
  /** file stem: the sheet is `<name>.kicad_sch`, the KiCad project `<name>` */
  name: string
  /** the title block's title */
  title?: string
  /** components exported in a part's place (a tinyCore's HAT headers) */
  standIns?: Map<string, StandIn[]>
  /** title block company (SCH-104) */
  company?: string
  /** "Designed by" line in the title block (defaults to the document's author) */
  designer?: string
  /** board version for the title block, with the dot (SCH-104) */
  revision?: string
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
 * to the symbol, in library coordinates (y up).
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

/** Every point the symbol's drawing and pins reach, in library coordinates. */
function symbolOutline(def: string): [number, number][] {
  const pts: [number, number][] = []
  // the drawing: polylines, rectangles, circles and arcs inside the units
  const units = def.slice(def.indexOf('(symbol ', 1))
  for (const m of units.matchAll(/\((?:xy|start|end|center|mid) ([-\d.]+) ([-\d.]+)\)/g))
    pts.push([+m[1], +m[2]])
  for (const m of units.matchAll(
    /\(circle\s*\(center ([-\d.]+) ([-\d.]+)\)\s*\(radius ([-\d.]+)\)/g
  )) {
    const [x, y, r] = [+m[1], +m[2], +m[3]]
    pts.push([x - r, y - r], [x + r, y + r])
  }
  for (const p of symbolPins(def)) pts.push([p.x, p.y])
  return pts.length ? pts : [[0, 0]]
}

const f = (n: number): string => String(Math.round(n * 10000) / 10000)
const snap = (v: number): number => Math.round(v / GRID) * GRID
const font = (extra = ''): string => `(effects (font (size ${FONT} ${FONT}))${extra})`
/** Rough width of a line of text at the 1.27 mm font. */
const textW = (s: string): number => s.length * 1.05 + 0.6
/** Rough width of a global label: text, its arrow and padding. */
const glabelW = (s: string): number => textW(s) + 2.6

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

/** A placement's rotation (KiCad: counter-clockwise on the sheet) and vertical mirror. */
interface Orient {
  rot: 0 | 90 | 180 | 270
  mirror: boolean
}

/** A library point (y up) as an offset on the sheet (y down) for a placement. */
function toSheet(x: number, y: number, o: Orient): [number, number] {
  const dx = x
  let dy = -y
  if (o.mirror) dy = -dy
  const a = (o.rot * Math.PI) / 180
  const c = Math.round(Math.cos(a))
  const s = Math.round(Math.sin(a))
  return [dx * c + dy * s, -dx * s + dy * c]
}

/** A pin on the sheet: its offset from the symbol and the way its wire leaves. */
function pinOnSheet(p: SymPin, o: Orient): { dx: number; dy: number; ox: number; oy: number } {
  const [dx, dy] = toSheet(p.x, p.y, o)
  // the body lies at `rot` from the pin; the wire leaves the opposite way
  const a = (p.rot * Math.PI) / 180
  const [bx, by] = toSheet(Math.round(Math.cos(a)), Math.round(Math.sin(a)), o)
  return { dx, dy, ox: -bx, oy: -by }
}

// ── nets and blocks ──────────────────────────────────────────────────────────

type Rail = 'gnd' | 'supply' | null

/** The power symbol a supply net is drawn with; its Value is the net's name. */
function supplySymbol(name: string): string {
  if (/3V3|3\.3V/i.test(name)) return 'power:+3V3'
  if (/^\+?5V$|VBUS/i.test(name)) return 'power:+5V'
  return 'power:VCC'
}

/** What a part does on the sheet, for its block's title. */
function kindOf(libId: string, description: string): string | null {
  if (/^(Switch|SparkFun-Switch):/.test(libId)) return 'Buttons'
  if (/^(Device:LED|SparkFun-LED:)/.test(libId)) return 'LEDs'
  if (/^Device:Buzzer/.test(libId)) return 'Sound'
  if (/^Device:(R_Photo|Thermistor)|^Interface_Optical:|^SparkFun-Sensor:/.test(libId))
    return 'Sensors'
  if (/^Device:R_Potentiometer|Trimpot|Potentiometer/.test(libId)) return 'Inputs'
  if (/^(Transistor_|SparkFun-DiscreteSemi:Q_)/.test(libId)) return 'Drivers'
  if (
    /^(Regulator_|SparkFun-Regulator:|SparkFun-Battery:|SparkFun-Fuse:)|^Device:(Battery|Fuse)/.test(
      libId
    )
  )
    return 'Power'
  if (/^(Connector_Generic|SparkFun-Connector):/.test(libId)) return 'Connectors'
  if (/^Device:(R|C|C_Polarized|L|D|D_Zener)$|^SparkFun-(Resistor|Capacitor|Coil):/.test(libId))
    return null
  return description || 'Circuit'
}

/** Where block kinds go on the sheet, before the ones not listed. */
const KIND_ORDER = ['Buttons', 'Inputs', 'Sensors', 'LEDs', 'Sound', 'Drivers', 'Connectors']
const KIND_LAST = ['Power', 'Decoupling', 'Passives']

interface Comp {
  comp: ExportComponent
  libId: string
  def: string
  pins: SymPin[]
}

// ── drawing primitives, in a block's own coordinates ─────────────────────────

interface Field {
  value: string
  x: number
  y: number
  justify: string
  hide?: boolean
}
interface PlacedSym {
  libId: string
  x: number
  y: number
  o: Orient
  /** a component, or a power symbol */
  comp?: Comp
  power?: { ref: string; value: string; key: string }
  ref?: Field
  val?: Field
}
interface Drawing {
  syms: PlacedSym[]
  wires: [number, number, number, number][]
  glabels: { name: string; x: number; y: number; angle: number }[]
  labels: { name: string; x: number; y: number; angle: number }[]
  ncs: [number, number][]
  /** plain text beside a no-connect: the pin's name (A5) */
  notes: { text: string; x: number; y: number }[]
  junctions: [number, number][]
  /** extents: [minX, minY, maxX, maxY] */
  box: [number, number, number, number]
}

const newDrawing = (): Drawing => ({
  syms: [],
  wires: [],
  glabels: [],
  labels: [],
  ncs: [],
  notes: [],
  junctions: [],
  box: [Infinity, Infinity, -Infinity, -Infinity]
})

function grow(d: Drawing, x0: number, y0: number, x1 = x0, y1 = y0): void {
  d.box[0] = Math.min(d.box[0], x0, x1)
  d.box[1] = Math.min(d.box[1], y0, y1)
  d.box[2] = Math.max(d.box[2], x0, x1)
  d.box[3] = Math.max(d.box[3], y0, y1)
}

/** A symbol's extents on the sheet for a placement. */
function symBox(def: string, o: Orient): [number, number, number, number] {
  let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of symbolOutline(def)) {
    const [sx, sy] = toSheet(x, y, o)
    b = [Math.min(b[0], sx), Math.min(b[1], sy), Math.max(b[2], sx), Math.max(b[3], sy)]
  }
  return b
}

function wire(d: Drawing, x0: number, y0: number, x1: number, y1: number): void {
  if (x0 === x1 && y0 === y1) return
  d.wires.push([x0, y0, x1, y1])
  grow(d, x0, y0, x1, y1)
}

/** A global label at a wire end, leaving `angle` (0 right, 90 up, 180 left, 270 down). */
function glabel(d: Drawing, name: string, x: number, y: number, angle: number): void {
  d.glabels.push({ name, x, y, angle })
  const w = glabelW(name)
  if (angle === 0) grow(d, x, y - 1.3, x + w, y + 1.3)
  else if (angle === 180) grow(d, x - w, y - 1.3, x, y + 1.3)
  else if (angle === 90) grow(d, x - 1.3, y - w, x + 1.3, y)
  else grow(d, x - 1.3, y, x + 1.3, y + w)
}

function label(d: Drawing, name: string, x: number, y: number, angle: number): void {
  d.labels.push({ name, x, y, angle })
  const w = textW(name)
  if (angle === 0) grow(d, x, y - 1.6, x + w, y)
  else if (angle === 180) grow(d, x - w, y - 1.6, x, y)
  else if (angle === 90) grow(d, x - 1.6, y - w, x, y)
  else grow(d, x - 1.6, y, x, y + w)
}

/** A power symbol whose pin is at (x, y): supplies point up, GND down (SCH-101). */
function power(
  d: Drawing,
  net: string,
  rail: 'gnd' | 'supply',
  x: number,
  y: number,
  key: string
): void {
  const libId = rail === 'gnd' ? 'power:GND' : supplySymbol(net)
  const top = rail === 'gnd' ? y + 5.5 : y - 5.5
  d.syms.push({
    libId,
    x,
    y,
    o: { rot: 0, mirror: false },
    power: { ref: '#PWR', value: net, key },
    val: {
      value: net,
      x,
      y: rail === 'gnd' ? y + 5.08 : y - 3.81,
      justify: ''
    }
  })
  grow(d, x - textW(net) / 2 - 0.5, Math.min(y, top), x + textW(net) / 2 + 0.5, Math.max(y, top))
}

/** Place a component; its Reference and Value go beside (`side`) or above/below the body. */
function place(
  d: Drawing,
  c: Comp,
  x: number,
  y: number,
  o: Orient,
  fields: 'right' | 'above'
): void {
  const b = symBox(c.def, o)
  const [x0, y0, x1, y1] = [x + b[0], y + b[1], x + b[2], y + b[3]]
  const ref = c.comp.ref
  const value = c.comp.value
  let rf: Field
  let vf: Field
  if (fields === 'right') {
    const cy = snap((y0 + y1) / 2 / 1.27) * 1.27 === 0 ? (y0 + y1) / 2 : (y0 + y1) / 2
    rf = { value: ref, x: x1 + 1.27, y: cy - 1.27, justify: 'left' }
    vf = { value, x: x1 + 1.27, y: cy + 1.27, justify: 'left' }
    grow(d, x0, y0, x1 + 1.27 + Math.max(textW(ref), textW(value)), y1)
  } else {
    const cx = (x0 + x1) / 2
    rf = { value: ref, x: cx, y: y0 - 1.27, justify: '' }
    vf = { value, x: cx, y: y1 + 1.9, justify: '' }
    const w = Math.max(textW(ref), textW(value)) / 2
    grow(d, Math.min(x0, cx - w), y0 - 2.6, Math.max(x1, cx + w), y1 + 2.6)
  }
  d.syms.push({ libId: c.libId, x, y, o, comp: c, ref: rf, val: vf })
  grow(d, x0, y0, x1, y1)
}

// ── the sheet ────────────────────────────────────────────────────────────────

/** US Letter first (SCH-116); larger sheets only when a design can't fit. */
const PAPERS: { name: string; w: number; h: number }[] = [
  { name: 'USLetter', w: 279.4, h: 215.9 },
  { name: 'USLedger', w: 431.8, h: 279.4 },
  { name: 'A2', w: 594, h: 420 },
  { name: 'A1', w: 841, h: 594 }
]
/** KiCad 10's default drawing sheet: frame inset, and the title block's size. */
const FRAME = 12.7
const TB_W = 120
const TB_H = 44.04

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
  const libSymbols = new Map<string, string>()

  // every component, with the symbol it's drawn with
  const comps: Comp[] = netlist.components.map((comp) => {
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
    return { comp, libId, def, pins: symbolPins(def) }
  })
  comps.sort((a, b) => compareRefs(a.comp.ref, b.comp.ref))

  const netOf = (c: Comp, pin: SymPin): string | undefined =>
    netlist.padNets.get(`${c.comp.ref}:${pin.number}`)
  const fanout = new Map<string, number>()
  for (const name of netlist.padNets.values()) fanout.set(name, (fanout.get(name) ?? 0) + 1)
  const railOf = (n: string): Rail => (GROUND.test(n) ? 'gnd' : SUPPLY.test(n) ? 'supply' : null)
  /** a pin with nothing else on its net: a no-connect (GND and supplies always connect) */
  const alone = (n: string | undefined): boolean => !n || (!railOf(n) && (fanout.get(n) ?? 0) < 2)

  // ── blocks: the board's headers, then parts joined by their own signals ────
  const isCore = (c: Comp): boolean => c.comp.ref !== c.comp.partId
  const core = comps.filter(isCore)
  const rest = comps.filter((c) => !isCore(c))
  const parent = new Map(rest.map((c) => [c, c]))
  const find = (c: Comp): Comp => {
    while (parent.get(c) !== c) c = parent.get(c)!
    return c
  }
  const byNet = new Map<string, Comp[]>()
  for (const c of rest)
    for (const p of c.pins) {
      const n = netOf(c, p)
      if (!n || railOf(n)) continue
      if (!byNet.has(n)) byNet.set(n, [])
      if (!byNet.get(n)!.includes(c)) byNet.get(n)!.push(c)
    }
  for (const members of byNet.values())
    for (const c of members.slice(1)) parent.set(find(c), find(members[0]))
  const groups = new Map<Comp, Comp[]>()
  for (const c of rest) {
    const r = find(c)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r)!.push(c)
  }
  /** a group's nets that reach outside it (another block, or the headers) */
  const groupOf = new Map<Comp, Comp[]>()
  for (const g of groups.values()) for (const c of g) groupOf.set(c, g)
  const external = (n: string, g: Comp[]): boolean => {
    let inside = 0
    for (const c of g) for (const p of c.pins) if (netOf(c, p) === n) inside++
    return (fanout.get(n) ?? 0) > inside
  }

  const kindOfGroup = (g: Comp[]): string => {
    for (const c of g) {
      const k = kindOf(c.libId, c.comp.description)
      if (k) return k
    }
    const nets = new Set(g.flatMap((c) => c.pins.map((p) => netOf(c, p) ?? '')))
    const rails = [...nets].map(railOf)
    if (
      rails.includes('gnd') &&
      rails.includes('supply') &&
      g.every((c) => /^(Device:C|SparkFun-Capacitor:)/.test(c.libId))
    )
      return 'Decoupling'
    return 'Passives'
  }
  const kinds = new Map<string, Comp[][]>()
  for (const g of groups.values()) {
    const k = kindOfGroup(g)
    if (!kinds.has(k)) kinds.set(k, [])
    kinds.get(k)!.push(g)
  }
  const rank = (k: string): number => {
    const i = KIND_ORDER.indexOf(k)
    const j = KIND_LAST.indexOf(k)
    return i >= 0 ? i : j >= 0 ? 100 + j : 50
  }
  const kindNames = [...kinds.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))

  let pwr = 0
  type SheetPin = ReturnType<typeof pinOnSheet> & { p: SymPin; net: string | undefined }
  const pins = (c: Comp, o: Orient): SheetPin[] =>
    c.pins.map((p) => ({ p, ...pinOnSheet(p, o), net: netOf(c, p) }))

  /** Whatever ends a wire at (x, y) for net `n`, leaving in direction (ox, oy). */
  const terminate = (
    d: Drawing,
    n: string,
    g: Comp[] | null,
    x: number,
    y: number,
    ox: number,
    oy: number,
    key: string
  ): void => {
    const rail = railOf(n)
    if (rail) return power(d, n, rail, x, y, key)
    const angle = ox > 0 ? 0 : ox < 0 ? 180 : oy < 0 ? 90 : 270
    if (!g || external(n, g)) glabel(d, n, x, y, angle)
    else label(d, n, x, y, angle)
  }

  // ── the board's headers (SCH-101: GND toward the bottom, supplies the top) ──
  const coreBlock = (): Drawing => {
    const d = newDrawing()
    let y = 0
    for (const c of core) {
      const rows = (o: Orient): SheetPin[] => pins(c, o).sort((a, b) => a.dy - b.dy)
      const score = (o: Orient): number =>
        rows(o).reduce((s, r, i, all) => {
          const rail = r.net ? railOf(r.net) : null
          return s + (rail === 'gnd' ? all.length - 1 - i : rail === 'supply' ? i : 0)
        }, 0)
      const plain: Orient = { rot: 0, mirror: false }
      const flipped: Orient = { rot: 0, mirror: true }
      const o = score(flipped) < score(plain) ? flipped : plain
      const r = rows(o)
      const top = Math.min(...r.map((p) => p.dy))
      const x = 0
      const cy = y - top + 7.62 // room above for supply symbols
      place(d, c, x, cy, o, 'above')
      const ends = r.map((p) => ({ ...p, ex: x + p.dx, ey: cy + p.dy }))
      const signalW = Math.max(
        0,
        ...ends.filter((e) => !alone(e.net) && !railOf(e.net!)).map((e) => glabelW(e.net!))
      )
      const farX = snap(Math.min(...ends.map((e) => e.ex)) - STUB - signalW - GRID)
      const firstY = Math.min(...ends.map((e) => e.ey))
      const lastY = Math.max(...ends.map((e) => e.ey))
      let far = 0
      for (const e of ends) {
        // an unused pin is no-connect, with its name beside it (A5, SDA)
        const n = e.net
        if (alone(n)) {
          d.ncs.push([e.ex, e.ey])
          const was = netlist.unusedNames.get(`${c.comp.ref}:${e.p.number}`)
          if (was) {
            d.notes.push({ text: was, x: e.ex - 1.27, y: e.ey })
            grow(d, e.ex - 1.27 - textW(was), e.ey - 1, e.ex, e.ey + 1)
          }
          continue
        }
        const rail = railOf(n!)
        if (!rail) {
          wire(d, e.ex, e.ey, e.ex - STUB, e.ey)
          glabel(d, n!, e.ex - STUB, e.ey, 180)
          continue
        }
        // a supply runs up, GND down, past the other pins: beside them when
        // nothing is wired there, else beyond their labels
        const passes = ends.filter((o) => (rail === 'gnd' ? o.ey > e.ey : o.ey < e.ey))
        const clear = passes.every((o) => alone(o.net))
        const colX = clear ? e.ex - STUB : farX - GRID * far++
        const endY = rail === 'gnd' ? lastY + 5.08 : firstY - 5.08
        wire(d, e.ex, e.ey, colX, e.ey)
        wire(d, colX, e.ey, colX, endY)
        power(d, n!, rail, colX, endY, `${c.comp.ref}:${e.p.number}`)
      }
      y = snap(d.box[3] + 7.62)
    }
    // what drives each power net, as far as ERC can tell (every pin here is passive)
    const usedRails = [...new Set([...netlist.padNets.values()].filter((n) => railOf(n)))].sort()
    let fx = snap((d.box[0] + d.box[2]) / 2 - (GRID * 8 * usedRails.length) / 2)
    const fy = snap(d.box[3] + 7.62)
    for (const n of usedRails) {
      const rail = railOf(n)!
      power(d, n, rail, fx, fy, `flag-${n}`)
      wire(d, fx, fy, fx + GRID * 4, fy)
      d.syms.push({
        libId: 'power:PWR_FLAG',
        x: fx + GRID * 4,
        y: fy,
        o: { rot: 0, mirror: false },
        power: { ref: '#FLG', value: 'PWR_FLAG', key: `flag-${n}` },
        val: { value: 'PWR_FLAG', x: fx + GRID * 4, y: fy - 3.81, justify: '' }
      })
      grow(d, fx - 3, fy - 5, fx + GRID * 4 + 6, fy + 6)
      fx += GRID * 8
    }
    return d
  }

  // ── a chain: parts strung end to end on their shared nets ──────────────────
  /** The chain's order and the net at each end, or null when the group isn't a simple string. */
  const asChain = (g: Comp[]): { comps: Comp[]; nets: string[] } | null => {
    if (g.some((c) => c.pins.length !== 2)) return null
    const edges = g.map((c) => ({
      c,
      a: netOf(c, c.pins[0]) ?? `nc:${c.comp.ref}:1`,
      b: netOf(c, c.pins[1]) ?? `nc:${c.comp.ref}:2`
    }))
    const degree = new Map<string, number>()
    for (const e of edges) for (const n of [e.a, e.b]) degree.set(n, (degree.get(n) ?? 0) + 1)
    if ([...degree.values()].some((v) => v > 2)) return null
    const ends = [...degree].filter(([, v]) => v === 1).map(([n]) => n)
    if (ends.length !== 2 || degree.size !== g.length + 1) return null
    // top/left end: not GND (a supply first, then a signal)
    const score = (n: string): number => (railOf(n) === 'gnd' ? 2 : railOf(n) === 'supply' ? 0 : 1)
    ends.sort((x, y) => score(x) - score(y))
    const order: Comp[] = []
    const nets = [ends[0]]
    const left = [...edges]
    while (left.length) {
      const at = nets[nets.length - 1]
      const i = left.findIndex((e) => e.a === at || e.b === at)
      if (i < 0) return null
      const [e] = left.splice(i, 1)
      order.push(e.c)
      nets.push(e.a === at ? e.b : e.a)
    }
    return { comps: order, nets }
  }

  /** The orientation that puts `first` before `second` along the chain's axis. */
  const orientFor = (first: SymPin, second: SymPin, vertical: boolean): Orient => {
    for (const rot of [0, 90, 180, 270] as const) {
      const o = { rot, mirror: false }
      const a = pinOnSheet(first, o)
      const b = pinOnSheet(second, o)
      if (vertical ? a.dx === b.dx && a.dy < b.dy : a.dy === b.dy && a.dx < b.dx) return o
    }
    return { rot: 0, mirror: false }
  }

  const chainBlock = (
    g: Comp[],
    chain: { comps: Comp[]; nets: string[] },
    d: Drawing,
    x0: number
  ): void => {
    const { comps: cs, nets } = chain
    const vertical = !!(railOf(nets[0]) || railOf(nets[nets.length - 1]))
    let at = 0 // along the chain: y when vertical, x when horizontal
    let prevEnd: [number, number] | null = null
    cs.forEach((c, i) => {
      const inNet = nets[i]
      const p0 =
        c.pins.find(
          (p) => (netOf(c, p) ?? `nc:${c.comp.ref}:${c.pins.indexOf(p) + 1}`) === inNet
        ) ?? c.pins[0]
      const p1 = c.pins.find((p) => p !== p0)!
      const o = orientFor(p0, p1, vertical)
      const a = pinOnSheet(p0, o)
      const b = pinOnSheet(p1, o)
      const sx = vertical ? x0 - a.dx : x0 + at - a.dx
      const sy = vertical ? at - a.dy : -a.dy
      const start: [number, number] = [sx + a.dx, sy + a.dy]
      const end: [number, number] = [sx + b.dx, sy + b.dy]
      place(d, c, sx, sy, o, vertical ? 'right' : 'above')
      if (i === 0) {
        // the chain's first end
        const n = inNet
        if (alone(n.startsWith('nc:') ? undefined : n)) d.ncs.push(start)
        else if (vertical && !railOf(n)) {
          // a signal on top: up, then out to the left (SCH-102)
          wire(d, start[0], start[1], start[0], start[1] - STUB)
          wire(d, start[0], start[1] - STUB, start[0] - STUB, start[1] - STUB)
          terminate(d, n, g, start[0] - STUB, start[1] - STUB, -1, 0, `${c.comp.ref}:in`)
        } else {
          const [ox, oy] = vertical ? [0, -1] : [-1, 0]
          wire(d, start[0], start[1], start[0] + ox * STUB, start[1] + oy * STUB)
          terminate(d, n, g, start[0] + ox * STUB, start[1] + oy * STUB, ox, oy, `${c.comp.ref}:in`)
        }
      } else if (prevEnd) {
        // the link to the previous part, and a label off its middle if the net leaves the block
        wire(d, prevEnd[0], prevEnd[1], start[0], start[1])
        const n = inNet
        if (external(n, g) || railOf(n)) {
          const mx = (prevEnd[0] + start[0]) / 2
          const my = (prevEnd[1] + start[1]) / 2
          d.junctions.push([mx, my])
          if (vertical) {
            wire(d, mx, my, mx + STUB * 2, my)
            terminate(d, n, g, mx + STUB * 2, my, 1, 0, `${c.comp.ref}:mid`)
          } else {
            wire(d, mx, my, mx, my + STUB * 2)
            terminate(d, n, g, mx, my + STUB * 2, 0, 1, `${c.comp.ref}:mid`)
          }
        }
      }
      if (i === cs.length - 1) {
        const n = nets[nets.length - 1]
        if (alone(n.startsWith('nc:') ? undefined : n)) d.ncs.push(end)
        else if (vertical && railOf(n) !== 'gnd' && !railOf(n)) {
          // a signal at the bottom: down, then out to the left
          wire(d, end[0], end[1], end[0], end[1] + STUB)
          wire(d, end[0], end[1] + STUB, end[0] - STUB, end[1] + STUB)
          terminate(d, n, g, end[0] - STUB, end[1] + STUB, -1, 0, `${c.comp.ref}:out`)
        } else {
          const [ox, oy] = vertical ? [0, 1] : [1, 0]
          wire(d, end[0], end[1], end[0] + ox * STUB, end[1] + oy * STUB)
          terminate(d, n, g, end[0] + ox * STUB, end[1] + oy * STUB, ox, oy, `${c.comp.ref}:out`)
        }
      }
      prevEnd = end
      at = (vertical ? end[1] : end[0]) + LINK
    })
  }

  /** Anything else: the parts in a row, every pin with its own short wire and label. */
  const looseBlock = (g: Comp[], d: Drawing, x0: number): void => {
    let x = x0
    for (const c of g) {
      const o: Orient = { rot: 0, mirror: false }
      const b = symBox(c.def, o)
      const ps = pins(c, o)
      const reach = Math.max(
        0,
        ...ps
          .filter((p) => p.ox < 0)
          .map((p) => (p.net && !alone(p.net) ? glabelW(p.net) + STUB : 1))
      )
      const sx = snap(x - b[0] + reach + GRID)
      place(d, c, sx, 0, o, 'above')
      for (const p of ps) {
        const ex = sx + p.dx
        const ey = p.dy
        if (alone(p.net)) {
          d.ncs.push([ex, ey])
          continue
        }
        wire(d, ex, ey, ex + p.ox * STUB, ey + p.oy * STUB)
        terminate(
          d,
          p.net!,
          g,
          ex + p.ox * STUB,
          ey + p.oy * STUB,
          p.ox,
          p.oy,
          `${c.comp.ref}:${p.p.number}`
        )
      }
      x = d.box[2] + GRID * 2
    }
  }

  const groupBlock = (gs: Comp[][]): Drawing => {
    const d = newDrawing()
    let x = 0
    for (const g of gs) {
      const chain = asChain(g)
      const start = Number.isFinite(d.box[2]) ? snap(d.box[2] + GRID * 4) : 0
      if (chain) {
        // leave room on the left for a label off the chain's top
        const lw =
          !railOf(chain.nets[0]) && !alone(chain.nets[0]) ? glabelW(chain.nets[0]) + STUB * 2 : 0
        chainBlock(g, chain, d, snap(start + lw + GRID))
      } else looseBlock(g, d, start)
      x = d.box[2]
    }
    void x
    return d
  }

  interface Block {
    title: string
    d: Drawing
  }
  const blocks: Block[] = []
  if (core.length) blocks.push({ title: 'tinyCore Headers', d: coreBlock() })
  for (const k of kindNames) blocks.push({ title: k, d: groupBlock(kinds.get(k)!) })
  // a lone schematic (no headers): the power flags go with the last block
  if (!core.length && blocks.length) {
    const d = blocks[blocks.length - 1].d
    const usedRails = [...new Set([...netlist.padNets.values()].filter((n) => railOf(n)))].sort()
    let fx = snap(d.box[0])
    const fy = snap(d.box[3] + 7.62)
    for (const n of usedRails) {
      power(d, n, railOf(n)!, fx, fy, `flag-${n}`)
      wire(d, fx, fy, fx + GRID * 4, fy)
      d.syms.push({
        libId: 'power:PWR_FLAG',
        x: fx + GRID * 4,
        y: fy,
        o: { rot: 0, mirror: false },
        power: { ref: '#FLG', value: 'PWR_FLAG', key: `flag-${n}` },
        val: { value: 'PWR_FLAG', x: fx + GRID * 4, y: fy - 3.81, justify: '' }
      })
      grow(d, fx - 3, fy - 5, fx + GRID * 4 + 6, fy + 6)
      fx += GRID * 8
    }
  }

  // ── pack the blocks onto the sheet (SCH-112, -113, -116) ──────────────────
  const TITLE_GAP = 7.62 // block title above its content
  const PAD = 5.08 // around a block, inside its dividers
  const size = (b: Block): [number, number] => [
    b.d.box[2] - b.d.box[0] + PAD * 2,
    b.d.box[3] - b.d.box[1] + TITLE_GAP + PAD * 2
  ]

  interface Region {
    x0: number
    y0: number
    x1: number
    y1: number
    blocks: Block[]
  }
  let layout: {
    paper: (typeof PAPERS)[number]
    regions: Region[]
    tbLeft: number
    tbTop: number
  } | null = null
  for (const paper of PAPERS) {
    const left = FRAME
    const top = FRAME
    const right = paper.w - FRAME
    const bottom = paper.h - FRAME
    const tbLeft = paper.w - 10 - TB_W + 0.6
    const tbTop = paper.h - 10 - TB_H
    const n = blocks.length
    let best: { score: number; regions: Region[] } | null = null
    // the last k blocks stack above the title block; the rest each get a column
    for (let k = n > 1 ? 1 : 0; k <= Math.max(0, n - 1); k++) {
      const leftBlocks = blocks.slice(0, n - k)
      const rightBlocks = blocks.slice(n - k)
      const rH = rightBlocks.reduce((s, b) => s + size(b)[1], 0)
      const rW = Math.max(0, ...rightBlocks.map((b) => size(b)[0]))
      if (rH > tbTop - top || rW > right - tbLeft) continue
      // columns on the left, stacking the shortest neighbours if the width runs out
      let cols: Block[][] = leftBlocks.map((b) => [b])
      const colW = (c: Block[]): number => Math.max(...c.map((b) => size(b)[0]))
      const colH = (c: Block[]): number => c.reduce((s, b) => s + size(b)[1], 0)
      while (cols.length > 1 && cols.reduce((s, c) => s + colW(c), 0) > tbLeft - left) {
        let bi = -1
        let bh = Infinity
        for (let i = 0; i + 1 < cols.length; i++) {
          const h = colH(cols[i]) + colH(cols[i + 1])
          if (h <= bottom - top && h < bh) {
            bh = h
            bi = i
          }
        }
        if (bi < 0) break
        cols = [...cols.slice(0, bi), [...cols[bi], ...cols[bi + 1]], ...cols.slice(bi + 2)]
      }
      const lw = cols.reduce((s, c) => s + colW(c), 0)
      if (lw > tbLeft - left || cols.some((c) => colH(c) > bottom - top)) continue
      const fillL = leftBlocks.length ? lw / (tbLeft - left) : 1
      const fillR = rightBlocks.length ? rH / (tbTop - top) : 1
      const score = Math.min(fillL, fillR)
      if (best && score <= best.score) continue
      // share the spare width between the columns
      const spare = (tbLeft - left - lw) / Math.max(1, cols.length)
      const regions: Region[] = []
      let cx = left
      for (const c of cols) {
        const w = colW(c) + spare
        regions.push({ x0: cx, y0: top, x1: cx + w, y1: bottom, blocks: c })
        cx += w
      }
      if (rightBlocks.length)
        regions.push({ x0: tbLeft, y0: top, x1: right, y1: tbTop, blocks: rightBlocks })
      best = { score, regions }
    }
    if (!best) {
      // blocks too wide for the columns: stack them across the whole sheet,
      // above the title block
      const h = blocks.reduce((sum, b) => sum + size(b)[1], 0)
      const w = Math.max(...blocks.map((b) => size(b)[0]))
      if (h <= tbTop - top && w <= right - left)
        best = { score: 0, regions: [{ x0: left, y0: top, x1: right, y1: tbTop, blocks }] }
    }
    if (best) {
      layout = { paper, regions: best.regions, tbLeft, tbTop }
      break
    }
  }
  if (!layout) {
    // past A1: one column, as tall as it takes
    const paper = PAPERS[PAPERS.length - 1]
    layout = {
      paper,
      tbLeft: paper.w - 10 - TB_W,
      tbTop: paper.h - 10 - TB_H,
      regions: [{ x0: FRAME, y0: FRAME, x1: paper.w - 10 - TB_W, y1: paper.h - FRAME, blocks }]
    }
    warnings.push('The schematic is larger than an A1 sheet; check its layout in KiCad')
  }

  // ── emit ──────────────────────────────────────────────────────────────────
  const symbolUuids = new Map<string, string>()
  const items: string[] = []
  const prop = (
    key: string,
    fld: Field | undefined,
    x: number,
    y: number,
    hide: boolean,
    rot = 0
  ): string => {
    const at = fld ?? { value: '', x, y, justify: '' }
    // KiCad turns a field with its symbol: undo that so the text reads level (SCH-114)
    const angle = rot % 180 === 90 ? 90 : 0
    // …and a field turned upside down by it is drawn the right way up with its
    // justification mirrored: mirror it back
    const flipped = (angle + rot) % 360 === 180
    const justify = flipped
      ? at.justify.replace(/\b(left|right)\b/, (j) => (j === 'left' ? 'right' : 'left'))
      : at.justify
    return (
      `\t\t(property ${q(key)} ${q(at.value)}\n\t\t\t(at ${f(at.x)} ${f(at.y)} ${angle})\n` +
      (hide || at.hide ? '\t\t\t(hide yes)\n' : '') +
      `\t\t\t(show_name no)\n\t\t\t(do_not_autoplace no)\n\t\t\t${font(justify ? ` (justify ${justify})` : '')}\n\t\t)`
    )
  }
  const shift = (fld: Field | undefined, dx: number, dy: number): Field | undefined =>
    fld && { ...fld, x: fld.x + dx, y: fld.y + dy }

  const emitBlock = (b: Block, dx: number, dy: number): void => {
    const d = b.d
    for (const s of d.syms) {
      const x = s.x + dx
      const y = s.y + dy
      const orient = `(at ${f(x)} ${f(y)} ${s.o.rot})${s.o.mirror ? '\n\t\t(mirror x)' : ''}`
      if (s.comp) {
        const comp = s.comp.comp
        const uuid = uid(`symbol:${comp.ref}`)
        symbolUuids.set(comp.ref, uuid)
        items.push(
          [
            `\t(symbol`,
            `\t\t(lib_id ${q(s.libId)})`,
            `\t\t${orient}`,
            `\t\t(unit 1)`,
            `\t\t(body_style 1)`,
            `\t\t(exclude_from_sim no)`,
            `\t\t(in_bom yes)`,
            `\t\t(on_board yes)`,
            `\t\t(in_pos_files yes)`,
            `\t\t(dnp no)`,
            `\t\t(uuid ${q(uuid)})`,
            prop('Reference', shift(s.ref, dx, dy), x, y, false, s.o.rot),
            prop('Value', shift(s.val, dx, dy), x, y, false, s.o.rot),
            prop('Footprint', { value: comp.footprint, x, y, justify: '' }, x, y, true),
            prop('Datasheet', { value: comp.datasheet ?? '', x, y, justify: '' }, x, y, true),
            prop('Description', { value: comp.description, x, y, justify: '' }, x, y, true),
            ...(comp.prodId !== undefined && KICAD_LIB_SYMBOLS[s.libId]?.includes('"PROD_ID"')
              ? [prop('PROD_ID', { value: comp.prodId, x, y, justify: '' }, x, y, true)]
              : []),
            ...s.comp.pins.map(
              (pin) =>
                `\t\t(pin ${q(pin.number)} (uuid ${q(uid(`pin:${comp.ref}:${pin.number}`))}))`
            ),
            `\t\t(instances`,
            `\t\t\t(project ${q(opts.name)}`,
            `\t\t\t\t(path ${q(`/${sheetUuid}`)} (reference ${q(comp.ref)}) (unit 1))`,
            `\t\t\t)`,
            `\t\t)`,
            `\t)`
          ].join('\n')
        )
      } else if (s.power) {
        libSymbols.set(s.libId, KICAD_LIB_SYMBOLS[s.libId])
        const ref = `${s.power.ref}${String(++pwr).padStart(2, '0')}`
        items.push(
          [
            `\t(symbol`,
            `\t\t(lib_id ${q(s.libId)})`,
            `\t\t${orient}`,
            `\t\t(unit 1)`,
            `\t\t(body_style 1)`,
            `\t\t(exclude_from_sim no)`,
            `\t\t(in_bom yes)`,
            `\t\t(on_board yes)`,
            `\t\t(in_pos_files yes)`,
            `\t\t(dnp no)`,
            `\t\t(uuid ${q(uid(`pwr:${s.power.key}:${s.libId}`))})`,
            prop('Reference', { value: ref, x, y, justify: '' }, x, y, true),
            prop('Value', shift(s.val, dx, dy), x, y, false),
            prop('Footprint', undefined, x, y, true),
            prop('Datasheet', undefined, x, y, true),
            prop('Description', undefined, x, y, true),
            `\t\t(pin "1" (uuid ${q(uid(`pwrpin:${s.power.key}:${s.libId}`))}))`,
            `\t\t(instances`,
            `\t\t\t(project ${q(opts.name)}`,
            `\t\t\t\t(path ${q(`/${sheetUuid}`)} (reference ${q(ref)}) (unit 1))`,
            `\t\t\t)`,
            `\t\t)`,
            `\t)`
          ].join('\n')
        )
      }
    }
    d.wires.forEach(([x0, y0, x1, y1], i) =>
      items.push(
        `\t(wire (pts (xy ${f(x0 + dx)} ${f(y0 + dy)}) (xy ${f(x1 + dx)} ${f(y1 + dy)}))\n` +
          `\t\t(stroke (width 0) (type default))\n\t\t(uuid ${q(uid(`wire:${b.title}:${i}`))})\n\t)`
      )
    )
    d.junctions.forEach(([x, y], i) =>
      items.push(
        `\t(junction (at ${f(x + dx)} ${f(y + dy)}) (diameter 0) (color 0 0 0 0)\n\t\t(uuid ${q(uid(`junction:${b.title}:${i}`))})\n\t)`
      )
    )
    d.ncs.forEach(([x, y], i) =>
      items.push(
        `\t(no_connect (at ${f(x + dx)} ${f(y + dy)}) (uuid ${q(uid(`nc:${b.title}:${i}`))}))`
      )
    )
    d.notes.forEach((t, i) =>
      items.push(
        `\t(text ${q(t.text)}\n\t\t(exclude_from_sim no)\n\t\t(at ${f(t.x + dx)} ${f(t.y + dy)} 0)\n` +
          `\t\t${font(' (justify right)')}\n\t\t(uuid ${q(uid(`note:${b.title}:${i}`))})\n\t)`
      )
    )
    d.labels.forEach((l, i) => {
      const justify = l.angle === 0 || l.angle === 90 ? 'left bottom' : 'right bottom'
      items.push(
        `\t(label ${q(l.name)}\n\t\t(at ${f(l.x + dx)} ${f(l.y + dy)} ${l.angle})\n\t\t(fields_autoplaced yes)\n` +
          `\t\t${font(` (justify ${justify})`)}\n\t\t(uuid ${q(uid(`label:${b.title}:${i}`))})\n\t)`
      )
    })
    d.glabels.forEach((l, i) => {
      const justify = l.angle === 0 || l.angle === 90 ? 'left' : 'right'
      const x = l.x + dx
      const y = l.y + dy
      items.push(
        [
          `\t(global_label ${q(l.name)}`,
          `\t\t(shape input)`,
          `\t\t(at ${f(x)} ${f(y)} ${l.angle})`,
          `\t\t(fields_autoplaced yes)`,
          `\t\t${font(` (justify ${justify})`)}`,
          `\t\t(uuid ${q(uid(`glabel:${b.title}:${i}`))})`,
          `\t\t(property "Intersheetrefs" "\${INTERSHEET_REFS}"`,
          `\t\t\t(at ${f(x)} ${f(y)} 0)`,
          `\t\t\t(hide yes)`,
          `\t\t\t(show_name no)`,
          `\t\t\t(do_not_autoplace no)`,
          `\t\t\t${font(` (justify ${justify})`)}`,
          `\t\t)`,
          `\t)`
        ].join('\n')
      )
    })
  }

  const dashed = (x0: number, y0: number, x1: number, y1: number, key: string): string =>
    `\t(polyline\n\t\t(pts (xy ${f(x0)} ${f(y0)}) (xy ${f(x1)} ${f(y1)}))\n` +
    `\t\t(stroke (width 0) (type dash))\n\t\t(uuid ${q(uid(`divider:${key}`))})\n\t)`

  const { paper, regions, tbLeft, tbTop } = layout
  regions.forEach((r, ri) => {
    // blocks spread down the region, each centred in its share
    const total = r.blocks.reduce((s, b) => s + size(b)[1], 0)
    const gap = (r.y1 - r.y0 - total) / r.blocks.length
    let y = r.y0
    r.blocks.forEach((b, bi) => {
      const [, h] = size(b)
      const share = h + gap
      const cx = (r.x0 + r.x1) / 2
      const contentTop = y + (share - h) / 2 + PAD + TITLE_GAP
      const dx = snap(cx - (b.d.box[0] + b.d.box[2]) / 2)
      const dy = snap(contentTop - b.d.box[1])
      emitBlock(b, dx, dy)
      // the block's title, 3 mm, centred above it (SCH-112)
      const titleY = dy + b.d.box[1] - TITLE_GAP + 2
      items.push(
        `\t(text ${q(b.title)}\n\t\t(exclude_from_sim no)\n\t\t(at ${f(snap((cx / 1.27) * 1.27 * 2) / 2)} ${f(titleY)} 0)\n` +
          `\t\t(effects (font (size 3 3) (thickness 0.6) (bold yes)))\n\t\t(uuid ${q(uid(`title:${b.title}`))})\n\t)`
      )
      y += share
      if (bi < r.blocks.length - 1) items.push(dashed(r.x0, y, r.x1, y, `h:${ri}:${bi}`))
    })
    // the divider on the region's right: down to the title block beside it
    if (ri < regions.length - 1) {
      const next = regions[ri + 1]
      const yEnd = next.x0 >= tbLeft - 0.01 && r.x1 >= tbLeft - 0.01 ? tbTop : r.y1
      items.push(
        dashed(
          r.x1,
          r.y0,
          r.x1,
          next.x0 >= tbLeft - 0.01 ? (r.x1 >= tbLeft - 0.01 ? tbTop : paper.h - FRAME) : yEnd,
          `v:${ri}`
        )
      )
    }
  })

  const designer = opts.designer ?? doc.meta?.author
  const text = [
    `(kicad_sch`,
    `\t(version ${KICAD_SCH_VERSION})`,
    `\t(generator "tinystudio")`,
    `\t(generator_version "0.5")`,
    `\t(uuid ${q(sheetUuid)})`,
    `\t(paper ${q(paper.name)})`,
    `\t(title_block`,
    `\t\t(title ${q(opts.title?.trim() || opts.name)})`,
    `\t\t(date ${q(today(ctx))})`,
    `\t\t(rev ${q(opts.revision ?? 'v0.1')})`,
    ...(opts.company ? [`\t\t(company ${q(opts.company)})`] : []),
    `\t\t(comment 1 ${q(designer ? `Designed by: ${designer}` : 'Exported from tinyStudio')})`,
    ...(designer ? [`\t\t(comment 2 "Exported from tinyStudio")`] : []),
    `\t)`,
    `\t(lib_symbols`,
    ...[...libSymbols.keys()].sort().map((id) =>
      libSymbols
        .get(id)!
        .split('\n')
        .map((l) => '\t\t' + l)
        .join('\n')
    ),
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
    .filter((lib) => lib !== 'tinyStudio' && !lib.startsWith('SparkFun-'))
    .sort()
  return { text, warnings, sheetUuid, symbolUuids, netlist, symbolLibs }
}
