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
