/**
 * circuit/sim/simWorker: ngspice-WASM in a module worker (M4).
 *
 * The engine (eecircuit-engine ≈20 MB with embedded WASM) is imported lazily
 * so opening the Circuit tab costs nothing; Vite splits it into its own chunk.
 * One Simulation instance is reused across runs; cancellation is handled by
 * the owner terminating this worker entirely.
 *
 * Two operations:
 *   { id, op: 'warm' }             → load/compile/instantiate only
 *   { id, op: 'run', netlist }     → analyse (loads first if it has to)
 * Replies: { id, ok: true, result? } | { id, ok: false, error }, plus
 * unsolicited { type: 'phase', phase } notes so the owner can drive UI.
 *
 * Every failure path posts a message. Nothing here may throw out of the
 * handler: an unhandled rejection inside a worker takes the worker down
 * without a reply, which is what left the panel spinning until its watchdog
 * fired (and, on a cold start under memory pressure, took the renderer with
 * it). `self.onerror`/`onunhandledrejection` are wired to report instead.
 */

import type { SimRun, SimVector } from './backend'

interface EngineResult {
  header: string
  numVariables: number
  variableNames: string[]
  numPoints: number
  dataType: 'real' | 'complex'
  data: {
    name: string
    type: SimVector['type']
    values: (number | { real: number; img: number })[]
  }[]
}

interface EngineSim {
  start: () => Promise<void>
  setNetList: (s: string) => void
  runSim: () => Promise<EngineResult>
  getError: () => string[]
}

let sim: EngineSim | null = null
let loading: Promise<EngineSim> | null = null
/** id of the request currently being served, so a stray error can be attributed */
let currentId: number | null = null

function post(msg: unknown): void {
  ;(self as unknown as { postMessage: (m: unknown) => void }).postMessage(msg)
}

function phase(p: 'loading' | 'ready' | 'running'): void {
  post({ type: 'phase', phase: p })
}

async function ensureEngine(): Promise<EngineSim> {
  if (sim) return sim
  if (!loading) {
    phase('loading')
    loading = (async () => {
      const mod = (await import('eecircuit-engine')) as { Simulation: new () => EngineSim }
      const s = new mod.Simulation()
      await s.start()
      sim = s
      phase('ready')
      return s
    })().catch((err) => {
      // let the next attempt retry from scratch rather than caching the failure
      loading = null
      throw err
    })
  }
  return loading
}

function convert(res: EngineResult): SimRun {
  const vectors: SimVector[] = res.data.map((d) => {
    if (res.dataType === 'complex') {
      const cx = d.values as { real: number; img: number }[]
      return {
        name: d.name,
        type: d.type,
        values: cx.map((v) => v.real),
        imag: cx.map((v) => v.img)
      }
    }
    return { name: d.name, type: d.type, values: d.values as number[] }
  })
  return { header: res.header, numPoints: res.numPoints, vectors }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message || String(err)
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

self.onmessage = async (
  e: MessageEvent<{ id: number; op?: 'warm' | 'run'; netlist?: string }>
): Promise<void> => {
  const { id, netlist } = e.data
  const op = e.data.op ?? 'run'
  currentId = id
  try {
    const engine = await ensureEngine()
    if (op === 'warm') {
      post({ id, ok: true })
      return
    }
    phase('running')
    engine.setNetList(netlist ?? '')
    const result = await engine.runSim()
    const errors = engine.getError()
    phase('ready')
    if ((!result || result.numPoints === 0) && errors.length) {
      post({ id, ok: false, error: { message: errors[0], details: errors } })
      return
    }
    post({ id, ok: true, result: convert(result) })
  } catch (err) {
    // a failed run can leave ngspice in a bad state; drop the instance so the
    // next attempt boots a clean one instead of compounding the failure
    if (op === 'run') {
      sim = null
      loading = null
    }
    post({ id, ok: false, error: { message: describe(err) } })
  } finally {
    currentId = null
  }
}

self.onerror = (event: Event | string): void => {
  const message =
    typeof event === 'string' ? event : ((event as ErrorEvent).message ?? 'simulation engine error')
  sim = null
  loading = null
  post({ id: currentId, ok: false, error: { message } })
}

self.onunhandledrejection = (event: PromiseRejectionEvent): void => {
  event.preventDefault()
  sim = null
  loading = null
  post({ id: currentId, ok: false, error: { message: describe(event.reason) } })
}
