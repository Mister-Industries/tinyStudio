/**
 * circuit/core/netlist — SPICE netlist generation (M4, spec §10.2).
 *
 * Pure: takes the document + a prebuilt NetModel (so breadboard seating and
 * registry buses are included exactly as the editor sees them) and returns
 * netlist text + node naming + warnings. No React, no DOM, no engine — the
 * SimBackend consumes the text; tests golden-file it.
 *
 * Node naming: a net named GND (ground labels) is node `0`; other named nets
 * keep their (sanitized) label name; everything else is `n<k>` in stable net
 * order — diffable golden files.
 *
 * Part mapping: built-in table keyed on family/type keywords (resistor, led,
 * battery, the sim-* sources…). Pins are matched by name (anode/cathode/+/-)
 * with positional fallback, since the Fritzing catalogue is inconsistent
 * ("Pin 0" vs "leg1" vs "0"). Parts without a mapping: breadboards are
 * transparent (their buses already merged nets), boards/MCUs are excluded
 * with an info (model their pins with sources — §10.2.5), other parts are
 * excluded with a warning. The curated tinyparts overlay replaces this table
 * eventually; keep the shape compatible.
 */

import type { Analysis, CircuitDoc, CircuitPart } from './model'
import type { NetModel } from './nets'

// ── SPICE value normalization ────────────────────────────────────────────────

/** Normalize a human attr ("4.7kΩ", "10 µF", "1M") into a SPICE number.
 * Note SPICE reads `m` as milli — a trailing capital M (common for megohm)
 * becomes `Meg`; lowercase m stays milli. */
export function spiceNum(v: string | number | boolean | undefined, fallback: string): string {
  if (v === undefined || v === true || v === false) return fallback
  let s = String(v).trim()
  if (!s) return fallback
  s = s
    .replace(/[ΩΩ]|ohms?/gi, '')
    .replace(/([0-9.]\s*[a-zµμ]*)[FH]$/i, '$1') // unit letters after value/prefix
    .replace(/[µμ]/g, 'u')
    .replace(/\s+/g, '')
  s = s.replace(/^([0-9.eE+-]+)M$/, '$1Meg') // capital M = mega by human convention
  return s || fallback
}

/** SPICE-safe node token from a net-label name. */
function nodeToken(name: string): string {
  return name.replace(/[^A-Za-z0-9_.]+/g, '_')
}

// ── part mapping ─────────────────────────────────────────────────────────────

export interface SpiceCard {
  /** element line(s), fully substituted */
  lines: string[]
  /** .model card emitted once per model name */
  model?: { name: string; card: string }
}

export type MappingKind = 'element' | 'transparent' | 'board' | 'unknown'

export interface NetlistOptions {
  /** family for a part type (from the parts registry); improves matching */
  familyOf?: (type: string) => string | undefined
  title?: string
}

export interface NetlistResult {
  netlist: string
  /** node name per net index (annotation UI: net → voltage vector name) */
  nodeOfNet: string[]
  warnings: string[]
  /** part ids not simulated (unknown/board) */
  excluded: string[]
}

interface Ctx {
  part: CircuitPart
  /** ordered pin names actually referenced by nets or the registry — here we
   * only know what the doc wired; order = wire discovery order. */
  nodeOf: (pin: string) => string
  pins: string[]
  attr: (names: string[], fallback: string) => string
  warn: (msg: string) => void
}

/** Find a pin matching any regex, else positional fallback (and warn). */
function pinLike(ctx: Ctx, res: RegExp[], positional: number, what: string): string {
  for (const re of res) {
    const hit = ctx.pins.find((p) => re.test(p))
    if (hit) return ctx.nodeOf(hit)
  }
  const p = ctx.pins[positional]
  if (p === undefined) {
    ctx.warn(`${ctx.part.id}: no pin for ${what} — grounded`)
    return '0'
  }
  return ctx.nodeOf(p)
}

const two = (ctx: Ctx): [string, string] => {
  const a = ctx.pins[0]
  const b = ctx.pins[1]
  return [a !== undefined ? ctx.nodeOf(a) : '0', b !== undefined ? ctx.nodeOf(b) : '0']
}

const PLUS = [/^\+$/, /anode/i, /^vcc$/i, /pos/i]
const MINUS = [/^-$/, /cathode|kath/i, /^gnd$/i, /neg/i]

type Emitter = (ctx: Ctx) => SpiceCard | null

/** An editable sim attr a part type understands (Inspector surfaces these). */
export interface SimAttrSpec {
  key: string
  label: string
  /** value used when the attr is unset (mirrors the emitter fallbacks) */
  default: string
  hint?: string
}

const LED_MODEL = { name: 'DLED', card: '.model DLED D(IS=1e-22 N=2.2 RS=2)' }
const D_MODEL = { name: 'DGEN', card: '.model DGEN D(IS=1e-14 N=1.9 RS=0.1)' }
const NPN_MODEL = { name: 'QNPN', card: '.model QNPN NPN(BF=150 VAF=100)' }
const PNP_MODEL = { name: 'QPNP', card: '.model QPNP PNP(BF=150 VAF=100)' }

const EMITTERS: {
  match: RegExp
  kind?: MappingKind
  emit?: Emitter
  attrs?: SimAttrSpec[]
}[] = [
  { match: /breadboard/i, kind: 'transparent' },
  { match: /tinystudio|microcontroller|\bboard\b|arduino|esp32/i, kind: 'board' },
  {
    match: /sim-vdc|voltage source|battery/i,
    attrs: [{ key: 'voltage', label: 'Voltage', default: '5', hint: 'V' }],
    emit: (c) => ({
      lines: [
        `V${c.part.id} ${pinLike(c, PLUS, 0, '+')} ${pinLike(c, MINUS, 1, '-')} DC ${c.attr(
          ['voltage', 'value'],
          '5'
        )}`
      ]
    })
  },
  {
    match: /sim-vsin|sine|waveform/i,
    attrs: [
      { key: 'amplitude', label: 'Amplitude', default: '1', hint: 'V' },
      { key: 'frequency', label: 'Frequency', default: '1k', hint: 'Hz' },
      { key: 'offset', label: 'DC offset', default: '0', hint: 'V' }
    ],
    emit: (c) => ({
      lines: [
        `V${c.part.id} ${pinLike(c, PLUS, 0, '+')} ${pinLike(c, MINUS, 1, '-')} SIN(${c.attr(
          ['offset'],
          '0'
        )} ${c.attr(['amplitude', 'value'], '1')} ${c.attr(['frequency', 'freq'], '1k')}) AC ${c.attr(
          ['amplitude', 'value'],
          '1'
        )}`
      ]
    })
  },
  {
    match: /sim-idc|current source/i,
    attrs: [{ key: 'current', label: 'Current', default: '1m', hint: 'A' }],
    emit: (c) => ({
      lines: [
        `I${c.part.id} ${pinLike(c, PLUS, 0, '+')} ${pinLike(c, MINUS, 1, '-')} DC ${c.attr(
          ['current', 'value'],
          '1m'
        )}`
      ]
    })
  },
  {
    match: /resistor|photocell|ldr|thermistor/i,
    attrs: [{ key: 'resistance', label: 'Resistance', default: '220', hint: 'Ω' }],
    emit: (c) => {
      const [a, b] = two(c)
      return { lines: [`R${c.part.id} ${a} ${b} ${c.attr(['resistance', 'value'], '220')}`] }
    }
  },
  {
    match: /potentiometer|trimmer/i,
    attrs: [
      { key: 'resistance', label: 'Resistance', default: '10k', hint: 'Ω end-to-end' },
      { key: 'position', label: 'Wiper position', default: '0.5', hint: '0–1' }
    ],
    emit: (c) => {
      const total = c.attr(['resistance', 'value'], '10k')
      const posRaw = c.attr(['position'], '0.5')
      const pos = Math.min(Math.max(parseFloat(posRaw) || 0.5, 0.001), 0.999)
      const l1 = pinLike(c, [/leg1|^1$/i], 0, 'leg1')
      const w = pinLike(c, [/wiper|^2$/i], 1, 'wiper')
      const l2 = pinLike(c, [/leg2|^3$/i], 2, 'leg2')
      return {
        lines: [
          `R${c.part.id}a ${l1} ${w} ${spiceScale(total, pos)}`,
          `R${c.part.id}b ${w} ${l2} ${spiceScale(total, 1 - pos)}`
        ]
      }
    }
  },
  {
    match: /capacitor/i,
    attrs: [{ key: 'capacitance', label: 'Capacitance', default: '100n', hint: 'F' }],
    emit: (c) => {
      const plus = c.pins.find((p) => PLUS.some((re) => re.test(p)))
      const minus = c.pins.find((p) => MINUS.some((re) => re.test(p)))
      const [a, b] =
        plus && minus ? [c.nodeOf(plus), c.nodeOf(minus)] : two(c)
      return { lines: [`C${c.part.id} ${a} ${b} ${c.attr(['capacitance', 'value'], '100n')}`] }
    }
  },
  {
    match: /inductor/i,
    attrs: [{ key: 'inductance', label: 'Inductance', default: '10u', hint: 'H' }],
    emit: (c) => {
      const [a, b] = two(c)
      return { lines: [`L${c.part.id} ${a} ${b} ${c.attr(['inductance', 'value'], '10u')}`] }
    }
  },
  {
    match: /led/i,
    emit: (c) => ({
      lines: [
        `D${c.part.id} ${pinLike(c, [/anode/i, /^\+$/], 1, 'anode')} ${pinLike(
          c,
          [/cathode|kath/i, /^-$/],
          0,
          'cathode'
        )} ${LED_MODEL.name}`
      ],
      model: LED_MODEL
    })
  },
  {
    match: /diode|zener/i,
    emit: (c) => ({
      lines: [
        `D${c.part.id} ${pinLike(c, [/anode/i], 1, 'anode')} ${pinLike(
          c,
          [/cathode|kath/i],
          0,
          'cathode'
        )} ${D_MODEL.name}`
      ],
      model: D_MODEL
    })
  },
  {
    match: /npn/i,
    emit: (c) => ({
      lines: [
        `Q${c.part.id} ${pinLike(c, [/^c/i], 2, 'C')} ${pinLike(c, [/^b/i], 1, 'B')} ${pinLike(
          c,
          [/^e/i],
          0,
          'E'
        )} ${NPN_MODEL.name}`
      ],
      model: NPN_MODEL
    })
  },
  {
    match: /pnp/i,
    emit: (c) => ({
      lines: [
        `Q${c.part.id} ${pinLike(c, [/^c/i], 2, 'C')} ${pinLike(c, [/^b/i], 1, 'B')} ${pinLike(
          c,
          [/^e/i],
          0,
          'E'
        )} ${PNP_MODEL.name}`
      ],
      model: PNP_MODEL
    })
  },
  {
    match: /switch|button/i,
    attrs: [{ key: 'closed', label: 'Closed', default: 'false', hint: 'true/false' }],
    emit: (c) => {
      const closed = c.part.attrs?.closed === true || c.part.attrs?.closed === 'true'
      if (!closed) return null // open switch = not in the circuit
      const [a, b] = two(c)
      return { lines: [`R${c.part.id} ${a} ${b} 1m`] }
    }
  }
]

/** total like "10k" scaled by a fraction → SPICE number (e.g. 10k*0.5 → 5000). */
function spiceScale(total: string, frac: number): string {
  const m = total.match(/^([0-9.eE+-]+)\s*(Meg|[kKmunpfgt])?$/)
  if (!m) return total
  const mult: Record<string, number> = {
    Meg: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, g: 1e9, t: 1e12
  }
  const base = parseFloat(m[1]) * (m[2] ? mult[m[2]] : 1)
  const v = base * frac
  return v >= 1 ? String(Math.round(v * 100) / 100) : v.toExponential(3)
}

/** Sim attrs a part type supports (same matching rule as generation). */
export function simAttrsFor(type: string, family = ''): SimAttrSpec[] {
  const entry = EMITTERS.find((e) => e.match.test(`${type} ${family}`))
  return entry?.attrs ?? []
}

// ── generator ────────────────────────────────────────────────────────────────

export function generateNetlist(
  doc: CircuitDoc,
  net: NetModel,
  opts: NetlistOptions = {}
): NetlistResult {
  const warnings: string[] = []
  const excluded: string[] = []

  // node names per net (spec §10.2.2)
  let seq = 1
  const nodeOfNet = net.nets.map((_members, i) => {
    const name = net.netNames[i]
    if (name && name.toUpperCase() === 'GND') return '0'
    if (name) return nodeToken(name)
    return `n${seq++}`
  })
  let ncSeq = 1

  const lines: string[] = []
  const models = new Map<string, string>()

  for (const part of doc.parts) {
    const family = opts.familyOf?.(part.type) ?? ''
    const key = `${part.type} ${family}`
    const entry = EMITTERS.find((e) => e.match.test(key))
    if (!entry) {
      excluded.push(part.id)
      warnings.push(`${part.id} (${part.type}) has no simulation model — excluded`)
      continue
    }
    if (entry.kind === 'transparent') continue
    if (entry.kind === 'board') {
      excluded.push(part.id)
      warnings.push(`${part.id} (${part.type}) is a board — not simulated; drive its pins with sources`)
      continue
    }

    // pins this part exposes to the net model (wired or seated)
    const pins: string[] = []
    for (const [ref] of net.pinToNet) {
      const idx = ref.lastIndexOf(':')
      if (ref.slice(0, idx) === part.id) pins.push(ref.slice(idx + 1))
    }
    const ctx: Ctx = {
      part,
      pins,
      nodeOf: (pin) => {
        const idx = net.pinToNet.get(`${part.id}:${pin}`)
        if (idx === undefined) {
          warnings.push(`${part.id}:${pin} is unconnected`)
          return `nc${ncSeq++}`
        }
        return nodeOfNet[idx]
      },
      attr: (names, fallback) => {
        for (const n of names) {
          const v = part.attrs?.[n]
          if (v !== undefined) return spiceNum(v, fallback)
        }
        return fallback
      },
      warn: (m) => warnings.push(m)
    }
    const card = entry.emit!(ctx)
    if (!card) continue
    lines.push(...card.lines)
    if (card.model) models.set(card.model.name, card.model.card)
  }

  // analyses (spec §10.2.4) — default to .op
  const analyses = (doc.sim?.analyses ?? []).filter((a) => a.enabled !== false)
  const resolved = analyses.map(analysisCard).filter(Boolean)
  const cards = resolved.length ? resolved : ['.op'] // never emit a card-less netlist

  const text = [
    `* ${opts.title ?? 'tinyStudio circuit'}`,
    ...lines,
    ...[...models.values()].sort(),
    ...(cards as string[]),
    '.end',
    ''
  ].join('\n')

  return { netlist: text, nodeOfNet, warnings, excluded }
}

export function analysisCard(a: Analysis): string | null {
  const f = (k: string, d = ''): string => spiceNum(a[k] as string | number | undefined, d)
  switch (a.kind) {
    case 'op':
      return '.op'
    case 'tran':
      // uic: skip the DC bias solve and start from zero initial conditions
      return `.tran ${f('step', '10u')} ${f('stop', '10m')}${a.uic ? ' uic' : ''}`
    case 'dc':
      return a.src ? `.dc ${a.src} ${f('from', '0')} ${f('to', '5')} ${f('step', '0.1')}` : null
    case 'ac':
      return `.ac ${(a.variation as string) || 'dec'} ${f('points', '20')} ${f(
        'fstart',
        '1'
      )} ${f('fstop', '1Meg')}`
    default:
      return null
  }
}
