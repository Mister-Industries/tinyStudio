/**
 * circuit/views/sim/Plot: the results plot, CircuitLab style.
 *
 *   - one stacked panel per unit (Voltage, Current; Magnitude over Phase for
 *     AC) sharing one x axis, instead of a second y axis on the same panel
 *   - the hover cursor and drag-zoom are synced across panels; double-click
 *     resets the zoom everywhere
 *   - click to drop measurement marker A, click again for B: the readout
 *     under the plot gives each trace's value at A and B, the difference,
 *     and Δx (with 1/Δx as a frequency on a time axis)
 *   - one legend for the whole plot: hover values live, click to hide a trace
 *
 * Data shaping lives in plotData.plotModel (tested); this file only draws.
 * Long runs are decimated for drawing only; readouts and the CSV use every
 * point.
 */

import React from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { SimRun } from '../../sim'
import { fmtEng } from './format'
import { plotModel, TRACES, valueAt, type PlotMode, type PlotModel } from './plotData'

export type { PlotMode } from './plotData'

/** Above this many points a trace is decimated for drawing. */
const MAX_PLOT_POINTS = 8000
/** a click that moved less than this is a marker click, not a drag-zoom */
const CLICK_SLOP = 3

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function stride(values: number[], step: number): number[] {
  if (step <= 1) return values
  const out: number[] = []
  for (let i = 0; i < values.length; i += step) out.push(values[i])
  const last = values[values.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

/** axis ticks: "500µ", "2.5m", "1k" (no trailing zeros) */
const tick = (v: number, unit = ''): string => {
  const s = fmtEng(v)
  return (s.includes('.') ? s.replace(/\.?0+(?=\D*$)/, '') : s) + unit
}

const fmtVal = (v: number, unit: string): string =>
  !Number.isFinite(v)
    ? '—'
    : unit === ' dB' || unit === '°'
      ? `${v.toFixed(1)}${unit}`
      : `${fmtEng(v)}${unit}`

export function SimPlot({
  run,
  mode,
  labelFor,
  pick,
  height = 220
}: {
  run: SimRun
  mode: PlotMode
  /** override a vector's displayed name (probe labels, net names) */
  labelFor?: (name: string) => string | undefined
  /** restrict traces to the outputs the user picked */
  pick?: (name: string) => boolean
  /** total height of the stacked panels, x axis included */
  height?: number
}): React.JSX.Element {
  const model = React.useMemo(
    () => plotModel(run, mode, labelFor, pick),
    [run, mode, labelFor, pick]
  )
  const hosts = React.useRef<(HTMLDivElement | null)[]>([])
  const plots = React.useRef<uPlot[]>([])
  const [marks, setMarks] = React.useState<number[]>([])
  const marksRef = React.useRef(marks)
  marksRef.current = marks
  const [hoverX, setHoverX] = React.useState<number | null>(null)
  const [hidden, setHidden] = React.useState<Set<number>>(() => new Set())
  const hiddenRef = React.useRef(hidden)
  hiddenRef.current = hidden

  // a new run keeps the markers when the x range still covers them (Live
  // mode re-solves on every edit; the measurement should survive that)
  React.useEffect(() => {
    if (!model) return
    const lo = model.x[0]
    const hi = model.x[model.x.length - 1]
    setMarks((m) => m.filter((x) => x >= lo && x <= hi))
  }, [model])

  React.useEffect(() => {
    if (!model) return
    const axisInk = cssVar('--text-muted', '#9aa1ab')
    const gridInk = cssVar('--border-default', '#2a2f37')
    const markInk = cssVar('--text-strong', '#e6e8eb')
    const step = Math.max(1, Math.ceil(model.x.length / MAX_PLOT_POINTS))
    const xs = stride(model.x, step)
    const n = model.panels.length
    const xAxisH = 34
    const each = Math.max(90, Math.floor((height - xAxisH) / n))
    const syncKey = `simplot-${Math.random().toString(36).slice(2)}`
    let syncing = false
    const made: uPlot[] = []
    const cleanups: (() => void)[] = []

    model.panels.forEach((panel, pi) => {
      const el = hosts.current[pi]
      if (!el) return
      const bottom = pi === n - 1
      const series: uPlot.Series[] = [
        {},
        ...panel.traces.map((t) => ({
          label: t.label,
          stroke: TRACES[t.color % TRACES.length],
          width: 1.4,
          dash: panel.key === 'deg' ? [4, 3] : undefined,
          show: !hiddenRef.current.has(t.color)
        }))
      ]
      const opts: uPlot.Options = {
        width: Math.max(el.clientWidth || 640, 240),
        height: each + (bottom ? xAxisH : 6),
        series,
        legend: { show: false },
        scales: {
          x: model.log ? { distr: 3, log: 10 } : { time: false },
          y: {}
        },
        axes: [
          {
            stroke: axisInk,
            grid: { stroke: gridInk, width: 0.5 },
            ticks: { stroke: gridInk },
            size: bottom ? xAxisH : 6,
            values: (_u, splits) => (bottom ? splits.map((s) => tick(s)) : splits.map(() => ''))
          },
          {
            stroke: axisInk,
            grid: { stroke: gridInk, width: 0.5 },
            ticks: { stroke: gridInk },
            size: 58,
            label: panel.title,
            labelSize: 14,
            labelFont: '10px system-ui, sans-serif',
            values: (_u, splits) =>
              splits.map((s) =>
                panel.unit === 'V' || panel.unit === 'A' ? tick(s, panel.unit) : `${s}`
              )
          }
        ],
        cursor: {
          drag: { x: true, y: false },
          sync: { key: syncKey, setSeries: false },
          points: { size: 5 }
        },
        hooks: {
          // zoom one panel, zoom them all (dblclick reset included)
          setScale: [
            (u, key) => {
              if (key !== 'x' || syncing) return
              syncing = true
              const { min, max } = u.scales.x
              for (const o of made) if (o !== u) o.setScale('x', { min: min!, max: max! })
              syncing = false
            }
          ],
          setCursor: [
            (u) => {
              if (pi !== 0 && u.cursor.left == null) return
              const left = u.cursor.left
              setHoverX(left == null || left < 0 ? null : u.posToVal(left, 'x'))
            }
          ],
          draw: [
            (u) => {
              const ctx = u.ctx
              const { top, height: h } = u.bbox
              marksRef.current.forEach((mx, mi) => {
                const px = u.valToPos(mx, 'x', true)
                if (px < u.bbox.left || px > u.bbox.left + u.bbox.width) return
                ctx.save()
                ctx.strokeStyle = markInk
                ctx.lineWidth = 1 * devicePixelRatio
                ctx.setLineDash(mi === 0 ? [] : [4 * devicePixelRatio, 3 * devicePixelRatio])
                ctx.beginPath()
                ctx.moveTo(px, top)
                ctx.lineTo(px, top + h)
                ctx.stroke()
                if (pi === 0) {
                  ctx.fillStyle = markInk
                  ctx.font = `${10 * devicePixelRatio}px system-ui, sans-serif`
                  ctx.fillText(
                    mi === 0 ? 'A' : 'B',
                    px + 3 * devicePixelRatio,
                    top + 11 * devicePixelRatio
                  )
                }
                ctx.restore()
              })
            }
          ]
        }
      }
      const data = [xs, ...panel.traces.map((t) => stride(t.values, step))] as uPlot.AlignedData
      const u = new uPlot(opts, data, el)
      made.push(u)

      // click (not drag) drops marker A, then B, then starts over at A;
      // a double-click is uPlot's zoom reset, so a click waits to be sure
      let downX = 0
      let timer: ReturnType<typeof setTimeout> | undefined
      const down = (e: MouseEvent): void => {
        downX = e.clientX
      }
      const click = (e: MouseEvent): void => {
        if (Math.abs(e.clientX - downX) > CLICK_SLOP) return
        const x = u.posToVal(u.cursor.left ?? 0, 'x')
        clearTimeout(timer)
        timer = setTimeout(() => setMarks((m) => (m.length >= 2 ? [x] : [...m, x])), 230)
      }
      const dbl = (): void => clearTimeout(timer)
      u.over.addEventListener('mousedown', down)
      u.over.addEventListener('click', click)
      u.over.addEventListener('dblclick', dbl)
      cleanups.push(() => {
        clearTimeout(timer)
        u.over.removeEventListener('mousedown', down)
        u.over.removeEventListener('click', click)
        u.over.removeEventListener('dblclick', dbl)
      })
    })
    plots.current = made

    const ro = new ResizeObserver(() => {
      made.forEach((u, i) => {
        const el = hosts.current[i]
        if (el) u.setSize({ width: Math.max(el.clientWidth || 640, 240), height: u.height })
      })
    })
    hosts.current.forEach((el) => el && ro.observe(el))
    return () => {
      ro.disconnect()
      cleanups.forEach((c) => c())
      made.forEach((u) => u.destroy())
      plots.current = []
    }
  }, [model, height])

  // markers changed: redraw the overlays
  React.useEffect(() => {
    plots.current.forEach((u) => u.redraw(false))
  }, [marks])

  // hide/show a trace in every panel it appears in
  React.useEffect(() => {
    if (!model) return
    plots.current.forEach((u, pi) => {
      model.panels[pi]?.traces.forEach((t, ti) => {
        const show = !hidden.has(t.color)
        if (u.series[ti + 1]?.show !== show) u.setSeries(ti + 1, { show })
      })
    })
  }, [hidden, model])

  if (!model) return <div className="text-text-faint">no vectors to plot for these outputs</div>

  const decimated = model.x.length > MAX_PLOT_POINTS ? model.x.length : 0
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <Legend model={model} hoverX={hoverX} hidden={hidden} onToggle={setHidden} />
      <div className="flex items-start gap-2 min-w-0">
        <div className="flex-1 flex flex-col min-w-0">
          {model.panels.map((p, i) => (
            <div
              key={p.key}
              ref={(el) => {
                hosts.current[i] = el
              }}
              className="w-full min-w-0"
            />
          ))}
        </div>
        {marks.length > 0 && (
          <Readout model={model} marks={marks} hidden={hidden} onClear={() => setMarks([])} />
        )}
      </div>
      <span className="text-[10px] text-text-faint">
        click to place markers A and B · drag to zoom · double-click to reset
        {decimated
          ? ` · drawn from ${MAX_PLOT_POINTS.toLocaleString()} of ${decimated.toLocaleString()} points (CSV has all)`
          : ''}
      </span>
    </div>
  )
}

/** One legend for every panel: swatch, name, value under the cursor. */
function Legend({
  model,
  hoverX,
  hidden,
  onToggle
}: {
  model: PlotModel
  hoverX: number | null
  hidden: Set<number>
  onToggle: (f: (s: Set<number>) => Set<number>) => void
}): React.JSX.Element {
  // a trace appears once, even when AC shows it in two panels
  const items: { color: number; label: string; values: string[] }[] = []
  for (const p of model.panels) {
    for (const t of p.traces) {
      const v = hoverX == null ? '' : fmtVal(valueAt(model.x, t.values, hoverX), p.unit)
      const at = items.find((i) => i.color === t.color)
      if (at) {
        if (v) at.values.push(v)
        continue
      }
      items.push({ color: t.color, label: t.label, values: v ? [v] : [] })
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
      {hoverX != null && (
        <span className="font-mono text-text-faint tabular-nums">
          {model.xName.toLowerCase()} {fmtVal(hoverX, model.xUnit)}
        </span>
      )}
      {items.map((it) => {
        const off = hidden.has(it.color)
        return (
          <button
            key={it.color}
            className={`flex items-center gap-1.5 ${off ? 'opacity-40' : ''}`}
            title={off ? 'Show this trace' : 'Hide this trace'}
            onClick={() =>
              onToggle((s) => {
                const n = new Set(s)
                if (n.has(it.color)) n.delete(it.color)
                else n.add(it.color)
                return n
              })
            }
          >
            <span
              className="inline-block w-3 h-[3px] rounded-full"
              style={{ background: TRACES[it.color % TRACES.length] }}
            />
            <span className="text-text-body">{it.label}</span>
            {it.values.length > 0 && (
              <span className="font-mono text-text-muted tabular-nums">
                {it.values.join(' ∠ ')}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Marker readout: each trace at A and B, and the differences. */
function Readout({
  model,
  marks,
  hidden,
  onClear
}: {
  model: PlotModel
  marks: number[]
  hidden: Set<number>
  onClear: () => void
}): React.JSX.Element {
  const [a, b] = marks
  const dx = b !== undefined ? b - a : undefined
  const xu = model.xUnit
  return (
    <div className="w-[300px] shrink-0 rounded-md border border-border-default bg-bg-sunken px-2 py-1.5 text-[11px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono tabular-nums text-text-muted">
        <span>
          A <span className="text-text-strong">{fmtVal(a, xu)}</span>
        </span>
        {b !== undefined && (
          <span>
            B <span className="text-text-strong">{fmtVal(b, xu)}</span>
          </span>
        )}
        {dx !== undefined && (
          <span>
            Δ <span className="text-text-strong">{fmtVal(dx, xu)}</span>
            {xu === 's' && dx !== 0 && (
              <span className="text-text-faint"> ({fmtVal(1 / Math.abs(dx), 'Hz')})</span>
            )}
          </span>
        )}
        <div className="flex-1" />
        <button className="font-sans text-text-faint hover:text-text-body" onClick={onClear}>
          clear markers
        </button>
      </div>
      <table className="mt-1 w-full font-mono tabular-nums">
        <thead>
          <tr className="text-text-faint text-left">
            <th className="font-normal font-sans pr-3">trace</th>
            <th className="font-normal pr-3">at A</th>
            {b !== undefined && <th className="font-normal pr-3">at B</th>}
            {b !== undefined && <th className="font-normal">Δ</th>}
          </tr>
        </thead>
        <tbody>
          {model.panels.flatMap((p) =>
            p.traces
              .filter((t) => !hidden.has(t.color))
              .map((t) => {
                const va = valueAt(model.x, t.values, a)
                const vb = b !== undefined ? valueAt(model.x, t.values, b) : undefined
                return (
                  <tr key={`${p.key}-${t.color}`} className="text-text-body">
                    <td className="font-sans pr-3">
                      <span
                        className="inline-block w-2.5 h-[3px] rounded-full mr-1.5 align-middle"
                        style={{ background: TRACES[t.color % TRACES.length] }}
                      />
                      {t.label}
                      {model.panels.length > 1 && p.key !== 'V' && p.key !== 'A' && (
                        <span className="text-text-faint"> {p.key === 'dB' ? 'mag' : 'phase'}</span>
                      )}
                    </td>
                    <td className="pr-3">{fmtVal(va, p.unit)}</td>
                    {vb !== undefined && <td className="pr-3">{fmtVal(vb, p.unit)}</td>}
                    {vb !== undefined && <td>{fmtVal(vb - va, p.unit)}</td>}
                  </tr>
                )
              })
          )}
        </tbody>
      </table>
    </div>
  )
}
