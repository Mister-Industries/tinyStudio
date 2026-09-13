/**
 * circuit/parts/symbolLibrary — the hand-authored schematic symbol set
 * (spec §8: "US/IEEE default, black ink, 2 px strokes, standard library").
 *
 * Fritzing ships a schematic SVG with every part, but those symbols were drawn
 * by many different authors: stroke weights vary from hairline to heavy, text
 * carries baked-in blues and oranges, and the same resistor can be twice the
 * size of the capacitor next to it. Dropping them on one sheet looks like a
 * ransom note. So the parts we ship draw from this library instead — one
 * geometry vocabulary, one stroke weight, one type stack, every pin on the
 * 9.6 px major grid.
 *
 * ── Geometry conventions ────────────────────────────────────────────────────
 * Two-terminal parts are 6 grid wide and 2 grid tall, pins at the left and
 * right edges on the centre line, so any two of them stack and align without
 * a jog in the wire. Parts that need headroom (an LED's emission arrows, a
 * potentiometer's wiper) grow DOWNWARD to 3 grid and keep the pin row on a
 * grid line. Three-terminal actives are 4 grid square with the control pin on
 * the left and the two power pins top and bottom — the orientation schematics
 * are normally read in.
 *
 * ── Pin binding ─────────────────────────────────────────────────────────────
 * A symbol declares SLOTS by role ("anode", "wiper", "collector"), not by pin
 * name, because the same symbol has to serve parts whose Fritzing pin names
 * are 'Pin 0'/'Pin 1', '0'/'1', 'pin 0'/'pin 1', 'cathode'/'anode' or '-'/'+'.
 * `bindSymbol` matches each slot to one of the part's real pin names by regex,
 * falling back to definition order. The returned PartView is keyed by the
 * part's OWN pin names, which is what keeps existing wires and nets valid when
 * a part's symbol changes underneath them.
 */

import type { PartView } from '../../lib/partsLibrary'
import { FONT_SYMBOL, INK, SCH_GRID, STROKE, circle, line, path, symbolSvg, text } from './style'

const P = SCH_GRID // 9.6

// ── shared metrics ───────────────────────────────────────────────────────────

/** Two-terminal footprint: 6 grid long, pins on the centre line. */
const W2 = 6 * P // 57.6
const H2 = 2 * P // 19.2
const CY = P // 9.6 — centre line of a plain two-terminal symbol
/** Two-terminal footprint with headroom (LED arrows, pot wiper): pins one grid lower. */
const H3 = 3 * P // 28.8
const CY3 = 2 * P // 19.2
/** Body span for a two-terminal symbol — 1.5 grid of lead at each end. */
const BX0 = 1.5 * P // 14.4
const BX1 = W2 - BX0 // 43.2

/** Three-terminal (active) footprint: 4 grid square. */
const WA = 4 * P // 38.4
const HA = 4 * P // 38.4

export interface SymbolSlot {
  /** What this terminal IS, independent of what the part file calls it. */
  role: string
  /** Pin tip, local coordinates. Always lands on the major grid. */
  pos: [number, number]
  /** Patterns tried, in order, against the part's real pin names. */
  match?: RegExp[]
}

export interface SymbolDef {
  w: number
  h: number
  slots: SymbolSlot[]
  /** Body markup, drawn with the shared style tokens. */
  body: string
}

// ── drawing helpers ──────────────────────────────────────────────────────────

/** Horizontal leads from both edges to the body of a two-terminal symbol. */
function leads(x0: number, x1: number, cy = CY): string {
  return line(0, cy, x0, cy) + line(x1, cy, W2, cy)
}

/** IEEE zigzag between x0 and x1 on centre line cy, `peaks` full swings. */
function zigzag(x0: number, x1: number, cy: number, peaks = 6, amp = 0.5 * P): string {
  const span = x1 - x0
  const step = span / (peaks + 1)
  let d = `M${x0} ${cy}`
  for (let i = 0; i <= peaks; i++) {
    const x = x0 + step * (i + 0.5)
    d += ` L${round(x)} ${round(cy + (i % 2 === 0 ? -amp : amp))}`
  }
  return path(d + ` L${x1} ${cy}`)
}

/** An arrowhead at (x,y) pointing along (dx,dy), used for emission/wiper marks. */
function arrowHead(x: number, y: number, dx: number, dy: number, size = 4): string {
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const bx = x - ux * size
  const by = y - uy * size
  const px = -uy * size * 0.45
  const py = ux * size * 0.45
  return path(
    `M${round(x)} ${round(y)} L${round(bx + px)} ${round(by + py)} L${round(bx - px)} ${round(by - py)} Z`,
    1,
    INK,
    INK
  )
}

/** A light-emission / light-sensing arrow pair beside a body. */
function lightArrows(x: number, y: number, inward: boolean): string {
  const draw = (ox: number): string => {
    // arrows run at 45°, up and to the right of the body
    const x1 = x + ox
    const y1 = y
    const x2 = x1 + 8
    const y2 = y - 8
    const tipX = inward ? x1 : x2
    const tipY = inward ? y1 : y2
    return (
      line(x1, y1, x2, y2, 1.4) +
      arrowHead(tipX, tipY, inward ? x1 - x2 : x2 - x1, inward ? y1 - y2 : y2 - y1, 3.6)
    )
  }
  return draw(0) + draw(6)
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

// ── two-terminal slot presets ────────────────────────────────────────────────

const PLAIN2 = (cy = CY): SymbolSlot[] => [
  { role: 'a', pos: [0, cy] },
  { role: 'b', pos: [W2, cy] }
]

/** Polarity-aware pair: the named terminal on the left. */
const POLAR2 = (
  leftRole: string,
  leftMatch: RegExp[],
  rightRole: string,
  rightMatch: RegExp[],
  cy = CY
): SymbolSlot[] => [
  { role: leftRole, pos: [0, cy], match: leftMatch },
  { role: rightRole, pos: [W2, cy], match: rightMatch }
]

const ANODE = [/anode/i, /^\+$/, /^a$/i]
const CATHODE = [/cathode|kath/i, /^-$/, /^k$/i, /^c$/i]
const POS = [/^\+$/, /^pos/i, /^vcc$/i, /anode/i]
const NEG = [/^-$/, /^neg/i, /^gnd$/i, /cathode/i]

// ── the library ──────────────────────────────────────────────────────────────

/** Resistor — IEEE zigzag. */
const resistor: SymbolDef = {
  w: W2,
  h: H2,
  slots: PLAIN2(),
  body: leads(BX0, BX1) + zigzag(BX0, BX1, CY)
}

/** Non-polarised capacitor — two parallel plates. */
const capacitor: SymbolDef = (() => {
  const gap = 0.75 * P
  const x0 = W2 / 2 - gap / 2
  const x1 = W2 / 2 + gap / 2
  const half = 0.62 * P
  return {
    w: W2,
    h: H2,
    slots: PLAIN2(),
    body: leads(x0, x1) + line(x0, CY - half, x0, CY + half) + line(x1, CY - half, x1, CY + half)
  }
})()

/** Polarised capacitor — straight plate, curved plate, plus sign. */
const capacitorPolar: SymbolDef = (() => {
  const x0 = W2 / 2 - 0.4 * P
  const x1 = W2 / 2 + 0.4 * P
  const half = 0.62 * P
  return {
    w: W2,
    h: H2,
    slots: POLAR2('+', POS, '-', NEG),
    body:
      leads(x0, x1) +
      line(x0, CY - half, x0, CY + half) +
      path(`M${x1} ${CY - half} A ${half * 1.5} ${half * 1.5} 0 0 1 ${x1} ${CY + half}`) +
      text(x0 - 8, CY - half + 1, '+', { size: FONT_SYMBOL, anchor: 'middle' })
  }
})()

/** Inductor — four half-circle humps. */
const inductor: SymbolDef = (() => {
  const humps = 4
  const span = BX1 - BX0
  const r = span / humps / 2
  let d = `M${BX0} ${CY}`
  for (let i = 0; i < humps; i++) d += ` a ${round(r)} ${round(r)} 0 0 1 ${round(r * 2)} 0`
  return { w: W2, h: H2, slots: PLAIN2(), body: leads(BX0, BX1) + path(d) }
})()

/** Fuse — body with a conductor straight through it. */
const fuse: SymbolDef = (() => {
  const x0 = W2 / 2 - 1.2 * P
  const x1 = W2 / 2 + 1.2 * P
  const half = 0.45 * P
  return {
    w: W2,
    h: H2,
    slots: PLAIN2(),
    body:
      leads(x0, x1) +
      `<rect x="${x0}" y="${round(CY - half)}" width="${round(x1 - x0)}" height="${round(half * 2)}" fill="none" stroke="${INK}" stroke-width="${STROKE}"/>` +
      line(x0, CY, x1, CY)
  }
})()

/** Diode body shared by the diode family: triangle + cathode bar. */
function diodeBody(cy: number, barExtra = ''): string {
  const tipX = W2 / 2 + 0.5 * P
  const backX = W2 / 2 - 0.5 * P
  const half = 0.62 * P
  return (
    leads(backX, tipX, cy) +
    path(
      `M${backX} ${round(cy - half)} L${backX} ${round(cy + half)} L${tipX} ${cy} Z`,
      STROKE,
      INK,
      INK
    ) +
    line(tipX, cy - half, tipX, cy + half) +
    barExtra
  )
}

const diode: SymbolDef = {
  w: W2,
  h: H2,
  slots: POLAR2('anode', ANODE, 'cathode', CATHODE),
  body: diodeBody(CY)
}

/** Zener — cathode bar with the characteristic bent ends. */
const zener: SymbolDef = (() => {
  const tipX = W2 / 2 + 0.5 * P
  const half = 0.62 * P
  const flag = 0.42 * P
  return {
    w: W2,
    h: H2,
    slots: POLAR2('anode', ANODE, 'cathode', CATHODE),
    body: diodeBody(
      CY,
      line(tipX, CY - half, tipX - flag, CY - half) + line(tipX, CY + half, tipX + flag, CY + half)
    )
  }
})()

/** LED — diode with emission arrows. */
const led: SymbolDef = {
  w: W2,
  h: H3,
  slots: POLAR2('anode', ANODE, 'cathode', CATHODE, CY3),
  body: diodeBody(CY3) + lightArrows(W2 / 2 - 0.4 * P, CY3 - 0.9 * P, false)
}

/** Photoresistor — zigzag with incident-light arrows. */
const photoresistor: SymbolDef = {
  w: W2,
  h: H3,
  slots: PLAIN2(CY3),
  body:
    leads(BX0, BX1, CY3) +
    zigzag(BX0, BX1, CY3) +
    lightArrows(W2 / 2 - 0.9 * P, CY3 - 1.1 * P, true)
}

/** Thermistor — zigzag crossed by the temperature-dependence stroke. */
const thermistor: SymbolDef = {
  w: W2,
  h: H2,
  slots: PLAIN2(),
  body:
    leads(BX0, BX1) +
    zigzag(BX0, BX1, CY) +
    line(BX0 - 1.6, CY + 0.85 * P, BX1 - 4, CY - 0.95 * P, 1.4) +
    line(BX0 - 1.6, CY + 0.85 * P, BX0 + 3.4, CY + 0.85 * P, 1.4)
}

/** SPST switch — hinged blade between two contacts. */
const switchSpst: SymbolDef = {
  w: W2,
  h: H2,
  slots: PLAIN2(),
  body:
    line(0, CY, 2 * P, CY) +
    line(4 * P, CY, W2, CY) +
    circle(2 * P, CY, 1.7, STROKE, INK, INK) +
    circle(4 * P, CY, 1.7, STROKE, INK, INK) +
    line(2 * P, CY, 3.9 * P, CY - 0.72 * P)
}

/** Momentary pushbutton — plunger over a pair of contacts. */
const pushbutton: SymbolDef = {
  w: W2,
  h: H3,
  slots: PLAIN2(CY3),
  body:
    line(0, CY3, 2 * P, CY3) +
    line(4 * P, CY3, W2, CY3) +
    circle(2 * P, CY3, 1.7, STROKE, INK, INK) +
    circle(4 * P, CY3, 1.7, STROKE, INK, INK) +
    line(1.7 * P, CY3 - 0.62 * P, 4.3 * P, CY3 - 0.62 * P) +
    line(W2 / 2, CY3 - 0.62 * P, W2 / 2, CY3 - 1.35 * P) +
    line(W2 / 2 - 0.5 * P, CY3 - 1.35 * P, W2 / 2 + 0.5 * P, CY3 - 1.35 * P)
}

/** Reed switch — blades sealed in a glass envelope. */
const reedSwitch: SymbolDef = {
  w: W2,
  h: H2,
  slots: PLAIN2(),
  body:
    line(0, CY, 1.8 * P, CY) +
    line(4.2 * P, CY, W2, CY) +
    `<rect x="${1.5 * P}" y="${round(CY - 0.7 * P)}" width="${3 * P}" height="${round(1.4 * P)}" rx="${round(0.7 * P)}" fill="none" stroke="${INK}" stroke-width="1.4"/>` +
    line(1.8 * P, CY, 2.9 * P, CY) +
    line(4.2 * P, CY, 3.1 * P, CY - 0.42 * P)
}

/** Potentiometer — resistor body with a wiper arrow onto it. */
const potentiometer: SymbolDef = {
  w: W2,
  h: H3,
  slots: [
    { role: 'leg1', pos: [0, CY3], match: [/leg1|^1$/i] },
    { role: 'leg2', pos: [W2, CY3], match: [/leg2|^3$/i] },
    { role: 'wiper', pos: [W2 / 2, 0], match: [/wiper|^2$/i] }
  ],
  body:
    leads(BX0, BX1, CY3) +
    zigzag(BX0, BX1, CY3) +
    line(W2 / 2, 0, W2 / 2, CY3 - 0.62 * P) +
    arrowHead(W2 / 2, CY3 - 0.42 * P, 0, 1, 5.5)
}

/**
 * Two-cell battery — alternating long (positive) and short (negative) plates.
 * Uses the taller footprint so the polarity mark has room above the plates
 * instead of being clipped by the symbol's own bounding box.
 */
const battery: SymbolDef = (() => {
  const cells = 2
  const pitch = 0.72 * P
  const startX = W2 / 2 - (cells * 2 - 1) * pitch * 0.5
  let art = ''
  let x = startX
  for (let i = 0; i < cells * 2; i++) {
    const long = i % 2 === 0
    const half = long ? 0.78 * P : 0.34 * P
    art += line(x, CY3 - half, x, CY3 + half)
    x += pitch
  }
  const lastX = x - pitch
  return {
    w: W2,
    h: H3,
    slots: POLAR2('+', POS, '-', NEG, CY3),
    body:
      line(0, CY3, startX, CY3) +
      line(lastX, CY3, W2, CY3) +
      art +
      text(startX - 4, CY3 - 1.05 * P, '+', { size: FONT_SYMBOL, anchor: 'middle' })
  }
})()

/** Buzzer / piezo sounder — half-disc on its flat side. */
const buzzer: SymbolDef = (() => {
  const w = 4 * P
  const h = 3 * P
  const flatY = 2 * P
  const x0 = P
  const x1 = 3 * P
  return {
    w,
    h,
    slots: [
      { role: '+', pos: [x0, h], match: POS },
      { role: '-', pos: [x1, h], match: NEG }
    ],
    body:
      // dome, then the flat face as its own stroke — a closed-path `Z` is at
      // the mercy of the renderer's join handling; an explicit line is not
      path(
        `M${x0} ${flatY} A ${round((x1 - x0) / 2)} ${round((x1 - x0) / 2)} 0 0 1 ${x1} ${flatY}`
      ) +
      line(x0, flatY, x1, flatY) +
      line(x0, flatY, x0, h) +
      line(x1, flatY, x1, h)
  }
})()

/** Electret microphone — diaphragm chord across a capsule. */
const microphone: SymbolDef = {
  w: W2,
  h: H2,
  slots: PLAIN2(),
  body:
    leads(2.2 * P, 4.4 * P) +
    circle(W2 / 2, CY, 0.85 * P) +
    line(W2 / 2 - 0.4 * P, CY - 0.68 * P, W2 / 2 - 0.4 * P, CY + 0.68 * P)
}

/** Bipolar transistor, drawn vertically: base left, collector top, emitter bottom. */
function bjt(npn: boolean): SymbolDef {
  const cx = 2 * P
  const cy = 2 * P
  const r = 1.42 * P
  const barX = 1.5 * P
  const railX = 3 * P
  const barTop = cy - 1 * P
  const barBot = cy + 1 * P
  // diagonal legs from the base bar out to the collector/emitter rails
  const colJoin: [number, number] = [barX, cy - 0.62 * P]
  const emJoin: [number, number] = [barX, cy + 0.62 * P]
  const colRail: [number, number] = [railX, cy - 1.42 * P]
  const emRail: [number, number] = [railX, cy + 1.42 * P]
  // NPN: arrow on the emitter pointing away from the base; PNP: toward it
  const from = npn ? emJoin : emRail
  const to = npn ? emRail : emJoin
  const midX = (from[0] + to[0]) / 2
  const midY = (from[1] + to[1]) / 2
  return {
    w: WA,
    h: HA,
    slots: [
      { role: 'base', pos: [0, cy], match: [/^b$/i, /base/i] },
      { role: 'collector', pos: [railX, 0], match: [/^c$/i, /collector/i] },
      { role: 'emitter', pos: [railX, HA], match: [/^e$/i, /emitter/i] }
    ],
    body:
      circle(cx, cy, r, 1.4) +
      line(0, cy, barX, cy) +
      line(barX, barTop, barX, barBot) +
      line(colJoin[0], colJoin[1], colRail[0], colRail[1]) +
      line(colRail[0], colRail[1], railX, 0) +
      line(emJoin[0], emJoin[1], emRail[0], emRail[1]) +
      line(emRail[0], emRail[1], railX, HA) +
      arrowHead(midX, midY, to[0] - from[0], to[1] - from[1], 5)
  }
}

/** N-channel enhancement MOSFET: gate left, drain top, source bottom. */
const nmos: SymbolDef = (() => {
  const cy = 2 * P
  const gateX = P
  const chanX = 1.65 * P
  const railX = 3 * P
  const seg = 0.5 * P
  const rows: number[] = [cy - 1.05 * P, cy, cy + 1.05 * P]
  let channel = ''
  for (const y of rows) channel += line(chanX, y - seg, chanX, y + seg)
  return {
    w: WA,
    h: HA,
    slots: [
      { role: 'gate', pos: [0, cy], match: [/^g$/i, /gate/i] },
      { role: 'drain', pos: [railX, 0], match: [/^d$/i, /drain/i] },
      { role: 'source', pos: [railX, HA], match: [/^s$/i, /source/i] }
    ],
    body:
      line(0, cy, gateX, cy) +
      line(gateX, cy - 1.35 * P, gateX, cy + 1.35 * P) +
      channel +
      line(chanX, rows[0], railX, rows[0]) +
      line(railX, rows[0], railX, 0) +
      line(chanX, rows[2], railX, rows[2]) +
      line(railX, rows[2], railX, HA) +
      // bulk tie to the source, with the N-channel arrow pointing into the channel
      line(chanX, cy, railX, cy) +
      line(railX, cy, railX, rows[2]) +
      arrowHead(chanX + 1.5, cy, -1, 0, 5.5)
  }
})()

/** Relay — coil on the left, changeover contact on the right. */
const relay: SymbolDef = (() => {
  const w = 6 * P
  const h = 6 * P
  const coilX0 = P
  const coilX1 = 2.5 * P
  const coilY0 = 1.5 * P
  const coilY1 = 4.5 * P
  const contactX = 4.5 * P
  return {
    w,
    h,
    slots: [
      { role: 'coil1', pos: [0, 2 * P], match: [/coil.*1|^coil$/i] },
      { role: 'coil2', pos: [0, 4 * P], match: [/coil.*2/i] },
      { role: 'no', pos: [w, 2 * P], match: [/^no$/i, /normally.?open/i] },
      { role: 'common', pos: [w, 4 * P], match: [/main|common|^com$/i] }
    ],
    body:
      `<rect x="${coilX0}" y="${coilY0}" width="${round(coilX1 - coilX0)}" height="${round(coilY1 - coilY0)}" fill="none" stroke="${INK}" stroke-width="${STROKE}"/>` +
      line(0, 2 * P, coilX0, 2 * P) +
      line(0, 4 * P, coilX0, 4 * P) +
      line(coilX1, 4 * P, w, 4 * P) +
      line(contactX, 2 * P, w, 2 * P) +
      circle(contactX, 2 * P, 1.7, STROKE, INK, INK) +
      circle(contactX, 4 * P, 1.7, STROKE, INK, INK) +
      line(contactX, 4 * P, contactX - 0.55 * P, 2.35 * P) +
      // dashed actuation link from coil to blade
      `<line x1="${round(coilX1)}" y1="${3 * P}" x2="${round(contactX - 0.3 * P)}" y2="${3 * P}" stroke="${INK}" stroke-width="1.2" stroke-dasharray="3 3"/>`
  }
})()

/** Every symbol, by symbol id. */
export const SYMBOLS: Record<string, SymbolDef> = {
  resistor,
  capacitor,
  'capacitor-polar': capacitorPolar,
  inductor,
  fuse,
  diode,
  zener,
  led,
  photoresistor,
  thermistor,
  'switch-spst': switchSpst,
  pushbutton,
  'reed-switch': reedSwitch,
  potentiometer,
  battery,
  buzzer,
  microphone,
  npn: bjt(true),
  pnp: bjt(false),
  nmos,
  relay
}

/** Part type → symbol id, for everything tinyStudio ships. */
export const SYMBOL_BY_TYPE: Record<string, string> = {
  resistor: 'resistor',
  'capacitor-ceramic-100mil': 'capacitor',
  'capacitor-ceramic-200mil': 'capacitor',
  'capacitor-electrolytic-medium': 'capacitor-polar',
  'smd-inductor-0805': 'inductor',
  'sparkfun-passives-fuse-x20mm': 'fuse',
  'diode-1n4001-300mil': 'diode',
  'diode-zener-0-5w-3-6v-300mil': 'zener',
  'led-generic-3mm': 'led',
  'led-generic-5mm': 'led',
  'ldr-photocell-300mil-v5': 'photoresistor',
  'thermistor-300mil': 'thermistor',
  'switch-spst': 'switch-spst',
  pushbutton: 'pushbutton',
  'reedswitch-500mil': 'reed-switch',
  'potentiometer-rotary-16mm-5': 'potentiometer',
  'potentiometer-trimmer-6mm-5': 'potentiometer',
  'battery-aa': 'battery',
  'buzzer-v15': 'buzzer',
  'piezo-sensor': 'buzzer',
  'sparkfun-sensors-mic-electret-smd': 'microphone',
  'transistor-signal-npn-to92-ebc': 'npn',
  'transistor-signal-pnp-to92-ebc': 'pnp',
  'sparkfun-discretesemi-mosfet-nchannel-pth': 'nmos',
  'te-relay': 'relay'
}

/**
 * Keyword → symbol id, used ONLY for parts that arrive with no schematic art
 * at all. A standard symbol beats a generated box; a part that DID ship its
 * own art keeps it (normalised), because guessing at someone else's part is
 * how you end up drawing a resistor for a current-sense shunt module.
 */
const KEYWORD_SYMBOLS: [RegExp, string][] = [
  [/\bled\b/i, 'led'],
  [/zener/i, 'zener'],
  [/photo-?(resistor|cell)|\bldr\b/i, 'photoresistor'],
  [/thermistor/i, 'thermistor'],
  [/potentiometer|trimmer|\bpot\b/i, 'potentiometer'],
  [/electrolytic|polari[sz]ed|tantalum/i, 'capacitor-polar'],
  [/capacitor|\bcap\b/i, 'capacitor'],
  [/inductor|\bcoil\b|choke/i, 'inductor'],
  [/\bfuse\b/i, 'fuse'],
  [/diode|rectifier/i, 'diode'],
  [/\bnpn\b/i, 'npn'],
  [/\bpnp\b/i, 'pnp'],
  [/mosfet|\bnmos\b|n-?channel/i, 'nmos'],
  [/reed/i, 'reed-switch'],
  [/push-?button|momentary/i, 'pushbutton'],
  [/switch/i, 'switch-spst'],
  [/relay/i, 'relay'],
  [/battery|\bcell\b/i, 'battery'],
  [/buzzer|piezo|sounder|speaker/i, 'buzzer'],
  [/microphone|\bmic\b|electret/i, 'microphone'],
  [/resistor/i, 'resistor']
]

export function symbolIdForKeywords(haystack: string): string | undefined {
  for (const [re, id] of KEYWORD_SYMBOLS) if (re.test(haystack)) return id
  return undefined
}

/**
 * Bind a symbol's slots to a part's real pin names and render the PartView.
 *
 * Returns null when the part cannot wear this symbol — a different pin count
 * means we would silently drop or invent a terminal, and a symbol that hides
 * a pin is worse than an ugly one, so the caller falls back.
 */
export function bindSymbol(sym: SymbolDef, pinNames: string[]): PartView | null {
  if (pinNames.length !== sym.slots.length) return null
  const taken = new Set<string>()
  const chosen: (string | undefined)[] = sym.slots.map(() => undefined)

  // pass 1: explicit name matches, most specific pattern first
  sym.slots.forEach((slot, i) => {
    if (!slot.match) return
    for (const re of slot.match) {
      const hit = pinNames.find((n) => !taken.has(n) && re.test(n))
      if (hit) {
        chosen[i] = hit
        taken.add(hit)
        return
      }
    }
  })
  // pass 2: whatever is left, in definition order
  const rest = pinNames.filter((n) => !taken.has(n))
  let r = 0
  for (let i = 0; i < chosen.length; i++) if (!chosen[i]) chosen[i] = rest[r++]

  const pins: Record<string, [number, number]> = {}
  sym.slots.forEach((slot, i) => {
    const name = chosen[i]
    if (name) pins[name] = slot.pos
  })
  if (Object.keys(pins).length !== sym.slots.length) return null

  return { svg: symbolSvg(sym.body, sym.w, sym.h), w: sym.w, h: sym.h, pins }
}
