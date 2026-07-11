/**
 * circuit/sim/backend — the SimBackend abstraction (M4, spec §10.1/§10.6).
 *
 * Engine-agnostic on purpose: today's implementation is ngspice-WASM
 * (eecircuit-engine) in a Web Worker; the M4 bake-off may swap in tscircuit's
 * build, and the future tinyservice MCU co-sim backend implements the same
 * interface. Nothing outside sim/ may assume "SPICE only".
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

export interface SimBackend {
  /** Run a netlist; resolves with vectors or rejects with SimError. */
  run(netlist: string, timeoutMs?: number): Promise<SimRun>
  /** Abort the in-flight run (terminates + respawns the engine). */
  cancel(): void
  dispose(): void
}

/** Find `v(<node>)` in a result set (ngspice lowercases vector names). */
export function voltageOf(run: SimRun, node: string): SimVector | undefined {
  const key = `v(${node.toLowerCase()})`
  return run.vectors.find((v) => v.name.toLowerCase() === key)
}
