/**
 * circuit/views/sim/SimPanel — the M4 Simulate panel (spec §10.4, first cut).
 *
 * Docked at the bottom of the circuit area: analysis tabs (DC / Transient),
 * parameters, Run/Cancel, results. DC (.op) lists node voltages and source
 * currents — and the shell mirrors them onto the schematic as annotations;
 * transient renders probe traces in a lightweight inline SVG plot (uPlot
 * arrives with the full plotting pass — cursors/zoom/AC are M4 backlog).
 *
 * Analysis config persists in doc.sim via Commands (undoable, serialized).
 */

import { CircuitBoard, Loader2, Play, Square, X } from 'lucide-react'
import React from 'react'
import * as cmd from '../../core/commands'
import type { Analysis, CircuitDoc } from '../../core/model'
import type { NetModel } from '../../core/nets'
import { generateNetlist, type NetlistResult } from '../../core/netlist'
import type { CircuitStore } from '../../core/store'
import { getSimBackend, SimError } from '../../sim'
import type { SimRun } from '../../sim'

const field =
  'bg-bg-sunken border border-border-default rounded px-2 py-1 text-text-strong outline-none focus:border-brand w-20 text-xs'

export interface SimState {
  run: SimRun | null
  netlist: NetlistResult | null
}

export function SimPanel({
  doc,
  netModel,
  store,
  familyOf,
  onClose,
  onResult
}: {
  doc: CircuitDoc
  netModel: NetModel
  store: CircuitStore
  familyOf: (type: string) => string | undefined
  onClose: () => void
  /** surfaces the run to the shell (canvas DC annotations) */
  onResult: (s: SimState) => void
}): React.JSX.Element {
  const analysis: Analysis = doc.sim?.analyses?.[0] ?? { id: 'a1', kind: 'op' }
  const [running, setRunning] = React.useState(false)
  const [result, setResult] = React.useState<SimRun | null>(null)
  const [gen, setGen] = React.useState<NetlistResult | null>(null)
  const [error, setError] = React.useState<{ message: string; details?: string[] } | null>(null)
  const [showNetlist, setShowNetlist] = React.useState(false)
  const [hidden, setHidden] = React.useState<Set<string>>(new Set())

  const setAnalysis = (patch: Partial<Analysis>): void => {
    store.dispatch(cmd.setAnalyses([{ ...analysis, ...patch }]))
  }

  const run = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    const g = generateNetlist(doc, netModel, { familyOf, title: 'tinyStudio circuit' })
    setGen(g)
    try {
      const r = await getSimBackend().run(g.netlist, 20000)
      setResult(r)
      onResult({ run: r, netlist: g })
    } catch (err) {
      setResult(null)
      onResult({ run: null, netlist: g })
      setError(
        err instanceof SimError
          ? { message: err.message, details: err.details }
          : { message: err instanceof Error ? err.message : String(err) }
      )
    } finally {
      setRunning(false)
    }
  }

  const cancel = (): void => {
    getSimBackend().cancel()
    setRunning(false)
  }

  const isOp = result != null && result.numPoints === 1

  // "v(n1)" → the net's members ("R1:Pin 1 · LED1:anode"); "i(vv1)" → source
  const describe = React.useCallback(
    (vecName: string): string | undefined => {
      if (!gen) return undefined
      const m = /^v\((.+)\)$/i.exec(vecName)
      if (m) {
        const node = m[1]
        const i = gen.nodeOfNet.findIndex((n) => n.toLowerCase() === node.toLowerCase())
        if (i < 0) return undefined
        const members = netModel.nets[i] ?? []
        return members.slice(0, 4).join(' · ') + (members.length > 4 ? ' …' : '')
      }
      const im = /^i\((.+)\)$/i.exec(vecName)
      if (im) return `current through ${im[1].toUpperCase()}`
      return undefined
    },
    [gen, netModel]
  )

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-border-default bg-bg-raised flex flex-col max-h-[45%]">
      {/* header row: analysis config + run */}
      <div className="flex items-center gap-2 px-3 h-10 shrink-0 border-b border-border-default">
        <CircuitBoard size={14} className="text-brand" />
        <span className="text-xs font-semibold text-text-strong">Simulate</span>

        <div className="flex rounded-md overflow-hidden tactile-bordered ml-3">
          {(
            [
              ['op', 'DC'],
              ['tran', 'Transient']
            ] as [Analysis['kind'], string][]
          ).map(([kind, label]) => (
            <button
              key={kind}
              className={`h-7 px-2.5 text-[11px] font-medium ${
                analysis.kind === kind
                  ? 'bg-brand/15 text-brand'
                  : 'bg-surface-card text-text-muted hover:text-text-body'
              }`}
              onClick={() => setAnalysis({ kind })}
            >
              {label}
            </button>
          ))}
        </div>

        {analysis.kind === 'tran' && (
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span>step</span>
            <input
              className={field}
              defaultValue={String(analysis.step ?? '10u')}
              key={`step:${analysis.id}`}
              onBlur={(e) => setAnalysis({ step: e.target.value })}
            />
            <span>stop</span>
            <input
              className={field}
              defaultValue={String(analysis.stop ?? '10m')}
              key={`stop:${analysis.id}`}
              onBlur={(e) => setAnalysis({ stop: e.target.value })}
            />
            <label className="flex items-center gap-1 cursor-pointer" title="Start from zero initial conditions instead of the DC operating point">
              <input
                type="checkbox"
                checked={analysis.uic === true}
                onChange={(e) => setAnalysis({ uic: e.target.checked || undefined })}
              />
              uic
            </label>
          </div>
        )}

        <div className="flex-1" />
        <button
          className="text-[11px] text-text-faint hover:text-text-body"
          onClick={() => setShowNetlist((s) => !s)}
        >
          {showNetlist ? 'hide netlist' : 'netlist'}
        </button>
        {running ? (
          <button
            className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-surface-card border border-border-default text-status-danger text-xs"
            onClick={cancel}
          >
            <Square size={11} /> Cancel
          </button>
        ) : (
          <button
            className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-brand text-white text-xs font-medium hover:bg-brand/90"
            onClick={() => void run()}
          >
            <Play size={11} /> Run
          </button>
        )}
        <button
          className="w-7 h-7 flex items-center justify-center rounded text-text-faint hover:text-text-body"
          onClick={onClose}
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* body: results / errors / netlist */}
      <div className="flex-1 min-h-0 overflow-auto p-3 text-xs flex flex-col gap-2">
        {running && (
          <div className="flex items-center gap-2 text-text-muted">
            <Loader2 size={13} className="animate-spin" /> running… first run loads the engine
            (~a few MB)
          </div>
        )}

        {error && (
          <div className="rounded-md border border-status-danger/40 bg-status-danger/5 p-2 text-status-danger">
            <div className="font-medium">{error.message}</div>
            {error.details && error.details.length > 1 && (
              <pre className="mt-1 whitespace-pre-wrap text-[10px] opacity-80">
                {error.details.slice(0, 8).join('\n')}
              </pre>
            )}
          </div>
        )}

        {gen && (gen.warnings.length > 0 || gen.excluded.length > 0) && (
          <div className="rounded-md border border-status-warning/40 bg-status-warning/5 p-2 text-status-warning">
            {gen.warnings.slice(0, 6).map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}

        {isOp && result && <OpTable run={result} describe={describe} />}
        {result && result.numPoints > 1 && (
          <WavePlot
            run={result}
            hidden={hidden}
            onToggle={(name) =>
              setHidden((h) => {
                const next = new Set(h)
                if (next.has(name)) next.delete(name)
                else next.add(name)
                return next
              })
            }
          />
        )}

        {showNetlist && gen && (
          <pre className="rounded-md border border-border-default bg-bg-sunken p-2 text-[10px] leading-relaxed text-text-body whitespace-pre-wrap">
            {gen.netlist}
          </pre>
        )}

        {!running && !result && !error && (
          <div className="text-text-faint">
            Run a DC operating point to annotate the schematic with node voltages, or a transient
            to plot waveforms. Boards aren&apos;t simulated — drive their pins with sources from
            the palette.
          </div>
        )}
      </div>
    </div>
  )
}

// ── DC table ─────────────────────────────────────────────────────────────────

export function fmtSI(v: number, unit: string): string {
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)} M${unit}`
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)} k${unit}`
  if (a >= 1) return `${v.toFixed(3)} ${unit}`
  if (a >= 1e-3) return `${(v * 1e3).toFixed(2)} m${unit}`
  if (a >= 1e-6) return `${(v * 1e6).toFixed(2)} µ${unit}`
  if (a === 0) return `0 ${unit}`
  return `${(v * 1e9).toFixed(2)} n${unit}`
}

function OpTable({
  run,
  describe
}: {
  run: SimRun
  describe: (vecName: string) => string | undefined
}): React.JSX.Element {
  const rows = run.vectors
    .filter((v) => v.values.length === 1)
    .map((v) => {
      const isV = v.name.startsWith('v(')
      const unit = isV ? 'V' : 'A'
      return { name: v.name, value: fmtSI(v.values[0], unit), what: describe(v.name) }
    })
  return (
    <div className="grid grid-cols-[auto_auto_1fr] gap-x-6 gap-y-1 w-full max-w-[720px]">
      {rows.map((r) => (
        <React.Fragment key={r.name}>
          <span className="text-text-muted font-mono">{r.name}</span>
          <span className="text-text-strong font-mono">{r.value}</span>
          <span className="text-text-faint truncate" title={r.what}>
            {r.what ?? ''}
          </span>
        </React.Fragment>
      ))}
    </div>
  )
}

// ── waveform plot (inline SVG — uPlot lands with the full plotting pass) ─────

const TRACES = ['#4f9cf9', '#f36e6e', '#54c08a', '#e5b567', '#b78be5', '#5bc8c8']

function WavePlot({
  run,
  hidden,
  onToggle
}: {
  run: SimRun
  hidden: Set<string>
  onToggle: (name: string) => void
}): React.JSX.Element {
  const x =
    run.vectors.find((v) => v.type === 'time' || v.type === 'frequency') ?? run.vectors[0]
  const all = run.vectors.filter((v) => v !== x && v.name.startsWith('v('))
  const traces = all.filter((v) => !hidden.has(v.name)).slice(0, TRACES.length)
  if (!x || all.length === 0) return <div className="text-text-faint">no voltage vectors</div>

  const W = 640
  const H = 180
  const PAD = 28
  const xmin = Math.min(...x.values)
  const xmax = Math.max(...x.values)
  let ymin = traces.length ? Infinity : -1
  let ymax = traces.length ? -Infinity : 1
  for (const tr of traces)
    for (const v of tr.values) {
      ymin = Math.min(ymin, v)
      ymax = Math.max(ymax, v)
    }
  if (ymin === ymax) {
    ymin -= 1
    ymax += 1
  }
  const sx = (v: number): number => PAD + ((v - xmin) / (xmax - xmin || 1)) * (W - PAD * 2)
  const sy = (v: number): number => H - PAD - ((v - ymin) / (ymax - ymin)) * (H - PAD * 2)

  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[720px] rounded-md border border-border-default bg-bg-sunken">
        {/* axes */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--border-strong)" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--border-strong)" />
        <text x={PAD} y={PAD - 6} fontSize="9" fill="var(--text-muted)">
          {fmtSI(ymax, 'V')}
        </text>
        <text x={PAD} y={H - PAD + 12} fontSize="9" fill="var(--text-muted)">
          {fmtSI(ymin, 'V')}
        </text>
        <text x={W - PAD} y={H - PAD + 12} fontSize="9" fill="var(--text-muted)" textAnchor="end">
          {fmtSI(xmax, x.type === 'frequency' ? 'Hz' : 's')}
        </text>
        {traces.map((tr, i) => (
          <polyline
            key={tr.name}
            fill="none"
            stroke={TRACES[i]}
            strokeWidth="1.4"
            points={tr.values.map((v, k) => `${sx(x.values[k])},${sy(v)}`).join(' ')}
          />
        ))}
      </svg>
      <div className="flex gap-2 flex-wrap items-center">
        {all.map((tr) => {
          const idx = traces.indexOf(tr)
          const off = idx < 0
          return (
            <button
              key={tr.name}
              className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${
                off
                  ? 'border-border-default text-text-faint line-through'
                  : 'border-transparent text-text-muted'
              }`}
              title={off ? 'Show trace' : 'Hide trace'}
              onClick={() => onToggle(tr.name)}
            >
              <span
                className="w-3 h-0.5 inline-block"
                style={{ background: off ? 'var(--border-strong)' : TRACES[idx] }}
              />
              {tr.name}
            </button>
          )
        })}
        <span className="text-[10px] text-text-faint ml-1">click to toggle</span>
      </div>
    </div>
  )
}
