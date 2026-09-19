/**
 * circuit/views/sim/SimPanel: the Simulate panel (spec §10.4).
 *
 * Lives in the shell's right rail (schematic view only). Analysis tabs
 * (DC op / DC sweep / Transient / AC), their parameters, the OUTPUTS the user
 * wants reported, and Run/Cancel. DC (.op) lists node voltages and source
 * currents; the shell mirrors them onto the canvas as annotations; sweeps
 * render in a uPlot chart with CSV export.
 *
 * Outputs work the way CircuitLab's do: nothing is plotted by name until you
 * say what you want. Picking one drops a PROBE TAG on the sheet (a real,
 * draggable, deletable label rather than a highlight) and doc.sim.probes is
 * the single source of truth this list reads. Probes store stable references,
 * not vector names; core/simOutputs says why.
 *
 * The engine's own lifecycle is surfaced separately from the analysis: a cold
 * start is "loading the engine", not a run that timed out. And an analysis
 * whose point count would exhaust memory is refused here, before it reaches
 * the worker; such a request would take the whole app down.
 */

import { Crosshair, Download, Loader2, Play, Square, X } from 'lucide-react'
import React from 'react'
import { Badge } from '../../../components/ui/Badge'
import * as cmd from '../../core/commands'
import type { Analysis, CircuitDoc } from '../../core/model'
import { describeNet, type NetModel } from '../../core/nets'
import { defaultAttrsFor } from '../../parts/naming'
import {
  estimatePoints,
  generateNetlist,
  mapSimIssues,
  MAX_SIM_POINTS,
  type NetlistResult,
  type SimIssueRef
} from '../../core/netlist'
import {
  availableOutputs,
  outputFilter,
  outputLabelFor,
  resolveOutputs,
  type OutputRef
} from '../../core/simOutputs'
import { diffProbeVectors, probeLabelFor } from '../../core/probes'
import type { CircuitStore } from '../../core/store'
import { getSimBackend, SimError } from '../../sim'
import type { EngineStatus, SimRun } from '../../sim'
import { fmtSI } from './format'
import { SimPlot, type PlotMode } from './Plot'
import { runToCsv } from './plotData'

const field =
  'bg-bg-sunken border border-border-default rounded px-2 py-1 text-text-strong outline-none focus:border-brand w-20 text-xs'

export interface SimState {
  run: SimRun | null
  netlist: NetlistResult | null
}

/** Watchdog for the analysis itself; the engine load has its own, longer one. */
function solveBudget(points: number): number {
  return Math.min(120_000, 20_000 + points * 20)
}

export function SimPanel({
  doc,
  netModel,
  store,
  familyOf,
  onClose,
  onResult,
  onSelectIssue,
  picking = false,
  onPickingChange,
  picked,
  onToggleOutput,
  onClearOutputs,
  variant = 'drawer'
}: {
  doc: CircuitDoc
  netModel: NetModel
  store: CircuitStore
  familyOf: (type: string) => string | undefined
  onClose: () => void
  /** surfaces the run to the shell (canvas DC annotations) */
  onResult: (s: SimState) => void
  /** clicking a part/net chip on an error asks the shell to select it */
  onSelectIssue?: (refs: SimIssueRef) => void
  /** "pick outputs by clicking the schematic" mode, owned by the shell */
  picking?: boolean
  onPickingChange?: (on: boolean) => void
  /**
   * Outputs currently picked: one per measurement tag placed on the sheet.
   * The shell owns them (they live in doc.sim.probes, which is what the canvas
   * draws), so this panel reads the list and asks for changes rather than
   * keeping a second copy that could disagree with the tags.
   */
  picked: OutputRef[]
  onToggleOutput: (ref: OutputRef) => void
  onClearOutputs: () => void
  /**
   * 'drawer':  the original bottom panel across the canvas.
   * 'rail':    a column inside the shell's right rail, so running an analysis
   *            no longer covers the circuit you're analysing.
   */
  variant?: 'drawer' | 'rail'
}): React.JSX.Element {
  const analysis: Analysis = doc.sim?.analyses?.[0] ?? { id: 'a1', kind: 'op' }
  const [running, setRunning] = React.useState(false)
  const [result, setResult] = React.useState<SimRun | null>(null)
  const [gen, setGen] = React.useState<NetlistResult | null>(null)
  const [error, setError] = React.useState<{ message: string; details?: string[] } | null>(null)
  const [showNetlist, setShowNetlist] = React.useState(false)
  const [showAllOutputs, setShowAllOutputs] = React.useState(false)
  const [autoRerun, setAutoRerun] = React.useState(false)
  const [engine, setEngine] = React.useState<EngineStatus>(() => getSimBackend().status())

  // engine lifecycle (loading / ready / failed) is independent of any one run
  React.useEffect(() => {
    const backend = getSimBackend()
    setEngine(backend.status())
    return backend.subscribe(setEngine)
  }, [])

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

  // ── outputs (what the user wants reported) ─────────────────────────────────

  const choices = React.useMemo(
    () => availableOutputs(doc, netModel, familyOf),
    [doc, netModel, familyOf]
  )
  const resolved = React.useMemo(
    () => resolveOutputs(picked, doc, netModel, gen, familyOf),
    [picked, doc, netModel, gen, familyOf]
  )
  const pickFilter = React.useMemo(() => outputFilter(resolved), [resolved])
  const pickLabel = React.useMemo(() => outputLabelFor(resolved), [resolved])

  const runningRef = React.useRef(false)
  const points = estimatePoints(analysis)
  const tooMany = points > MAX_SIM_POINTS

  const run = async (): Promise<void> => {
    if (runningRef.current) return // one in-flight run at a time (esp. for auto-rerun)
    if (tooMany) {
      setError({
        message: `That analysis asks for about ${Math.round(points).toLocaleString()} points, more than the ${MAX_SIM_POINTS.toLocaleString()} this editor will hold in memory.`,
        details: [
          analysis.kind === 'tran'
            ? 'Raise the step, or shorten the stop time.'
            : analysis.kind === 'dc'
              ? 'Raise the step, or narrow the from/to range.'
              : 'Lower the points-per-decade, or narrow the frequency range.'
        ]
      })
      return
    }
    runningRef.current = true
    setRunning(true)
    setError(null)
    const g = generateNetlist(doc, netModel, {
      familyOf,
      // keeps SPICE and the printed schematic values in step (parts/naming)
      defaultAttrsOf: defaultAttrsFor,
      title: 'tinyStudio circuit'
    })
    setGen(g)
    try {
      const raw = await getSimBackend().run(g.netlist, solveBudget(points))
      // fold in synthetic diff-probe vectors (voltage/current probes need no
      // extra work; ngspice already reports every node and probe source)
      const diffs = diffProbeVectors(doc, netModel, g, raw)
      const r: SimRun = diffs.length ? { ...raw, vectors: [...raw.vectors, ...diffs] } : raw
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

  // auto-rerun: once enabled, every doc change re-runs the active analysis
  // after a short debounce, same "Run" path, so results and canvas DC
  // annotations refresh without a manual click.
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

  // probe labels: a placed sim-probe part's attrs.label stands in for the raw
  // v(node)/vdiff(id)/i(v<id>) vector name; a picked output's own label wins.
  const labelFor = React.useCallback(
    (vecName: string): string | undefined =>
      pickLabel(vecName) ?? (gen ? probeLabelFor(vecName, doc, netModel, gen) : undefined),
    [pickLabel, gen, doc, netModel]
  )

  // error → part/net highlight mapping: scan the engine's raw message lines for
  // the device/node names this run's netlist used, so the offending elements
  // can be selected on the canvas straight from the error.
  const issueRefs: SimIssueRef | null = React.useMemo(() => {
    if (!error || !gen) return null
    const lines = error.details?.length ? error.details : [error.message]
    const r = mapSimIssues(lines, gen)
    return r.parts.length || r.nets.length ? r : null
  }, [error, gen])

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

  const inRail = variant === 'rail'
  const loading = engine.phase === 'loading'
  const engineFailed = engine.phase === 'failed'

  return (
    <div
      className={
        inRail
          ? 'flex-1 min-h-0 flex flex-col'
          : 'absolute bottom-0 left-0 right-0 z-20 border-t border-border-default bg-bg-raised flex flex-col max-h-[45%]'
      }
    >
      {/* The simulator is shipped as-is in 0.4: say so wherever the panel opens. */}
      <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b border-border-default text-[11px] text-text-muted">
        <Badge tone="yellow">Experimental</Badge>
        <span>Simulation is experimental and results may be wrong.</span>
      </div>
      {/* controls: analysis kind and its parameters */}
      <div
        className={
          inRail
            ? 'flex flex-wrap items-center gap-2 px-3 py-2 shrink-0 border-b border-border-default'
            : 'flex items-center gap-2 px-3 h-10 shrink-0 border-b border-border-default'
        }
      >
        <div
          className={`flex rounded-md overflow-hidden tactile-bordered ${inRail ? 'w-full' : 'ml-3'}`}
        >
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
              className={`h-7 px-2.5 text-[11px] font-medium ${inRail ? 'flex-1' : ''} ${
                analysis.kind === kind
                  ? 'bg-brand/15 text-brand'
                  : 'bg-surface-card text-text-muted hover:text-text-body'
              }`}
              onClick={() =>
                setAnalysis(
                  kind === 'dc' ? { kind, src: String(analysis.src ?? sources[0] ?? '') } : { kind }
                )
              }
            >
              {label}
            </button>
          ))}
        </div>

        {analysis.kind === 'tran' && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
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
            <label
              className="flex items-center gap-1 cursor-pointer"
              title="Start from zero initial conditions instead of the DC operating point"
            >
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
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
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
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
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
            <span
              className="text-text-faint"
              title="AC needs a sine source; its amplitude sets the AC magnitude"
            >
              Hz
            </span>
          </div>
        )}

        {!inRail && <div className="flex-1" />}
        {!inRail && (
          <button
            className="w-7 h-7 flex items-center justify-center rounded text-text-faint hover:text-text-body"
            onClick={onClose}
            title="Close"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* outputs: what gets reported. Empty = everything, like a bare .op. */}
      <OutputPicker
        choices={choices}
        picked={picked}
        netModel={netModel}
        picking={picking}
        onPickingChange={onPickingChange}
        onToggle={onToggleOutput}
        onClear={onClearOutputs}
        expanded={showAllOutputs}
        onExpand={setShowAllOutputs}
      />

      {/* run row */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-border-default">
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
          auto
        </label>
        <button
          className="text-[11px] text-text-faint hover:text-text-body"
          onClick={() => setShowNetlist((s) => !s)}
        >
          {showNetlist ? 'hide netlist' : 'netlist'}
        </button>
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
        <div className="flex-1" />
        {running ? (
          <button
            className="flex items-center justify-center gap-1.5 h-7 px-3 rounded-md bg-surface-card border border-border-default text-status-danger text-xs"
            onClick={cancel}
          >
            <Square size={11} /> Cancel
          </button>
        ) : (
          <button
            className="tactile flex items-center justify-center gap-1.5 h-7 px-3 rounded-md bg-[var(--green)] [--_edge:var(--green-deep)] text-white text-xs font-medium disabled:opacity-50"
            onClick={() => void run()}
            disabled={tooMany || engineFailed}
            title={
              tooMany
                ? 'This analysis asks for too many points; adjust the step or range'
                : engineFailed
                  ? engine.error
                  : 'Run the selected analysis'
            }
          >
            <Play size={11} /> Run
          </button>
        )}
      </div>

      {/* body: results / errors / netlist */}
      <div className="flex-1 min-h-0 overflow-auto p-3 text-xs flex flex-col gap-2">
        {running && (
          <div className="flex items-start gap-2 text-text-muted">
            <Loader2 size={13} className="animate-spin mt-px shrink-0" />
            <span>
              {loading
                ? 'loading the SPICE engine (about 20 MB, once per session)'
                : `solving${points > 1 ? ` ${Math.round(points).toLocaleString()} points` : ''}…`}
            </span>
          </div>
        )}

        {!running && engineFailed && (
          <div className="rounded-md border border-status-danger/40 bg-status-danger/5 p-2 text-status-danger">
            <div className="font-medium">The simulation engine could not start.</div>
            <div className="mt-0.5 opacity-80">{engine.error}</div>
          </div>
        )}

        {!running && tooMany && (
          <div className="rounded-md border border-status-warning/40 bg-status-warning/5 p-2 text-status-warning">
            About {Math.round(points).toLocaleString()} points, over the{' '}
            {MAX_SIM_POINTS.toLocaleString()} limit. Raise the step or shorten the range.
          </div>
        )}

        {error && (
          <div className="rounded-md border border-status-danger/40 bg-status-danger/5 p-2 text-status-danger">
            <div className="font-medium">{error.message}</div>
            {error.details && error.details.length > 0 && (
              <pre className="mt-1 whitespace-pre-wrap text-[10px] opacity-80">
                {error.details.slice(0, 8).join('\n')}
              </pre>
            )}
            {issueRefs && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="text-[10px] opacity-70">select:</span>
                {issueRefs.parts.map((id) => (
                  <button
                    key={id}
                    className="px-1.5 py-0.5 rounded bg-status-danger/10 hover:bg-status-danger/20 text-[10px] font-mono text-status-danger"
                    onClick={() => onSelectIssue?.({ parts: [id], nets: [] })}
                  >
                    {id}
                  </button>
                ))}
                {issueRefs.nets.map((i) => (
                  <button
                    key={`n${i}`}
                    className="px-1.5 py-0.5 rounded bg-status-danger/10 hover:bg-status-danger/20 text-[10px] text-status-danger"
                    onClick={() => onSelectIssue?.({ parts: [], nets: [i] })}
                    title={describeNet(netModel, i)}
                  >
                    net {i}
                  </button>
                ))}
                {(issueRefs.parts.length > 1 || issueRefs.nets.length > 0) && (
                  <button
                    className="px-1.5 py-0.5 rounded bg-status-danger/15 hover:bg-status-danger/25 text-[10px] font-medium text-status-danger"
                    onClick={() => onSelectIssue?.(issueRefs)}
                  >
                    select all
                  </button>
                )}
              </div>
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

        {isOp && result && (
          <OpTable run={result} describe={describe} labelFor={labelFor} pick={pickFilter} />
        )}
        {result && result.numPoints > 1 && (
          <SimPlot
            run={result}
            mode={(analysis.kind === 'op' ? 'tran' : analysis.kind) as PlotMode}
            labelFor={labelFor}
            pick={pickFilter}
          />
        )}

        {showNetlist && gen && (
          <pre className="rounded-md border border-border-default bg-bg-sunken p-2 text-[10px] leading-relaxed text-text-body whitespace-pre-wrap">
            {gen.netlist}
          </pre>
        )}

        {!running && !result && !error && !engineFailed && (
          <div className="text-text-faint">
            Pick the points you want to measure, then Run. A DC operating point annotates the
            schematic with node voltages; a transient plots them over time. Boards aren&apos;t
            simulated; drive their pins with sources from the palette.
          </div>
        )}
      </div>
    </div>
  )
}

// ── outputs ──────────────────────────────────────────────────────────────────

function OutputPicker({
  choices,
  picked,
  netModel,
  picking,
  onPickingChange,
  onToggle,
  onClear,
  expanded,
  onExpand
}: {
  choices: ReturnType<typeof availableOutputs>
  picked: OutputRef[]
  netModel: NetModel
  picking: boolean
  onPickingChange?: (on: boolean) => void
  onToggle: (ref: OutputRef) => void
  onClear: () => void
  expanded: boolean
  onExpand: (v: boolean) => void
}): React.JSX.Element {
  const byRef = new Map(choices.map((c) => [c.ref, c]))
  return (
    <div className="shrink-0 border-b border-border-default px-3 py-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-text-body">Outputs</span>
        <span className="text-[10px] text-text-faint">
          {picked.length ? `${picked.length} picked` : 'all nodes'}
        </span>
        <div className="flex-1" />
        {picked.length > 0 && (
          <button className="text-[10px] text-text-faint hover:text-text-body" onClick={onClear}>
            clear
          </button>
        )}
        <button
          className={`flex items-center gap-1 h-6 px-1.5 rounded text-[10px] border ${
            picking
              ? 'border-brand text-brand bg-brand/10'
              : 'border-border-default text-text-muted hover:text-text-body'
          }`}
          onClick={() => onPickingChange?.(!picking)}
          title="Click nodes on the schematic to add them as outputs"
        >
          <Crosshair size={11} /> {picking ? 'picking…' : 'pick'}
        </button>
      </div>

      {picking && (
        <div className="text-[10px] text-brand">
          Click a wire or a pin to drop a probe tag there. Drag a tag to move it, drop it on another
          wire to re-anchor it, or use its × to remove it.
        </div>
      )}

      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {picked.map((ref) => {
            const c = byRef.get(ref)
            return (
              <button
                key={ref}
                className="group flex items-center gap-1 px-1.5 h-5 rounded-full bg-brand/12 border border-brand/40 text-[10px] text-brand"
                title={c?.detail ?? 'no longer in the circuit'}
                onClick={() => onToggle(ref)}
              >
                {c?.label ?? ref}
                <X size={9} className="opacity-60 group-hover:opacity-100" />
              </button>
            )
          })}
        </div>
      )}

      <button
        className="self-start text-[10px] text-text-faint hover:text-text-body"
        onClick={() => onExpand(!expanded)}
      >
        {expanded ? 'hide' : `all signals (${choices.length})`}
      </button>

      {expanded && (
        <div className="max-h-40 overflow-auto rounded border border-border-default bg-bg-sunken p-1 flex flex-col">
          {choices.length === 0 && (
            <span className="text-[10px] text-text-faint px-1 py-1">
              Nothing to measure yet. Wire up a couple of parts.
            </span>
          )}
          {choices.map((c) => (
            <label
              key={c.ref}
              className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-bg text-[11px] cursor-pointer"
              title={c.netIndex != null ? describeNet(netModel, c.netIndex) : c.detail}
            >
              <input
                type="checkbox"
                checked={picked.includes(c.ref)}
                onChange={() => onToggle(c.ref)}
              />
              <span className="text-text-body truncate">{c.label}</span>
              <span className="ml-auto text-[9px] text-text-faint uppercase">
                {c.kind === 'i' ? 'A' : 'V'}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── DC table ─────────────────────────────────────────────────────────────────

function OpTable({
  run,
  describe,
  labelFor,
  pick
}: {
  run: SimRun
  describe: (vecName: string) => string | undefined
  labelFor?: (vecName: string) => string | undefined
  pick?: (vecName: string) => boolean
}): React.JSX.Element {
  const rows = run.vectors
    .filter((v) => v.values.length === 1)
    .filter((v) => (pick ? pick(v.name) : true))
    .map((v) => {
      const isV = v.name.startsWith('v(') || v.name.startsWith('vdiff(')
      const unit = isV ? 'V' : 'A'
      const label = labelFor?.(v.name)
      return {
        name: label ? `${label} (${v.name})` : v.name,
        value: fmtSI(v.values[0], unit),
        what: describe(v.name)
      }
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
