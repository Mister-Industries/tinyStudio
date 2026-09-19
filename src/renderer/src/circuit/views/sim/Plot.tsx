/**
 * circuit/views/sim/Plot: uPlot-backed waveform display (M4, spec §10.4).
 *
 * One component for the three sweep shapes:
 *   - transient: x = time (linear)
 *   - dc sweep:  x = the swept source voltage (`v(v-sweep)`)
 *   - ac:        x = frequency (log), traces = magnitude in dB, plus dashed
 *                phase traces on a right-hand degree axis
 *
 * Traces are limited to the outputs the user picked (core/simOutputs) when
 * they picked any; currents get their own right-hand axis so amps and volts
 * don't share a scale. Long runs are decimated for drawing only; the CSV
 * export and the underlying vectors keep every point.
 *
 * uPlot gives cursors, drag-zoom (double-click resets), and a legend with
 * click-to-toggle series for free. Theme colors are read from the design
 * tokens at mount.
 */

import React from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { SimRun, SimVector } from '../../sim'
import { fmtEng } from './format'
import { deg, mag, TRACES } from './plotData'

export type PlotMode = 'tran' | 'dc' | 'ac'

/** Above this many points a trace is decimated for drawing (min/max preserved
 * per bucket would be nicer; plain striding is enough to keep the canvas
 * responsive and is what stops a long .tran from locking the UI). */
const MAX_PLOT_POINTS = 8000

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const db = (m: number): number => 20 * Math.log10(Math.max(m, 1e-20))

const isCurrent = (name: string): boolean => /^i\(/i.test(name)
const isVoltage = (name: string): boolean => /^(v|vdiff)\(/i.test(name)

function stride(values: number[], step: number): number[] {
  if (step <= 1) return values
  const out: number[] = []
  for (let i = 0; i < values.length; i += step) out.push(values[i])
  const last = values[values.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

interface Prepared {
  data: uPlot.AlignedData
  series: uPlot.Series[]
  xLabel: string
  isLog: boolean
  hasPhase: boolean
  hasCurrent: boolean
  decimated: number
}

function prepare(
  run: SimRun,
  mode: PlotMode,
  labelFor?: (name: string) => string | undefined,
  pick?: (name: string) => boolean
): Prepared | null {
  const x =
    mode === 'ac'
      ? run.vectors.find((v) => v.type === 'frequency')
      : mode === 'dc'
        ? (run.vectors.find((v) => v.name.toLowerCase() === 'v(v-sweep)') ?? run.vectors[0])
        : (run.vectors.find((v) => v.type === 'time') ?? run.vectors[0])
  if (!x) return null

  const plottable = (v: SimVector): boolean =>
    v !== x && v.name.toLowerCase() !== 'v(v-sweep)' && (isVoltage(v.name) || isCurrent(v.name))

  const all = run.vectors.filter(plottable)
  // an explicit pick wins; if it selects nothing resolvable, fall back to all
  // rather than showing an empty chart
  const picked = pick ? all.filter((v) => pick(v.name)) : all
  let ys = (picked.length ? picked : all).slice(0, TRACES.length)
  // AC plots magnitude/phase; currents don't belong on a dB axis
  if (mode === 'ac') ys = ys.filter((v) => isVoltage(v.name))
  if (!ys.length) return null

  const step = Math.max(1, Math.ceil(x.values.length / MAX_PLOT_POINTS))
  const xs = stride(x.values, step)

  const series: uPlot.Series[] = [{ label: mode === 'ac' ? 'Hz' : mode === 'dc' ? 'Vsweep' : 's' }]
  const cols: number[][] = []

  const isAc = mode === 'ac' && ys.some((v) => v.imag)
  const hasCurrent = !isAc && ys.some((v) => isCurrent(v.name))

  for (let i = 0; i < ys.length; i++) {
    const v = ys[i]
    const name = labelFor?.(v.name) ?? v.name
    if (isAc) {
      cols.push(
        stride(
          v.values.map((re, k) => db(mag(re, v.imag?.[k] ?? 0))),
          step
        )
      )
      series.push({
        label: `${name} dB`,
        stroke: TRACES[i],
        width: 1.4,
        scale: 'y',
        value: (_u, val) => (val == null ? '' : `${val.toFixed(1)} dB`)
      })
    } else {
      const amps = isCurrent(v.name)
      cols.push(stride(v.values, step))
      series.push({
        label: name,
        stroke: TRACES[i],
        width: 1.4,
        dash: amps ? [5, 3] : undefined,
        scale: amps ? 'yi' : 'y',
        value: (_u, val) => (val == null ? '' : `${fmtEng(val)}${amps ? 'A' : 'V'}`)
      })
    }
  }
  if (isAc) {
    for (let i = 0; i < ys.length; i++) {
      const v = ys[i]
      const name = labelFor?.(v.name) ?? v.name
      cols.push(
        stride(
          v.values.map((re, k) => deg(re, v.imag?.[k] ?? 0)),
          step
        )
      )
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
    data: [xs, ...cols] as uPlot.AlignedData,
    series,
    xLabel: mode === 'ac' ? 'frequency (Hz)' : mode === 'dc' ? 'sweep (V)' : 'time (s)',
    isLog: mode === 'ac',
    hasPhase: isAc,
    hasCurrent,
    decimated: step > 1 ? x.values.length : 0
  }
}

export function SimPlot({
  run,
  mode,
  labelFor,
  pick,
  height = 220
}: {
  run: SimRun
  mode: PlotMode
  /** override a vector's displayed legend name (e.g. a probe's label) */
  labelFor?: (name: string) => string | undefined
  /** restrict traces to the outputs the user picked */
  pick?: (name: string) => boolean
  height?: number
}): React.JSX.Element {
  const host = React.useRef<HTMLDivElement>(null)
  const plot = React.useRef<uPlot | null>(null)
  const prepared = React.useMemo(
    () => prepare(run, mode, labelFor, pick),
    [run, mode, labelFor, pick]
  )

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
          values: (_u, splits) => splits.map((s) => fmtEng(s))
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
      if (prepared.hasCurrent)
        axes.push({
          scale: 'yi',
          side: 1,
          stroke: axisInk,
          grid: { show: false },
          ticks: { stroke: gridInk },
          values: (_u, splits) => splits.map((s) => `${fmtEng(s)}A`)
        })
      return new uPlot(
        {
          width,
          height,
          series: prepared.series,
          scales: {
            x: prepared.isLog ? { distr: 3, log: 10 } : { time: false },
            y: {},
            ...(prepared.hasPhase ? { deg: {} } : {}),
            ...(prepared.hasCurrent ? { yi: {} } : {})
          },
          axes,
          legend: { live: true },
          cursor: { drag: { x: true, y: false } }
        },
        prepared.data,
        el
      )
    }

    plot.current = make(Math.max(el.clientWidth || 640, 240))
    const ro = new ResizeObserver(() => {
      const w = Math.max(el.clientWidth || 640, 240)
      plot.current?.setSize({ width: w, height })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      plot.current?.destroy()
      plot.current = null
    }
  }, [prepared, height])

  if (!prepared) return <div className="text-text-faint">no vectors to plot for these outputs</div>
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div ref={host} className="w-full min-w-0 [&_.u-legend]:text-[10px]" />
      <span className="text-[10px] text-text-faint">
        drag to zoom · double-click to reset · click legend entries to toggle traces
        {prepared.decimated
          ? ` · drawn from ${MAX_PLOT_POINTS.toLocaleString()} of ${prepared.decimated.toLocaleString()} points (CSV has all)`
          : ''}
      </span>
    </div>
  )
}
