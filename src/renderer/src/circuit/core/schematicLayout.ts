/**
 * circuit/core/schematicLayout: draw a readable schematic from connectivity.
 *
 * Built for "I wired it on the breadboard, now show me the schematic". The
 * layout follows how people draw these by hand, and how CircuitLab examples
 * read:
 *
 *   1. Power nets (GND, 3V3, 5V, I2C_PWR…) are never drawn as wires: every pin
 *      on one gets its own ground or supply symbol, pointing away from it.
 *   2. Boards sit in the left column; every other part goes in a column by how
 *      many signal hops it is from a board, so signals flow left to right.
 *   3. Within a column, parts line up with what they connect to on the left.
 *   4. A two-terminal part with one end on a rail stands upright (supply on
 *      top, ground at the bottom); one between two signals lies flat with its
 *      upstream end on the left.
 *   5. Each signal net is wired as a minimum spanning tree over its pins, with
 *      automatic wires, so the obstacle-aware router (core/autoroute) lays
 *      the tracks.
 *
 * Pure: symbol geometry comes in through `symbolOf`, so this runs in tests.
 */

import { transformLocalPoint } from './geometry'
import {
  GRID_BB,
  splitPinRef,
  type CircuitDoc,
  type CircuitWire,
  type NetLabel,
  type NetLabelKind,
  type Placement,
  type Pt
} from './model'
import type { NetModel } from './nets'
import type { PinDir } from './routing'

const P = GRID_BB

export interface SymbolInfo {
  w: number
  h: number
  pins: Record<string, [number, number]>
}

export interface LayoutInput {
  doc: CircuitDoc
  nets: NetModel
  /** the part's schematic symbol, or null when it isn't drawn on the schematic */
  symbolOf: (type: string) => SymbolInfo | null
  /** tinyCore and HATs: the left column */
  isBoard: (type: string) => boolean
  /** a ground or supply symbol's geometry */
  labelSymbol: (kind: NetLabelKind, name: string) => SymbolInfo
}

export interface LayoutResult {
  placements: Record<string, Placement>
  wires: CircuitWire[]
  netLabels: NetLabel[]
}

const GROUND_NAMES = /^(gnd|vss|0v|ground)$/i
const SUPPLY_NAMES = /^(3v3|3\.3v|5v|vcc|vdd|vbat|vin|vbus|i2c_pwr|vsys)$/i

interface Rail {
  kind: 'ground' | 'power'
  name: string
}

/** Which nets are rails, and what to call them. */
function railsOf(input: LayoutInput): (Rail | null)[] {
  const { nets, doc, isBoard } = input
  const typeOf = new Map(doc.parts.map((p) => [p.id, p.type]))
  return nets.nets.map((members, i) => {
    const named = nets.netNames[i]
    if (named && GROUND_NAMES.test(named)) return { kind: 'ground', name: 'GND' }
    if (named && SUPPLY_NAMES.test(named)) return { kind: 'power', name: named.toUpperCase() }
    let supply: string | null = null
    for (const ref of members) {
      const { part, pin } = splitPinRef(ref)
      if (!isBoard(typeOf.get(part) ?? '')) continue
      const base = pin.replace(/\.\d+$/, '')
      if (base === 'GND') return { kind: 'ground', name: 'GND' }
      if (base === '3V3') supply = '3V3'
      if (base === 'PWR' && !supply) supply = 'I2C_PWR'
    }
    return supply ? { kind: 'power', name: supply } : null
  })
}

const TURN: Record<PinDir, PinDir> = { l: 'u', u: 'r', r: 'd', d: 'l' }
const OPP: Record<PinDir, PinDir> = { l: 'r', r: 'l', u: 'd', d: 'u' }
const STEP: Record<PinDir, Pt> = {
  l: { x: -1, y: 0 },
  r: { x: 1, y: 0 },
  u: { x: 0, y: -1 },
  d: { x: 0, y: 1 }
}

function localDir(s: SymbolInfo, pin: string): PinDir | null {
  const at = s.pins[pin]
  if (!at) return null
  const [x, y] = at
  return x <= 0.5 ? 'l' : x >= s.w - 0.5 ? 'r' : y <= 0.5 ? 'u' : y >= s.h - 0.5 ? 'd' : null
}

function turned(d: PinDir, rotate: number): PinDir {
  for (let r = rotate; r > 0; r -= 90) d = TURN[d]
  return d
}

function pinAt(s: SymbolInfo, pin: string, pl: Placement): Pt {
  const [px, py] = s.pins[pin]
  const p = transformLocalPoint(px, py, s.w, s.h, pl.rotate ?? 0, pl.flip ?? false)
  return { x: pl.x + p.x, y: pl.y + p.y }
}

/** Visible size after rotation. */
function extent(s: SymbolInfo, rotate = 0): { w: number; h: number; dx: number; dy: number } {
  const q = rotate === 90 || rotate === 270
  return q
    ? { w: s.h, h: s.w, dx: (s.w - s.h) / 2, dy: (s.h - s.w) / 2 }
    : { w: s.w, h: s.h, dx: 0, dy: 0 }
}

const snap = (v: number): number => Math.round(v / P) * P

export function layoutSchematic(input: LayoutInput): LayoutResult {
  const { doc, nets, symbolOf, isBoard } = input
  const rails = railsOf(input)
  const parts = doc.parts.filter((p) => symbolOf(p.type))
  const sym = new Map(parts.map((p) => [p.id, symbolOf(p.type)!]))
  const netOf = (id: string, pin: string): number | undefined => nets.pinToNet.get(`${id}:${pin}`)
  const isRail = (n: number | undefined): boolean => n !== undefined && rails[n] !== null
  const signalNet = (n: number | undefined): boolean =>
    n !== undefined && !isRail(n) && (nets.nets[n]?.length ?? 0) >= 2

  // ── placement: one row per board pin, growing away from the board ──────────
  const placements: Record<string, Placement> = {}
  const placed = new Set<string>()
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = []
  const twoPin = (id: string): [string, string] | null => {
    const s = sym.get(id)!
    const names = Object.keys(s.pins)
    if (names.length !== 2 || s.pins[names[0]][1] !== s.pins[names[1]][1]) return null
    return s.pins[names[0]][0] <= s.pins[names[1]][0] ? [names[0], names[1]] : [names[1], names[0]]
  }
  const railOf = (id: string, pin: string): Rail | null => rails[netOf(id, pin) ?? -1] ?? null

  /** Put a part so `pin` lands on (x, y); returns its visible box. */
  const put = (id: string, rot: 0 | 90 | 180 | 270, pin: string, at: Pt): void => {
    const s = sym.get(id)!
    const pl: Placement = { x: 0, y: 0, ...(rot ? { rotate: rot } : {}) }
    const p0 = pinAt(s, pin, pl)
    pl.x = snap(at.x) - p0.x
    pl.y = snap(at.y) - p0.y
    placements[id] = pl
    placed.add(id)
    const ext = extent(s, rot)
    // a rail pin carries a symbol 4 grid out; keep that room clear too
    let up = 0
    let down = 0
    for (const n of Object.keys(s.pins)) {
      const r = railOf(id, n)
      if (!r) continue
      const y = pinAt(s, n, pl).y
      if (y <= pl.y + ext.dy + 0.5) up = 4 * P
      if (y >= pl.y + ext.dy + ext.h - 0.5) down = 4 * P
    }
    // and room for the refdes/value text: beside an upright part, above and
    // below a flat one (parts/labels)
    const upright = rot === 90 || rot === 270
    const textRight = upright && twoPin(id) ? 7 * P : 0
    const textV = !upright && twoPin(id) ? 2 * P : 0
    boxes.push({
      x0: pl.x + ext.dx,
      y0: pl.y + ext.dy - Math.max(up, textV),
      x1: pl.x + ext.dx + ext.w + textRight,
      y1: pl.y + ext.dy + ext.h + Math.max(down, textV)
    })
  }

  /** Lay out what hangs off `net`, starting at column x on row y. */
  const walk = (net: number, x: number, y: number, dir: 1 | -1, depth: number): void => {
    if (depth > 12) return
    const members = [...new Set(nets.nets[net].map((m) => splitPinRef(m).part))]
      .filter((id) => sym.has(id) && !placed.has(id))
      .sort()
    let cx = x
    // shunts and pull-ups: stand upright on the row, side by side
    for (const id of members) {
      const pins = twoPin(id)
      if (!pins) continue
      const [l, r] = pins
      const onNet = netOf(id, l) === net ? l : r
      const other = onNet === l ? r : l
      const rail = railOf(id, other)
      if (!rail) continue
      // 90 puts the left pin on top, 270 at the bottom
      const netOnTop = rail.kind === 'ground'
      const rot = (onNet === l) === netOnTop ? 90 : 270
      put(id, rot, onNet, { x: cx, y })
      cx += dir * 9 * P
    }
    // series parts: lie flat along the row, then keep walking
    for (const id of members) {
      if (placed.has(id)) continue
      const pins = twoPin(id)
      if (pins) {
        const [l, r] = pins
        const onNet = netOf(id, l) === net ? l : r
        const other = onNet === l ? r : l
        if (railOf(id, other)) continue
        // the end on this net faces back toward the board
        const nearFirst = dir === 1 ? onNet === l : onNet === r
        const rot = nearFirst ? 0 : 180
        const len = sym.get(id)!.w
        put(id, rot, onNet, { x: cx + dir * 2 * P, y })
        const next = netOf(id, other)
        const end = cx + dir * (2 * P + len)
        if (next !== undefined && signalNet(next)) walk(next, end + dir * 2 * P, y, dir, depth + 1)
        cx = end + dir * 4 * P
        continue
      }
      // anything with more pins: line its first pin on this net up with the row
      const s = sym.get(id)!
      const pin = Object.keys(s.pins).find((n) => netOf(id, n) === net)
      if (!pin) continue
      const ext = extent(s, 0)
      const local = s.pins[pin]
      const left = dir === 1 ? cx + 2 * P : cx - 2 * P - ext.w
      put(id, 0, pin, { x: left + local[0], y })
      for (const n of Object.keys(s.pins)) {
        const nn = netOf(id, n)
        if (nn !== undefined && nn !== net && signalNet(nn)) {
          const at = pinAt(s, n, placements[id])
          walk(nn, at.x + dir * 4 * P, at.y, dir, depth + 1)
        }
      }
      cx = dir === 1 ? left + ext.w + 4 * P : left - 4 * P
    }
  }

  /** Shift everything placed since `from` down until it clears earlier boxes. */
  const settle = (from: number, ids: string[]): void => {
    const mine = boxes.slice(from)
    let dy = 0
    for (let pass = 0; pass < 50; pass++) {
      const hit = mine.some((m) =>
        boxes
          .slice(0, from)
          .some(
            (o) =>
              m.x0 < o.x1 + P && m.x1 > o.x0 - P && m.y0 + dy < o.y1 + P && m.y1 + dy > o.y0 - P
          )
      )
      if (!hit) break
      dy += 2 * P
    }
    if (!dy) return
    for (const m of mine) {
      m.y0 += dy
      m.y1 += dy
    }
    for (const id of ids) placements[id] = { ...placements[id], y: placements[id].y + dy }
  }

  // boards stacked in the middle column
  let boardY = 0
  for (const b of parts.filter((p) => isBoard(p.type))) {
    const s = sym.get(b.id)!
    put(b.id, 0, Object.keys(s.pins)[0], {
      x: s.pins[Object.keys(s.pins)[0]][0],
      y: boardY + s.pins[Object.keys(s.pins)[0]][1]
    })
    boardY += s.h + 8 * P
  }
  // one row per board pin, top to bottom: right-side pins grow right, left-side grow left
  for (const b of parts.filter((p) => isBoard(p.type))) {
    const s = sym.get(b.id)!
    const pins = Object.keys(s.pins)
      .map((n) => ({ n, at: pinAt(s, n, placements[b.id]), d: localDir(s, n) }))
      .filter((p) => p.d === 'l' || p.d === 'r')
      .sort((a, c) => a.at.y - c.at.y)
    for (const p of pins) {
      const net = netOf(b.id, p.n)
      if (net === undefined || !signalNet(net)) continue
      const before = new Set(placed)
      const from = boxes.length
      const dir = p.d === 'r' ? 1 : -1
      // left rows start further out: upright parts carry their text on the right
      walk(net, p.at.x + (dir === 1 ? 4 * P : -12 * P), p.at.y, dir, 0)
      settle(
        from,
        [...placed].filter((id) => !before.has(id))
      )
    }
  }
  // rail-to-rail parts (decoupling caps, bulk caps): stood up beside the first
  // board's supply pin, above the board, where a reader looks for them
  const firstBoard = parts.find((p) => isBoard(p.type))
  if (firstBoard) {
    const s = sym.get(firstBoard.id)!
    const supply = Object.keys(s.pins).find((n) => railOf(firstBoard.id, n)?.kind === 'power')
    if (supply) {
      const at = pinAt(s, supply, placements[firstBoard.id])
      let cx = at.x + 8 * P
      for (const p of parts) {
        const pins = twoPin(p.id)
        if (placed.has(p.id) || !pins) continue
        const [l, r] = pins
        const rl = railOf(p.id, l)
        const rr = railOf(p.id, r)
        if (!rl || !rr) continue
        // supply on top: 90 puts the left pin there
        const rot = rl.kind === 'power' ? 90 : 270
        const top = rl.kind === 'power' ? l : r
        const from = boxes.length
        put(p.id, rot, top, { x: cx, y: at.y - 14 * P })
        // only ever move up and clear of the board, never down into the rows
        const mine = boxes[from]
        const lift = Math.max(0, mine.y1 - (at.y - 4 * P))
        if (lift) {
          placements[p.id] = { ...placements[p.id], y: placements[p.id].y - snap(lift + P) }
          mine.y0 -= snap(lift + P)
          mine.y1 -= snap(lift + P)
        }
        cx += 9 * P
      }
    }
  }

  // whatever is left (sources, islands): a row underneath
  let bottom = Math.max(boardY, ...boxes.map((b) => b.y1)) + 4 * P
  let x = 0
  for (const p of parts) {
    if (placed.has(p.id)) continue
    const pins = twoPin(p.id)
    const s = sym.get(p.id)!
    let rot: 0 | 90 | 270 = 0
    if (pins) {
      const [l, r] = pins
      const rl = railOf(p.id, l)
      const rr = railOf(p.id, r)
      if (rl || rr) rot = (rl ? rl.kind === 'power' : rr!.kind === 'ground') ? 90 : 270
    }
    const first = Object.keys(s.pins)[0]
    const ext = extent(s, rot)
    put(p.id, rot, first, { x: x + 2 * P, y: bottom + 4 * P })
    const pl = placements[p.id]
    const shift = { x: x - (pl.x + ext.dx), y: bottom - (pl.y + ext.dy) }
    placements[p.id] = { ...pl, x: snap(pl.x + shift.x + 2 * P), y: snap(pl.y + shift.y + 4 * P) }
    x += ext.w + 6 * P
    if (x > 60 * P) {
      x = 0
      bottom += 12 * P
    }
  }

  // ── 4. signal wires: a minimum spanning tree per net ────────────────────────
  const wires: CircuitWire[] = []
  let wireSeq = 0
  nets.nets.forEach((members, n) => {
    if (!signalNet(n)) return
    const pins = members
      .filter((m) => placements[splitPinRef(m).part])
      .map((m) => {
        const { part, pin } = splitPinRef(m)
        return { ref: m, at: pinAt(sym.get(part)!, pin, placements[part]) }
      })
    if (pins.length < 2) return
    const inTree = [pins[0]]
    const rest = pins.slice(1)
    while (rest.length) {
      let best = { d: Infinity, i: 0, j: 0 }
      rest.forEach((r, i) =>
        inTree.forEach((t, j) => {
          const d = Math.abs(r.at.x - t.at.x) + Math.abs(r.at.y - t.at.y)
          if (d < best.d) best = { d, i, j }
        })
      )
      const [next] = rest.splice(best.i, 1)
      wires.push({ id: `gw${++wireSeq}`, from: inTree[best.j].ref, to: next.ref, view: 'sch' })
      inTree.push(next)
    }
  })

  // ── 5. a ground or supply symbol on every rail pin ──────────────────────────
  const netLabels: NetLabel[] = []
  for (const p of parts) {
    const s = sym.get(p.id)!
    const pl = placements[p.id]
    const done = new Set<string>()
    for (const pin of Object.keys(s.pins)) {
      const rail = rails[netOf(p.id, pin) ?? -1]
      const local = localDir(s, pin)
      if (!rail || !local) continue
      const at = pinAt(s, pin, pl)
      // repeated header pins share one position: one symbol is enough
      const key = `${at.x},${at.y}`
      if (done.has(key)) continue
      done.add(key)
      const d = turned(local, pl.rotate ?? 0)
      const pinTo = { x: at.x + STEP[d].x * 2 * P, y: at.y + STEP[d].y * 2 * P }
      const glyph = input.labelSymbol(rail.kind, rail.name)
      const glyphDir = localDir(glyph, '1') ?? (rail.kind === 'ground' ? 'u' : 'd')
      // turn the symbol so its own pin faces back at the part
      let rot = 0
      while (turned(glyphDir, rot) !== OPP[d] && rot < 360) rot += 90
      const off = transformLocalPoint(
        glyph.pins['1'][0],
        glyph.pins['1'][1],
        glyph.w,
        glyph.h,
        rot % 360
      )
      const id = `gl${netLabels.length + 1}`
      netLabels.push({
        id,
        name: rail.name,
        kind: rail.kind,
        sch: {
          x: pinTo.x - off.x,
          y: pinTo.y - off.y,
          ...(rot % 360 ? { rotate: (rot % 360) as 90 | 180 | 270 } : {})
        }
      })
      wires.push({ id: `gw${++wireSeq}`, from: `${p.id}:${pin}`, to: `${id}:1`, view: 'sch' })
    }
  }

  return { placements, wires, netLabels }
}
