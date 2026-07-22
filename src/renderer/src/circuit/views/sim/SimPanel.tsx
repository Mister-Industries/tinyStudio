/**
 * circuit/views/sim/SimPanel — the M4 Simulate panel (spec §10.4, first cut).
 *
 * Docked at the bottom of the circuit area: analysis tabs (DC op / DC sweep /
 * Transient / AC), parameters, Run/Cancel, results. DC (.op) lists node
 * voltages and source currents — and the shell mirrors them onto the canvas
 * as annotations; sweeps render in a uPlot chart (cursors, drag-zoom,
 * legend-toggle) with CSV export.
 *
 * Analysis config persists in doc.sim via Commands (undoable, serialized).
 */

import { CircuitBoard, Download, Loader2, Play, Square, X } from 'lucide-react'
import React from 'react'
import * as cmd from '../../core/commands'
import type { Analysis, CircuitDoc } from '../../core/model'
import type { NetModel } from '../../core/nets'
import { generateNetlist, type NetlistResult } from '../../core/netlist'
import type { CircuitStore } from '../../core/store'
import { getSimBackend, SimError } from '../../sim'
import type { SimRun } from '../../sim'
import { runToCsv, SimPlot, type PlotMode } from './Plot'

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
  const [autoRerun, setAutoRerun] = React.useState(false)

  const setAnalysis = (patch: Partial<Analysis>): void => {
    store.dispatch(cmd.setAnalyses([{ ...analysis, ...patch }]))
  }

  // sweepable sources, named the way the netlist emits them (VV1, II1…)
  const sources = React.useMemo(
    () =>
      doc.parts
        .map((p) => {
          const key = `${p.type} ${familyOf(p.type) ?? ''}`
          if (/sim-vdc|voltage source|battery|sim-vsin|sine|waveform/i.test(key)) return `V${p.id}`
          if (/sim-idc|current source/i.test(key)) return `I${p.id}`
          return null
        })
        .filter((n): n is string => n !== null),
    [doc.parts, familyOf]
  )

  const runningRef = React.useRef(false)

  const run = async (): Promise<void> => {
    if (runningRef.current) return // one in-flight run at a time (esp. for auto-rerun)
    runningRef.current = true
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
      runningRef.current = false
      setRunning(false)
    }
  }

  const cancel = (): void => {
    getSimBackend().cancel()
    runningRef.current = false
    setRunning(false)
  }

  // auto-rerun (spec/M4 leftover): once enabled, every doc change re-runs the
  // active analysis after a short debounce — same "Run" path, so results and
  // canvas DC annotations refresh without a manual click. Skipped while a run
  // is already in flight; the trailing edit still gets its own debounce timer.
  const runRef = React.useRef(run)
  runRef.current = run
  const lastAutoDoc = React.useRef(doc)
  React.useEffect(() => {
    if (!autoRerun || doc === lastAutoDoc.current) return
    lastAutoDoc.current = doc
    const t = setTimeout(() => void runRef.current(), 400)
    return () => clearTimeout(t)
  }, [doc, autoRerun])

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
              ['dc', 'Sweep'],
              ['tran', 'Transient'],
              ['ac', 'AC']
            ] as [Analysis['kind'], string][]
          ).map(([kind, label]) => (
            <button
              key={kind}
              className={`h-7 px-2.5 text-[11px] font-medium ${
                analysis.kind === kind
                  ? 'bg-brand/15 text-brand'
                  : 'bg-surface-card text-text-muted hover:text-text-body'
              }`}
              onClick={() =>
                setAnalysis(
                  kind === 'dc'
                    ? { kind, src: String(analysis.src ?? sources[0] ?? '') }
                    : { kind }
                )
              }
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

        {analysis.kind === 'dc' && (
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span>source</span>
            <select
              className={`${field} w-24`}
              value={String(analysis.src ?? sources[0] ?? '')}
              onChange={(e) => setAnalysis({ src: e.target.value })}
            >
              {sources.length === 0 && <option value="">no sources</option>}
              {sources.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>from</span>
            <input
              className={field}
              defaultValue={String(analysis.from ?? '0')}
              key={`from:${analysis.id}`}
              onBlur={(e) => setAnalysis({ from: e.target.value })}
            />
            <span>to</span>
            <input
              className={field}
              defaultValue={String(analysis.to ?? '5')}
              key={`to:${analysis.id}`}
              onBlur={(e) => setAnalysis({ to: e.target.value })}
            />
            <span>step</span>
            <input
              className={field}
              defaultValue={String(analysis.step ?? '0.1')}
              key={`dcstep:${analysis.id}`}
              onBlur={(e) => setAnalysis({ step: e.target.value })}
            />
          </div>
        )}

        {analysis.kind === 'ac' && (
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <select
              className={`${field} w-16`}
              value={String(analysis.variation ?? 'dec')}
              onChange={(e) => setAnalysis({ variation: e.target.value })}
            >
              {['dec', 'oct', 'lin'].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <span>pts</span>
            <input
              className={`${field} w-12`}
              defaultValue={String(analysis.points ?? '20')}
              key={`pts:${analysis.id}`}
              onBlur={(e) => setAnalysis({ points: e.target.value })}
            />
            <span>from</span>
            <input
              className={field}
              defaultValue={String(analysis.fstart ?? '1')}
              key={`fstart:${analysis.id}`}
              onBlur={(e) => setAnalysis({ fstart: e.target.value })}
            />
            <span>to</span>
            <input
              className={field}
              defaultValue={String(analysis.fstop ?? '1Meg')}
              key={`fstop:${analysis.id}`}
              onBlur={(e) => setAnalysis({ fstop: e.target.value })}
            />
            <span className="text-text-faint" title="AC needs a sine source — its amplitude sets the AC magnitude">
              Hz
            </span>
          </div>
        )}

        <div className="flex-1" />
        <label
          className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer select-none"
          title="Automatically re-run the active analysis after each edit"
        >
          <input
            type="checkbox"
            checked={autoRerun}
            onChange={(e) => {
              const on = e.target.checked
              setAutoRerun(on)
              lastAutoDoc.current = doc
              if (on) void run()
            }}
          />
          auto-rerun
        </label>
        {result && result.numPoints > 1 && (
          <button
            className="flex items-center gap-1 text-[11px] text-text-faint hover:text-text-body"
            title="Download results as CSV"
            onClick={() => {
              const blob = new Blob([runToCsv(result)], { type: 'text/csv' })
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = 'simulation.csv'
              a.click()
              URL.revokeObjectURL(a.href)
            }}
          >
            <Download size={11} /> CSV
          </button>
        )}
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
          <SimPlot run={result} mode={(analysis.kind === 'op' ? 'tran' : analysis.kind) as PlotMode} />
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
