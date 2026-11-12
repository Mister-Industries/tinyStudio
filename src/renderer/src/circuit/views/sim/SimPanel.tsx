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

import { ChevronRight, Download, FileImage, Loader2, Play, Square, X } from 'lucide-react'
import React from 'react'
import { createPortal } from 'react-dom'
import { Badge } from '../../../components/ui/Badge'
import * as cmd from '../../core/commands'
import type { Analysis, CircuitDoc } from '../../core/model'
import { describeNet, type NetModel } from '../../core/nets'
import { defaultAttrsFor } from '../../parts/naming'
import {
  ESP32S3,
  PIN_MODES,
  pinModeOf,
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
import { diffProbeVectors, probeLabelFor, traceNameFor } from '../../core/probes'
import type { CircuitStore } from '../../core/store'
import { getSimBackend, SimError } from '../../sim'
import type { EngineStatus, SimRun } from '../../sim'
import { figureSvg, type FigureWidth } from './figure'
import { fmtSI } from './format'
import type { LiveOp } from './useLiveOp'
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
  onResult,
  onSelectIssue,
  picked,
  onToggleOutput,
  onClearOutputs,
  resultsHost,
  live
}: {
  doc: CircuitDoc
  netModel: NetModel
  store: CircuitStore
  familyOf: (type: string) => string | undefined
  /** surfaces the run to the shell (canvas DC annotations) */
  onResult: (s: SimState) => void
  /** clicking a part/net chip on an error asks the shell to select it */
  onSelectIssue?: (refs: SimIssueRef) => void
  picked: OutputRef[]
  onToggleOutput: (ref: OutputRef) => void
  onClearOutputs: () => void
  /** where the results dock renders: the bottom of the canvas */
  resultsHost: HTMLElement | null
  /** the background DC solve (views/sim/useLiveOp) */
  live?: LiveOp | null
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
          if (/sim-vdc|voltage source|battery|sim-vsin|sine|waveform|sim-vpulse|square/i.test(key))
            return `V${p.id}`
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
  const pickedFilter = React.useMemo(() => outputFilter(resolved), [resolved])
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
  // with nothing picked, "all signals" means the circuit's own nets and
  // currents: a board model's internal nodes (a GPIO's driver behind its
  // output resistance) are the simulator's business, not the reader's
  const pickFilter = React.useMemo(() => {
    if (resolved.length || !gen) return pickedFilter
    const nodes = new Set(gen.nodeOfNet.map((n) => n.toLowerCase()))
    return (name: string): boolean => {
      const m = /^v\((.+)\)$/i.exec(name)
      return !m || nodes.has(m[1].toLowerCase())
    }
  }, [resolved, gen, pickedFilter])
  // the dock fits what it shows: a few rows of DC readings take a few rows of
  // screen. dockH is its ceiling, and a plot's height (drag the edge to grow)
  const [dockH, setDockH] = React.useState(240)

  // probe labels: a placed sim-probe part's attrs.label stands in for the raw
  // v(node)/vdiff(id)/i(v<id>) vector name; a picked output's own label wins.
  const labelFor = React.useCallback(
    (vecName: string): string | undefined =>
      pickLabel(vecName) ??
      (gen
        ? (probeLabelFor(vecName, doc, netModel, gen) ?? traceNameFor(vecName, doc, netModel, gen))
        : undefined),
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

  // ── tinyCore pin setup: what each connected GPIO does until firmware runs ──
  // pin readings: this panel's own DC run when there is one, else the live
  // operating point Simulate keeps solved in the background
  const opRun = gen && result && result.numPoints === 1 ? { gen, run: result } : live
  const nodeVolts = (netIdx: number | undefined): number | undefined => {
    if (netIdx === undefined || !opRun) return undefined
    const node = opRun.gen.nodeOfNet[netIdx]
    if (node === undefined) return undefined
    if (node === '0') return 0
    return opRun.run.vectors.find((v) => v.name.toLowerCase() === `v(${node.toLowerCase()})`)
      ?.values[0]
  }
  const boards = doc.parts.filter((p) => p.type === 'tinycore')
  const pinSetup = boards.length ? (
    <div className="border-b border-border-default px-3 py-2.5 flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold text-text-body">Pin setup</span>
      <span className="text-[10px] text-text-faint">
        3V3 is live and GND is ground. Set what each GPIO does until your sketch runs here.
      </span>
      {boards.map((b) => {
        const pins = [
          ...new Set(
            [...netModel.pinToNet.keys()]
              .filter((r) => r.startsWith(`${b.id}:`))
              .map((r) => r.slice(b.id.length + 1))
              .filter((p) => !/^(3V3|GND|PWR)(\.\d+)?$/i.test(p))
          )
        ].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))
        const rows = [...pins, 'LED_SIG', 'LED_BOOT']
        return rows.map((pin) => {
          const led = pin.startsWith('LED_')
          const mode = pinModeOf(b, pin)
          const v = led ? undefined : nodeVolts(netModel.pinToNet.get(`${b.id}:${pin}`))
          const isInput = mode === 'input' || mode === 'pullup' || mode === 'pulldown'
          const reads =
            v === undefined || !isInput
              ? null
              : v >= ESP32S3.vih * ESP32S3.vdd
                ? 'HIGH'
                : v <= ESP32S3.vil * ESP32S3.vdd
                  ? 'LOW'
                  : '??'
          return (
            <div key={`${b.id}:${pin}`} className="flex items-center gap-1.5 text-[11px]">
              <span
                className="w-16 shrink-0 font-mono text-text-body truncate"
                title={`${b.id}:${pin}`}
              >
                {led ? (pin === 'LED_SIG' ? 'SIG LED' : 'BOOT LED') : pin}
              </span>
              <select
                className="flex-1 min-w-0 bg-bg-sunken border border-border-default rounded px-1 py-0.5 text-[11px] text-text-strong"
                value={mode}
                onChange={(e) =>
                  store.dispatch(
                    cmd.setPartAttr(
                      b.id,
                      `mode.${pin}`,
                      e.target.value === 'input' ? undefined : e.target.value
                    )
                  )
                }
              >
                {PIN_MODES.filter(
                  (m) => !led || m.mode === 'input' || !m.mode.startsWith('pull')
                ).map((m) => (
                  <option key={m.mode} value={m.mode}>
                    {led && m.mode === 'input' ? 'Off' : m.label}
                  </option>
                ))}
              </select>
              {mode === 'pwm' && (
                <input
                  className="w-10 bg-bg-sunken border border-border-default rounded px-1 py-0.5 text-[11px]"
                  defaultValue={String(b.attrs?.[`duty.${pin}`] ?? 50)}
                  title="Duty cycle, %"
                  onBlur={(e) =>
                    store.dispatch(cmd.setPartAttr(b.id, `duty.${pin}`, e.target.value))
                  }
                />
              )}
              {v !== undefined && (
                <span
                  className={`w-14 shrink-0 text-right font-mono ${reads === 'HIGH' ? 'text-brand' : 'text-text-muted'}`}
                  title={
                    reads === '??'
                      ? 'Between the input thresholds: the pin may read either way'
                      : undefined
                  }
                >
                  {reads ?? fmtSI(v, 'V')}
                </span>
              )}
            </div>
          )
        })
      })}
    </div>
  ) : null

  const loading = engine.phase === 'loading'
  const engineFailed = engine.phase === 'failed'

  // ── parameters per analysis (CircuitLab's accordion sections) ─────────────
  const paramsFor = (kind: Analysis['kind']): React.ReactNode => {
    if (kind === 'op')
      return (
        <p className="text-[11px] text-text-muted">
          Solves the DC operating point and writes node voltages on the schematic.
        </p>
      )
    if (kind === 'tran')
      return (
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
      )
    if (kind === 'dc')
      return (
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
      )
    return (
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
    )
  }

  const SECTIONS: [Analysis['kind'], string][] = [
    ['op', 'DC'],
    ['dc', 'DC Sweep'],
    ['tran', 'Time Domain'],
    ['ac', 'Frequency Domain']
  ]

  const runButton = running ? (
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
            : 'Run this analysis'
      }
    >
      <Play size={11} /> Run {SECTIONS.find(([k]) => k === analysis.kind)?.[1]}
    </button>
  )

  // results, errors and the netlist: docked under the canvas (resultsHost)
  const body = (
    <div className="min-h-0 overflow-auto px-3 py-2 text-xs flex flex-col gap-2">
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
          height={Math.max(130, dockH - 100)}
        />
      )}
      {showNetlist && gen && (
        <pre className="rounded-md border border-border-default bg-bg-sunken p-2 text-[10px] leading-relaxed text-text-body whitespace-pre-wrap">
          {gen.netlist}
        </pre>
      )}
    </div>
  )
  const hasResults = running || !!result || !!error || engineFailed || tooMany || showNetlist

  return (
    <div className="w-[264px] shrink-0 flex flex-col border-r border-border-default bg-bg-raised min-h-0">
      <div className="h-9 shrink-0 flex items-center gap-2 px-3 border-b border-border-default">
        <span className="text-[12px] font-semibold text-text-body">Simulate</span>
        <Badge tone="yellow">Experimental</Badge>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {pinSetup}

        {/* outputs: CircuitLab style, click the schematic to measure */}
        <OutputPicker
          choices={choices}
          picked={picked}
          netModel={netModel}
          onToggle={onToggleOutput}
          onClear={onClearOutputs}
          expanded={showAllOutputs}
          onExpand={setShowAllOutputs}
        />

        {/* one section per analysis; the open one is the one Run runs */}
        {SECTIONS.map(([kind, label]) => {
          const open = analysis.kind === kind
          return (
            <div key={kind} className="border-b border-border-default">
              <button
                className={`w-full h-9 flex items-center gap-2 px-3 text-[12px] font-semibold ${
                  open ? 'text-text-strong bg-bg-sunken' : 'text-text-muted hover:text-text-body'
                }`}
                onClick={() =>
                  setAnalysis(
                    kind === 'dc'
                      ? { kind, src: String(analysis.src ?? sources[0] ?? '') }
                      : { kind }
                  )
                }
                aria-expanded={open}
              >
                <ChevronRight
                  size={13}
                  className={`transition-transform ${open ? 'rotate-90 text-brand' : ''}`}
                />
                {label}
              </button>
              {open && (
                <div className="px-3 pb-3 flex flex-col gap-2.5">
                  {paramsFor(kind)}
                  <div className="flex items-center gap-2">
                    {runButton}
                    <div className="flex-1" />
                    <button
                      className="text-[11px] text-text-faint hover:text-text-body"
                      onClick={() => setShowNetlist((v) => !v)}
                    >
                      {showNetlist ? 'hide netlist' : 'netlist'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        <div className="px-3 py-2.5 flex flex-col gap-1.5 text-[11px] text-text-muted">
          <label
            className="flex items-center gap-1.5 cursor-pointer select-none"
            title="Re-run after every change, and on every button press or pin change"
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
            Live: re-run on every change
          </label>
          {result && result.numPoints > 1 && (
            <button
              className="self-start flex items-center gap-1 text-text-faint hover:text-text-body"
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
              <Download size={11} /> Export results (CSV)
            </button>
          )}
        </div>
      </div>

      {resultsHost &&
        hasResults &&
        createPortal(
          <div
            className="relative border-t border-border-default bg-bg-raised flex flex-col"
            style={{ maxHeight: dockH }}
          >
            {/* drag the top edge to resize the results */}
            <div
              className="absolute -top-1 left-0 right-0 h-2 cursor-row-resize z-10"
              title="Drag to resize"
              onPointerDown={(e) => {
                const y0 = e.clientY
                const h0 = dockH
                const move = (ev: PointerEvent): void =>
                  setDockH(Math.min(Math.max(h0 + y0 - ev.clientY, 160), window.innerHeight - 200))
                const up = (): void => {
                  window.removeEventListener('pointermove', move)
                  window.removeEventListener('pointerup', up)
                }
                window.addEventListener('pointermove', move)
                window.addEventListener('pointerup', up)
              }}
            />
            <div className="h-8 shrink-0 flex items-center gap-2 px-3 border-b border-border-default">
              <span className="text-[12px] font-semibold text-text-body">Results</span>
              <span className="text-[11px] text-text-faint">
                {SECTIONS.find(([k]) => k === analysis.kind)?.[1]}
              </span>
              <div className="flex-1" />
              {result && result.numPoints > 1 && (
                <FigureMenu
                  make={(width) =>
                    figureSvg(result, {
                      mode: (analysis.kind === 'op' ? 'tran' : analysis.kind) as PlotMode,
                      width,
                      labelFor,
                      pick: pickFilter
                    })
                  }
                />
              )}
              <button
                className="w-6 h-6 flex items-center justify-center rounded text-text-faint hover:text-text-body"
                onClick={() => {
                  setResult(null)
                  setError(null)
                  setShowNetlist(false)
                  onResult({ run: null, netlist: null })
                }}
                title="Close results"
              >
                <X size={13} />
              </button>
            </div>
            {body}
          </div>,
          resultsHost
        )}
    </div>
  )
}

// ── figure export ────────────────────────────────────────────────────────────

const save = (blob: Blob, name: string): void => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Rasterise a figure SVG at 3x (about 300 dpi at its printed size). */
async function svgToPng(svg: string): Promise<Blob | null> {
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await img.decode()
  const k = 3
  const c = document.createElement('canvas')
  c.width = img.width * k
  c.height = img.height * k
  const g = c.getContext('2d')
  if (!g) return null
  g.scale(k, k)
  g.drawImage(img, 0, 0)
  return new Promise((res) => c.toBlob(res, 'image/png'))
}

/** Paper-ready figure downloads for the current result. */
function FigureMenu({ make }: { make: (width: FigureWidth) => string | null }): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const item = (label: string, act: () => void | Promise<void>): React.JSX.Element => (
    <button
      className="w-full text-left px-2.5 py-1.5 text-[11px] text-text-body hover:bg-bg-sunken"
      onClick={() => {
        setOpen(false)
        void act()
      }}
    >
      {label}
    </button>
  )
  const svgOf = (w: FigureWidth): void => {
    const s = make(w)
    if (s) save(new Blob([s], { type: 'image/svg+xml' }), `figure-${w}.svg`)
  }
  const pngOf = async (w: FigureWidth): Promise<void> => {
    const s = make(w)
    const b = s && (await svgToPng(s))
    if (b) save(b, `figure-${w}.png`)
  }
  return (
    <div className="relative">
      <button
        className="h-6 flex items-center gap-1 px-1.5 rounded text-[11px] text-text-faint hover:text-text-body"
        onClick={() => setOpen((v) => !v)}
        title="Download this plot as a figure for a paper or report"
      >
        <FileImage size={12} /> Figure
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onPointerDown={() => setOpen(false)} />
          <div className="absolute right-0 top-7 z-50 w-48 rounded-md border border-border-default bg-surface-card shadow-lg py-1">
            {item('SVG, single column (3.5 in)', () => svgOf('single'))}
            {item('SVG, double column (7 in)', () => svgOf('double'))}
            {item('PNG, single column', () => pngOf('single'))}
            {item('PNG, double column', () => pngOf('double'))}
          </div>
        </>
      )}
    </div>
  )
}

// ── outputs ──────────────────────────────────────────────────────────────────

function OutputPicker({
  choices,
  picked,
  netModel,
  onToggle,
  onClear,
  expanded,
  onExpand
}: {
  choices: ReturnType<typeof availableOutputs>
  picked: OutputRef[]
  netModel: NetModel
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
      </div>

      <div className="text-[10px] text-text-faint">
        Click any wire or pin on the schematic to measure it.
      </div>

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
