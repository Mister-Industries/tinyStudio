/**
 * circuit/views/sim/Plot — uPlot-backed waveform display (M4, spec §10.4).
 *
 * One component for the three sweep shapes:
 *   - transient: x = time (linear)
 *   - dc sweep:  x = the swept source voltage (`v(v-sweep)`)
 *   - ac:        x = frequency (log), traces = magnitude in dB, plus dashed
 *                phase traces on a right-hand degree axis
 *
 * uPlot gives cursors, drag-zoom (double-click resets), and a legend with
 * click-to-toggle series for free. Theme colors are read from the design
 * tokens at mount. CSV export lives here too (visible vectors, full data).
 */

import React from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { SimRun, SimVector } from '../../sim'

export const TRACES = ['#4f9cf9', '#f36e6e', '#54c08a', '#e5b567', '#b78be5', '#5bc8c8', '#e08fd0', '#9aa76b']

export type PlotMode = 'tran' | 'dc' | 'ac'

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const mag = (re: number, im: number): number => Math.sqrt(re * re + im * im)
const db = (m: number): number => 20 * Math.log10(Math.max(m, 1e-20))
const deg = (re: number, im: number): number => (Math.atan2(im, re) * 180) / Math.PI

interface Prepared {
  data: uPlot.AlignedData
  series: uPlot.Series[]
  xLabel: string
  isLog: boolean
  hasPhase: boolean
}

function prepare(
  run: SimRun,
  mode: PlotMode,
  labelFor?: (name: string) => string | undefined
): Prepared | null {
  const x =
    mode === 'ac'
      ? run.vectors.find((v) => v.type === 'frequency')
      : mode === 'dc'
        ? (run.vectors.find((v) => v.name.toLowerCase() === 'v(v-sweep)') ?? run.vectors[0])
        : (run.vectors.find((v) => v.type === 'time') ?? run.vectors[0])
  if (!x) return null
  const ys = run.vectors
    .filter(
      (v) =>
        v !== x &&
        v.name.toLowerCase() !== 'v(v-sweep)' &&
        (v.name.startsWith('v(') || v.name.startsWith('vdiff('))
    )
    .slice(0, TRACES.length)
  if (!ys.length) return null

  const series: uPlot.Series[] = [{ label: mode === 'ac' ? 'Hz' : mode === 'dc' ? 'Vsweep' : 's' }]
  const cols: number[][] = []

  const isAc = mode === 'ac' && ys.some((v) => v.imag)
  for (let i = 0; i < ys.length; i++) {
    const v = ys[i]
    const name = labelFor?.(v.name) ?? v.name
    if (isAc) {
      cols.push(v.values.map((re, k) => db(mag(re, v.imag?.[k] ?? 0))))
      series.push({
        label: `${name} dB`,
        stroke: TRACES[i],
        width: 1.4,
        scale: 'y',
        value: (_u, val) => (val == null ? '' : `${val.toFixed(1)} dB`)
      })
    } else {
      cols.push(v.values)
      series.push({
        label: name,
        stroke: TRACES[i],
        width: 1.4,
        scale: 'y',
        value: (_u, val) => (val == null ? '' : `${fmtEng(val)}V`)
      })
    }
  }
  if (isAc) {
    for (let i = 0; i < ys.length; i++) {
      const v = ys[i]
      const name = labelFor?.(v.name) ?? v.name
      cols.push(v.values.map((re, k) => deg(re, v.imag?.[k] ?? 0)))
      series.push({
        label: `${name} °`,
        stroke: TRACES[i],
        width: 1,
        dash: [4, 4],
        scale: 'deg',
        value: (_u, val) => (val == null ? '' : `${val.toFixed(1)}°`)
      })
    }
  }
  return {
    data: [x.values, ...cols] as uPlot.AlignedData,
    series,
    xLabel: mode === 'ac' ? 'frequency (Hz)' : mode === 'dc' ? 'sweep (V)' : 'time (s)',
    isLog: mode === 'ac',
    hasPhase: isAc
  }
}

export function fmtEng(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}k`
  if (a >= 1) return v.toFixed(2)
  if (a >= 1e-3) return `${(v * 1e3).toFixed(2)}m`
  if (a >= 1e-6) return `${(v * 1e6).toFixed(2)}µ`
  if (a === 0) return '0'
  return `${(v * 1e9).toFixed(2)}n`
}

export function SimPlot({
  run,
  mode,
  labelFor
}: {
  run: SimRun
  mode: PlotMode
  /** override a vector's displayed legend name (e.g. a probe's label) */
  labelFor?: (name: string) => string | undefined
}): React.JSX.Element {
  const host = React.useRef<HTMLDivElement>(null)
  const plot = React.useRef<uPlot | null>(null)
  const prepared = React.useMemo(() => prepare(run, mode, labelFor), [run, mode, labelFor])

  React.useEffect(() => {
    const el = host.current
    if (!el || !prepared) return
    const axisInk = cssVar('--text-muted', '#9aa1ab')
    const gridInk = cssVar('--border-default', '#2a2f37')

    const make = (width: number): uPlot => {
      const axes: uPlot.Axis[] = [
        {
          label: prepared.xLabel,
          stroke: axisInk,
          labelSize: 14,
          grid: { stroke: gridInk, width: 0.5 },
          ticks: { stroke: gridInk },
          values: prepared.isLog
            ? (_u, splits) => splits.map((s) => fmtEng(s))
            : (_u, splits) => splits.map((s) => fmtEng(s))
        },
        {
          scale: 'y',
          stroke: axisInk,
          grid: { stroke: gridInk, width: 0.5 },
          ticks: { stroke: gridInk },
          values: (_u, splits) => splits.map((s) => fmtEng(s))
        }
      ]
      if (prepared.hasPhase)
        axes.push({
          scale: 'deg',
          side: 1,
          stroke: axisInk,
          grid: { show: false },
          ticks: { stroke: gridInk },
          values: (_u, splits) => splits.map((s) => `${s}°`)
        })
      return new uPlot(
        {
          width,
          height: 220,
          series: prepared.series,
          scales: {
            x: prepared.isLog ? { distr: 3, log: 10 } : { time: false },
            y: {},
            ...(prepared.hasPhase ? { deg: {} } : {})
          },
          axes,
          legend: { live: true },
          cursor: { drag: { x: true, y: false } }
        },
        prepared.data,
        el
      )
    }

    plot.current = make(Math.max(el.clientWidth || 640, 320))
    const ro = new ResizeObserver(() => {
      const w = Math.max(el.clientWidth || 640, 320)
      plot.current?.setSize({ width: w, height: 220 })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      plot.current?.destroy()
      plot.current = null
    }
  }, [prepared])

  if (!prepared) return <div className="text-text-faint">no voltage vectors to plot</div>
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div ref={host} className="w-full min-w-0 [&_.u-legend]:text-[10px]" />
      <span className="text-[10px] text-text-faint">
        drag to zoom · double-click to reset · click legend entries to toggle traces
      </span>
    </div>
  )
}

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
