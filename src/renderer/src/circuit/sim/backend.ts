/**
 * circuit/sim/backend: the SimBackend abstraction (M4, spec §10.1/§10.6).
 *
 * Engine-agnostic on purpose: today's implementation is ngspice-WASM
 * (eecircuit-engine) in a Web Worker; the M4 bake-off may swap in tscircuit's
 * build, and the future tinyservice MCU co-sim backend implements the same
 * interface. Nothing outside sim/ may assume "SPICE only".
 *
 * The engine is ~20 MB of WASM that has to download, compile and instantiate
 * before the first analysis can run. That load is modelled explicitly here
 * (`warmup` + `subscribe`) so the UI can show honest progress instead of
 * letting a run's watchdog fire while the engine is still booting; the old
 * behaviour, which read as "simulation timed out" on every cold start.
 */

export interface SimVector {
  name: string
  type: 'voltage' | 'current' | 'time' | 'frequency' | 'notype'
  values: number[]
  /** present for complex (AC) results */
  imag?: number[]
}

export interface SimRun {
  header: string
  numPoints: number
  vectors: SimVector[]
}

export interface SimFailure {
  message: string
  details?: string[]
}

export class SimError extends Error {
  details?: string[]
  constructor(f: SimFailure) {
    super(f.message)
    this.details = f.details
  }
}

/** Lifecycle of the engine itself, independent of any one analysis. */
export type EnginePhase = 'cold' | 'loading' | 'ready' | 'running' | 'failed'

export interface EngineStatus {
  phase: EnginePhase
  /** short human line for the panel ("loading the SPICE engine…") */
  message: string
  /** set on 'failed' */
  error?: string
}

export interface SimBackend {
  /**
   * Download/compile/instantiate the engine without running anything. Safe to
   * call repeatedly; concurrent callers share one in-flight load. Resolves
   * when the engine is ready; rejects (once) if it can't be loaded.
   */
  warmup(): Promise<void>
  /** Run a netlist; resolves with vectors or rejects with SimError. The
   * timeout covers the analysis only; engine load is waited out separately. */
  run(netlist: string, timeoutMs?: number): Promise<SimRun>
  /** Abort the in-flight run (terminates + respawns the engine). */
  cancel(): void
  /** Current engine lifecycle state. */
  status(): EngineStatus
  /** Observe engine lifecycle changes; returns an unsubscribe function. */
  subscribe(fn: (s: EngineStatus) => void): () => void
  dispose(): void
}

/** Find `v(<node>)` in a result set (ngspice lowercases vector names). */
export function voltageOf(run: SimRun, node: string): SimVector | undefined {
  const key = `v(${node.toLowerCase()})`
  return run.vectors.find((v) => v.name.toLowerCase() === key)
}
