/**
 * circuit/views/sim/figure: a simulation result as a figure for a paper.
 *
 * The on-screen plot (Plot.tsx) is for exploring; this draws the same run as a
 * static SVG that drops into a report or a LaTeX document unchanged:
 *
 *   - sized for a journal column: 3.5 in single, 7 in double, at 96 px/in
 *   - white background, slate ink, Helvetica/Arial, nothing from the app theme
 *   - one stacked panel per unit (volts, amps; dB and degrees for AC) sharing
 *     the x axis, instead of two y axes on one panel
 *   - axes in engineering units ("Time (ms)"), round tick values
 *   - colour-blind-safe colours (Okabe–Ito) plus a dash pattern per trace, so
 *     a black-and-white print still tells the traces apart
 *
 * Pure string building: no DOM, so it is unit-tested and runs anywhere.
 */

import type { SimRun, SimVector } from '../../sim'
import { deg, mag } from './plotData'

export type FigureMode = 'tran' | 'dc' | 'ac'
export type FigureWidth = 'single' | 'double'

export interface FigureOptions {
  mode: FigureMode
  width?: FigureWidth
  title?: string
  /** display name for a vector (probe labels, net names) */
  labelFor?: (name: string) => string | undefined
  /** keep only these vectors (the picked outputs) */
  pick?: (name: string) => boolean
}

const INK = '#3b4449'
const GRID = '#e3e6e8'
const FONT = 'Helvetica, Arial, sans-serif'
const COLORS = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#000000']
const DASHES = ['', '5 2.5', '1.5 2', '6 2 1.5 2']
const MAX_POINTS = 2000

const PREFIX: [number, string][] = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p']
]

/** Scale for an axis whose largest magnitude is `max`: ms, µA, kHz… */
export function siScale(max: number): { factor: number; prefix: string } {
  const a = Math.abs(max)
  if (!a || !Number.isFinite(a)) return { factor: 1, prefix: '' }
  for (const [f, p] of PREFIX) if (a >= f * 0.999) return { factor: 1 / f, prefix: p }
  return { factor: 1e12, prefix: 'p' }
}

/** Round tick values covering [lo, hi], about `n` of them. */
export function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo)) {
    const pad = Math.abs(lo) * 0.1 || 1
    return niceTicks(lo - pad, hi + pad, n)
  }
  const raw = (hi - lo) / n
  const mag10 = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag10).find((s) => s >= raw) ?? 10 * mag10
  const start = Math.floor(lo / step + 1e-9) * step
  const out: number[] = []
  for (let v = start; v <= hi + step * 0.999; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return out
}

function fmtTick(v: number): string {
  const s = Number(v.toPrecision(4)).toString()
  return s.replace('-', '−')
}

const esc = (s: string): string =>
  s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)

interface Trace {
  label: string
  y: number[]
}

interface Panel {
  quantity: string
  unit: string
  traces: Trace[]
}

function decimate(n: number): number {
  return Math.max(1, Math.ceil(n / MAX_POINTS))
}

/** Split the run into x and stacked panels, by unit. */
function panelsOf(run: SimRun, o: FigureOptions): { x: number[]; panels: Panel[] } | null {
  const vx =
    o.mode === 'ac'
      ? run.vectors.find((v) => v.type === 'frequency')
      : o.mode === 'dc'
        ? (run.vectors.find((v) => v.name.toLowerCase() === 'v(v-sweep)') ?? run.vectors[0])
        : (run.vectors.find((v) => v.type === 'time') ?? run.vectors[0])
  if (!vx) return null
  const isV = (v: SimVector): boolean => /^(v|vdiff)\(/i.test(v.name)
  const isI = (v: SimVector): boolean => /^i\(/i.test(v.name)
  const usable = run.vectors.filter(
    (v) =>
      v !== vx &&
      v.name.toLowerCase() !== 'v(v-sweep)' &&
      (isV(v) || isI(v)) &&
      (o.pick ? o.pick(v.name) : true)
  )
  // V(out), I(R1): the quantity letter upper case, the node as named
  const name = (v: SimVector): string =>
    o.labelFor?.(v.name) ?? v.name.replace(/^(\w+)\(/, (m) => m.toUpperCase())
  const panels: Panel[] = []
  if (o.mode === 'ac') {
    const m = usable.filter((v) => v.imag)
    if (!m.length) return null
    panels.push({
      quantity: 'Magnitude',
      unit: 'dB',
      traces: m.map((v) => ({
        label: name(v),
        y: v.values.map((re, k) => 20 * Math.log10(Math.max(mag(re, v.imag![k]), 1e-20)))
      }))
    })
    panels.push({
      quantity: 'Phase',
      unit: '°',
      traces: m.map((v) => ({ label: name(v), y: v.values.map((re, k) => deg(re, v.imag![k])) }))
    })
  } else {
    const vs = usable.filter(isV)
    const is = usable.filter(isI)
    if (vs.length)
      panels.push({
        quantity: 'Voltage',
        unit: 'V',
        traces: vs.map((v) => ({ label: name(v), y: v.values }))
      })
    if (is.length)
      panels.push({
        quantity: 'Current',
        unit: 'A',
        traces: is.map((v) => ({ label: name(v), y: v.values }))
      })
  }
  return panels.length ? { x: vx.values, panels } : null
}

/** The figure as a standalone SVG document, or null when nothing plots. */
export function figureSvg(run: SimRun, o: FigureOptions): string | null {
  const data = panelsOf(run, o)
  if (!data) return null
  const W = o.width === 'double' ? 672 : 336
  const fs = 10 // 7.5 pt at print size
  const left = 50
  const right = 10
  const top = o.title ? 22 : 8
  const ph = o.width === 'double' ? 150 : 120
  const gap = 12
  const bottom = 34
  const H = top + data.panels.length * ph + (data.panels.length - 1) * gap + bottom
  const pw = W - left - right

  const step = decimate(data.x.length)
  const xs = data.x.filter((_, i) => i % step === 0 || i === data.x.length - 1)
  const idx = data.x.map((_, i) => i).filter((i) => i % step === 0 || i === data.x.length - 1)
  const log = o.mode === 'ac'
  const xmin = Math.min(...xs)
  const xmax = Math.max(...xs)
  const xs1 = log ? null : siScale(Math.max(Math.abs(xmin), Math.abs(xmax)))
  const X = (v: number): number =>
    left +
    (log
      ? ((Math.log10(v) - Math.log10(xmin)) / (Math.log10(xmax) - Math.log10(xmin) || 1)) * pw
      : ((v - xmin) / (xmax - xmin || 1)) * pw)
  const xTicks = log
    ? Array.from(
        { length: Math.floor(Math.log10(xmax)) - Math.ceil(Math.log10(xmin)) + 1 },
        (_, i) => 10 ** (Math.ceil(Math.log10(xmin)) + i)
      )
    : niceTicks(xmin * xs1!.factor, xmax * xs1!.factor, o.width === 'double' ? 8 : 5)
        .map((t) => t / xs1!.factor)
        .filter((t) => t >= xmin - 1e-12 && t <= xmax + 1e-12)
  const xName = o.mode === 'ac' ? 'Frequency' : o.mode === 'dc' ? 'Source voltage' : 'Time'
  const xUnit = o.mode === 'ac' ? 'Hz' : o.mode === 'dc' ? 'V' : 's'

  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" font-size="${fs}">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`
  ]
  if (o.title)
    out.push(
      `<text x="${left}" y="14" font-size="${fs + 1}" font-weight="bold" fill="${INK}">${esc(o.title)}</text>`
    )

  data.panels.forEach((p, pi) => {
    const y0 = top + pi * (ph + gap)
    const all = p.traces.flatMap((t) => idx.map((i) => t.y[i])).filter(Number.isFinite)
    let lo = Math.min(...all)
    let hi = Math.max(...all)
    // a nearly flat trace (a settled DC level plus solver noise) would get
    // ticks that all print the same; give the axis a sensible minimum span
    const minSpan = Math.max(Math.abs(lo), Math.abs(hi)) * 0.2
    if (hi - lo < minSpan) {
      const mid = (hi + lo) / 2
      lo = mid - minSpan / 2
      hi = mid + minSpan / 2
    }
    const pad = (hi - lo) * 0.06 || 1
    lo -= pad
    hi += pad
    const ys =
      p.unit === 'dB' || p.unit === '°'
        ? { factor: 1, prefix: '' }
        : siScale(Math.max(Math.abs(lo), Math.abs(hi)))
    const yTicks = niceTicks(lo * ys.factor, hi * ys.factor, 4)
    lo = Math.min(lo, yTicks[0] / ys.factor)
    hi = Math.max(hi, yTicks[yTicks.length - 1] / ys.factor)
    const Y = (v: number): number => y0 + ph - ((v - lo) / (hi - lo || 1)) * ph

    // grid, then frame
    for (const t of xTicks)
      out.push(
        `<line x1="${X(t).toFixed(2)}" y1="${y0}" x2="${X(t).toFixed(2)}" y2="${y0 + ph}" stroke="${GRID}" stroke-width="0.6"/>`
      )
    for (const t of yTicks) {
      const y = Y(t / ys.factor).toFixed(2)
      out.push(
        `<line x1="${left}" y1="${y}" x2="${left + pw}" y2="${y}" stroke="${GRID}" stroke-width="0.6"/>`
      )
      out.push(
        `<text x="${left - 4}" y="${(+y + fs * 0.35).toFixed(2)}" text-anchor="end" fill="${INK}">${fmtTick(t)}</text>`
      )
    }
    out.push(
      `<rect x="${left}" y="${y0}" width="${pw}" height="${ph}" fill="none" stroke="${INK}" stroke-width="0.8"/>`
    )
    const yLabel = `${p.quantity} (${ys.prefix}${p.unit})`
    out.push(
      `<text transform="translate(${12},${y0 + ph / 2}) rotate(-90)" text-anchor="middle" fill="${INK}">${esc(yLabel)}</text>`
    )

    // traces
    p.traces.forEach((t, ti) => {
      const d = idx
        .map((i, k) => {
          const v = t.y[i]
          if (!Number.isFinite(v)) return ''
          return `${k ? 'L' : 'M'}${X(data.x[i]).toFixed(2)} ${Y(v).toFixed(2)}`
        })
        .join('')
      const dash = DASHES[ti % DASHES.length]
      out.push(
        `<path d="${d}" fill="none" stroke="${COLORS[ti % COLORS.length]}" stroke-width="1.3" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
      )
    })

    // legend, top right inside the panel
    // every panel names its traces once there is more than one panel
    if (p.traces.length > 1 || pi === 0 || data.panels.length > 1) {
      const lw = Math.max(...p.traces.map((t) => t.label.length)) * fs * 0.56 + 30
      const lx = left + pw - lw - 4
      const ly = y0 + 4
      out.push(
        `<rect x="${lx.toFixed(2)}" y="${ly}" width="${lw.toFixed(2)}" height="${p.traces.length * (fs + 3) + 5}" fill="#ffffff" fill-opacity="0.9" stroke="${GRID}" stroke-width="0.6"/>`
      )
      p.traces.forEach((t, ti) => {
        const yy = ly + 5 + ti * (fs + 3) + fs / 2
        const dash = DASHES[ti % DASHES.length]
        out.push(
          `<line x1="${(lx + 5).toFixed(2)}" y1="${yy}" x2="${(lx + 21).toFixed(2)}" y2="${yy}" stroke="${COLORS[ti % COLORS.length]}" stroke-width="1.3"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
        )
        out.push(
          `<text x="${(lx + 25).toFixed(2)}" y="${(yy + fs * 0.35).toFixed(2)}" fill="${INK}">${esc(t.label)}</text>`
        )
      })
    }
  })

  // shared x axis under the last panel
  const yb = top + data.panels.length * ph + (data.panels.length - 1) * gap
  for (const t of xTicks) {
    const label = log ? fmtLogTick(t) : fmtTick(t * xs1!.factor)
    out.push(
      `<text x="${X(t).toFixed(2)}" y="${yb + fs + 3}" text-anchor="middle" fill="${INK}">${label}</text>`
    )
  }
  const xLabel = `${xName} (${log ? '' : xs1!.prefix}${xUnit})`
  out.push(
    `<text x="${left + pw / 2}" y="${yb + fs * 2 + 9}" text-anchor="middle" fill="${INK}">${esc(xLabel)}</text>`
  )
  out.push('</svg>')
  return out.join('')
}

function fmtLogTick(v: number): string {
  const { factor, prefix } = siScale(v)
  return `${Number((v * factor).toPrecision(3))}${prefix}`
}
