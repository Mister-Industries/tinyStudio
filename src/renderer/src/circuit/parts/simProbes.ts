/**
 * circuit/parts/simProbes — builtin sim probes (M4 leftover, spec §10.3).
 *
 * Three placeable 1/2-pin builtins, CircuitLab-flag style, same art both
 * views (seatable on a breadboard like any part):
 *   - sim-probe-v      voltage probe   (1 pin: `+`)
 *   - sim-probe-vdiff  diff. voltage   (2 pins: `+`, `-`)
 *   - sim-probe-i      current probe   (2 pins: `in`, `out` — wired in
 *                      series with the branch to measure)
 *
 * Voltage/diff probes need no SPICE element (ngspice already reports every
 * node's voltage under `.op`/`.tran`/`.ac`) — core/netlist.ts marks them
 * `transparent`. The current probe DOES need a real element: it emits a 0V
 * series voltage source so ngspice reports `i(v<id>)` through it (an ideal
 * ammeter). Diff-probe subtraction and probe labeling live in core/probes.ts.
 */

import type { PartDef, PartView } from '../../lib/partsLibrary'
import {
  FONT_PIN,
  FONT_SYMBOL,
  INK,
  SCH_GRID,
  STROKE,
  circle,
  line,
  symbolSvg,
  text
} from './style'

const P = SCH_GRID // 9.6
const FLAG = '#f0b429' // amber probe pennant

export type ProbeKind = 'voltage' | 'diff' | 'current'

export interface ProbeSpec {
  type: string
  label: string
  kind: ProbeKind
}

export const SIM_PROBES: ProbeSpec[] = [
  { type: 'sim-probe-v', label: 'Voltage Probe', kind: 'voltage' },
  { type: 'sim-probe-vdiff', label: 'Diff. Voltage Probe', kind: 'diff' },
  { type: 'sim-probe-i', label: 'Current Probe', kind: 'current' }
]

const cache = new Map<string, PartDef>()

/** Small triangular pennant + stem from y=0 to y=stemLen, CircuitLab-style. */
function flag(cx: number, stemLen: number): string {
  const pennantH = Math.min(1.1 * P, stemLen * 0.6)
  return (
    line(cx, 0, cx, stemLen) +
    `<path d="M ${cx} 0 L ${cx + 1.6 * P} ${pennantH / 2} L ${cx} ${pennantH} Z" fill="${FLAG}" stroke="${INK}" stroke-width="1"/>`
  )
}

export function generateSimProbe(spec: ProbeSpec): PartDef {
  const hit = cache.get(spec.type)
  if (hit) return hit

  let view: PartView
  if (spec.kind === 'current') {
    // inline ammeter: two pins on a horizontal line through a circled "A"
    const w = 4 * P
    const h = 2 * P
    const cy = P
    const r = 0.85 * P
    const svg = symbolSvg(
      line(0, cy, w / 2 - r, cy) +
        line(w / 2 + r, cy, w, cy) +
        circle(w / 2, cy, r, STROKE, FLAG) +
        text(w / 2, cy + 3, 'A', { size: FONT_SYMBOL + 1, anchor: 'middle' }),
      w,
      h
    )
    view = { svg, w, h, pins: { in: [0, cy], out: [w, cy] } }
  } else if (spec.kind === 'diff') {
    const stem = 2.4 * P
    const w = 3.6 * P
    const h = stem + 0.8 * P
    const svg = symbolSvg(
      `<g transform="translate(${0.3 * P},0)">${flag(0, stem)}</g>` +
        `<g transform="translate(${2 * P},0)">${flag(0, stem)}</g>` +
        text(w / 2, h - 1, '+ −', { size: FONT_PIN, anchor: 'middle' }),
      w,
      h
    )
    view = { svg, w, h, pins: { '+': [0.3 * P, stem], '-': [2 * P, stem] } }
  } else {
    const stem = 2.4 * P
    const w = 2.4 * P
    const h = stem
    const svg = symbolSvg(flag(0.4 * P, stem), w, h)
    view = { svg, w, h, pins: { '+': [0.4 * P, stem] } }
  }

  const def: PartDef = {
    type: spec.type,
    label: spec.label,
    family: 'Probe',
    builtin: true,
    bin: 'core',
    searchOnly: true,
    views: { breadboard: view, schematic: view }
  }
  cache.set(spec.type, def)
  return def
}

export function isSimProbe(type: string): boolean {
  return SIM_PROBES.some((s) => s.type === type)
}

export function probeKindOf(type: string): ProbeKind | undefined {
  return SIM_PROBES.find((s) => s.type === type)?.kind
}

/** Default attrs for a just-placed probe (Inspector-editable `label`). */
export function simProbeDefaultAttrs(type: string): Record<string, string> | undefined {
  const spec = SIM_PROBES.find((s) => s.type === type)
  return spec ? { label: spec.label } : undefined
}
