/**
 * circuit/core/liveState: what the parts are doing, read from a DC solution.
 *
 * Simulate keeps a DC operating point solved for the circuit as it stands
 * (views/sim/useLiveOp); this turns it into what the canvas shows: how bright
 * each LED is, and whether it is being overdriven.
 *
 * ngspice reports node voltages, not diode currents, so an LED's current is
 * worked back out of the voltage across it with the same diode model the
 * netlist gave it (netlist.LED_PARAMS). Pure: no React, no DOM.
 */

import type { NetlistResult } from './netlist'
import { LED_PARAMS } from './netlist'
import type { SimRun } from '../sim/backend'

export interface LedState {
  /** forward current, amps */
  amps: number
  /** 0 (dark) … 1 (full brightness), perceptual (log) scale */
  glow: number
  /** past an ordinary indicator LED's absolute maximum */
  over: boolean
}

/** Typical 5 mm indicator LED: visibly lit from ~0.1 mA, absolute max ~30 mA. */
const DIM = 1e-4
const FULL = 20e-3
const MAX = 30e-3
/** thermal voltage kT/q at ngspice's default 27 °C (300.15 K) */
const VT = (1.380649e-23 * 300.15) / 1.602176634e-19

/** Diode current with series resistance: solve I = IS·(e^((V−I·RS)/(N·Vt))−1). */
export function diodeCurrent(v: number, p = LED_PARAMS): number {
  if (!(v > 0)) return 0
  const f = (i: number): number => p.is * Math.expm1((v - i * p.rs) / (p.n * VT)) - i
  let lo = 0
  let hi = v / p.rs
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2
    if (f(mid) > 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export function glowOf(amps: number): number {
  if (amps <= DIM) return 0
  return Math.min(1, Math.log10(amps / DIM) / Math.log10(FULL / DIM))
}

/** Node voltage from an .op run; ground and unknown nodes read 0 / undefined. */
function volts(run: SimRun, node: string): number | undefined {
  if (node === '0') return 0
  const v = run.vectors.find((x) => x.name.toLowerCase() === `v(${node.toLowerCase()})`)
  return v?.values[0]
}

/**
 * Every LED's state: discrete LEDs by part id ("LED1"), a board's on-board
 * LEDs by part and name ("U1:LED_SIG"). LEDs are found by their element line
 * in the netlist (`D<id> <anode> <cathode> DLED`), so this reads exactly the
 * nodes SPICE was given.
 */
export function ledStates(gen: NetlistResult, run: SimRun): Map<string, LedState> {
  const out = new Map<string, LedState>()
  if (run.numPoints !== 1) return out
  const lines = gen.netlist.split('\n')
  for (const [id, els] of Object.entries(gen.elementOfPart)) {
    for (const el of els) {
      if (!el.startsWith('d')) continue
      const line = lines.find((l) => l.split(/\s+/, 1)[0]?.toLowerCase() === el)
      const f = line?.trim().split(/\s+/)
      if (!f || f.length < 4 || f[3].toUpperCase() !== 'DLED') continue
      const va = volts(run, f[1])
      const vk = volts(run, f[2])
      if (va === undefined || vk === undefined) continue
      const amps = diodeCurrent(va - vk)
      // a discrete LED is its part (`dled1`); a board's own LEDs are
      // `d<board>_<name>` and keyed "U1:LED_SIG"
      const rest = el.slice(1 + id.length)
      const key = rest.startsWith('_') ? `${id}:${rest.slice(1).toUpperCase()}` : id
      out.set(key, { amps, glow: glowOf(amps), over: amps > MAX })
    }
  }
  return out
}
