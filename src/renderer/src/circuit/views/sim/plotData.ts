import type { SimRun, SimVector } from '../../sim'

/** Trace colours, in series order; also caps how many traces a plot shows. */
export const TRACES = [
  '#4f9cf9',
  '#f36e6e',
  '#54c08a',
  '#e5b567',
  '#b78be5',
  '#5bc8c8',
  '#e08fd0',
  '#9aa76b'
]

export const mag = (re: number, im: number): number => Math.sqrt(re * re + im * im)
export const deg = (re: number, im: number): number => (Math.atan2(im, re) * 180) / Math.PI

/** CSV of every vector in the run (x first), raw numbers. */
export function runToCsv(run: SimRun): string {
  const cols: { name: string; values: number[] }[] = []
  for (const v of run.vectors as SimVector[]) {
    if (v.imag) {
      cols.push({ name: `${v.name} (mag)`, values: v.values.map((re, k) => mag(re, v.imag![k])) })
      cols.push({ name: `${v.name} (deg)`, values: v.values.map((re, k) => deg(re, v.imag![k])) })
    } else {
      cols.push({ name: v.name, values: v.values })
    }
  }
  const n = Math.max(...cols.map((c) => c.values.length))
  const lines = [cols.map((c) => JSON.stringify(c.name)).join(',')]
  for (let i = 0; i < n; i++) lines.push(cols.map((c) => c.values[i] ?? '').join(','))
  return lines.join('\n') + '\n'
}

// ── the on-screen plot's model ───────────────────────────────────────────────

export type PlotMode = 'tran' | 'dc' | 'ac'

export interface PlotTrace {
  label: string
  /** index into TRACES: one trace keeps its colour across panels */
  color: number
  values: number[]
}

/** One stacked panel per unit, CircuitLab style: volts and amps never share
 * an axis, and AC gets magnitude over phase. */
export interface PlotPanel {
  key: 'V' | 'A' | 'dB' | 'deg'
  /** unit suffix for values ("V", "A", " dB", "°") */
  unit: string
  title: string
  traces: PlotTrace[]
}

export interface PlotModel {
  x: number[]
  xName: string
  xUnit: string
  log: boolean
  panels: PlotPanel[]
}

const isCurrentVec = (name: string): boolean => /^i\(/i.test(name)
const isVoltageVec = (name: string): boolean => /^(v|vdiff)\(/i.test(name)
const dbOf = (m: number): number => 20 * Math.log10(Math.max(m, 1e-20))

/** The run arranged for plotting; null when nothing is plottable. Full
 * resolution: the view decimates for drawing, readouts use every point. */
export function plotModel(
  run: SimRun,
  mode: PlotMode,
  labelFor?: (name: string) => string | undefined,
  pick?: (name: string) => boolean
): PlotModel | null {
  const x =
    mode === 'ac'
      ? run.vectors.find((v) => v.type === 'frequency')
      : mode === 'dc'
        ? (run.vectors.find((v) => v.name.toLowerCase() === 'v(v-sweep)') ?? run.vectors[0])
        : (run.vectors.find((v) => v.type === 'time') ?? run.vectors[0])
  if (!x) return null
  const plottable = (v: SimVector): boolean =>
    v !== x &&
    v.name.toLowerCase() !== 'v(v-sweep)' &&
    (isVoltageVec(v.name) || isCurrentVec(v.name))
  const all = run.vectors.filter(plottable)
  // an explicit pick wins; if it selects nothing resolvable, show everything
  const picked = pick ? all.filter((v) => pick(v.name)) : all
  let ys = (picked.length ? picked : all).slice(0, TRACES.length)
  const isAc = mode === 'ac'
  if (isAc) ys = ys.filter((v) => isVoltageVec(v.name))
  if (!ys.length) return null
  const name = (v: SimVector): string =>
    labelFor?.(v.name) ?? v.name.replace(/^(\w+)\(/, (m) => m.toUpperCase())

  const panels: PlotPanel[] = []
  if (isAc) {
    panels.push({
      key: 'dB',
      unit: ' dB',
      title: 'Magnitude (dB)',
      traces: ys.map((v, i) => ({
        label: name(v),
        color: i,
        values: v.values.map((re, k) => dbOf(mag(re, v.imag?.[k] ?? 0)))
      }))
    })
    panels.push({
      key: 'deg',
      unit: '°',
      title: 'Phase (°)',
      traces: ys.map((v, i) => ({
        label: name(v),
        color: i,
        values: v.values.map((re, k) => deg(re, v.imag?.[k] ?? 0))
      }))
    })
  } else {
    const volts = ys.flatMap((v, i) =>
      isVoltageVec(v.name) ? [{ label: name(v), color: i, values: v.values }] : []
    )
    const amps = ys.flatMap((v, i) =>
      isCurrentVec(v.name) ? [{ label: name(v), color: i, values: v.values }] : []
    )
    if (volts.length) panels.push({ key: 'V', unit: 'V', title: 'Voltage', traces: volts })
    if (amps.length) panels.push({ key: 'A', unit: 'A', title: 'Current', traces: amps })
  }
  return {
    x: x.values,
    xName: isAc ? 'Frequency' : mode === 'dc' ? 'Sweep' : 'Time',
    xUnit: isAc ? 'Hz' : mode === 'dc' ? 'V' : 's',
    log: isAc,
    panels
  }
}

/** y at x by linear interpolation between samples (x ascending); clamps. */
export function valueAt(xs: number[], ys: number[], x: number): number {
  const n = xs.length
  if (!n) return NaN
  if (x <= xs[0]) return ys[0]
  if (x >= xs[n - 1]) return ys[n - 1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= x) lo = mid
    else hi = mid
  }
  const t = xs[hi] === xs[lo] ? 0 : (x - xs[lo]) / (xs[hi] - xs[lo])
  return ys[lo] + (ys[hi] - ys[lo]) * t
}
