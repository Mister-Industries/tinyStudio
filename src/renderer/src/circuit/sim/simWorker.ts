/**
 * circuit/sim/simWorker — ngspice-WASM in a module worker (M4).
 *
 * The engine (eecircuit-engine ≈20 MB with embedded WASM) is imported lazily
 * on the first message so opening the Circuit tab costs nothing; Vite splits
 * it into its own chunk. One Simulation instance is reused across runs —
 * cancellation is handled by the owner terminating this worker entirely.
 *
 * Protocol: { id, netlist } in → { id, ok: true, result } | { id, ok: false,
 * error: { message, details } } out.
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

self.onmessage = async (e: MessageEvent<{ id: number; netlist: string }>): Promise<void> => {
  const { id, netlist } = e.data
  try {
    if (!sim) {
      const mod = (await import('eecircuit-engine')) as {
        Simulation: new () => EngineSim
      }
      sim = new mod.Simulation()
      await sim.start()
    }
    sim.setNetList(netlist)
    const result = await sim.runSim()
    const errors = sim.getError()
    if ((!result || result.numPoints === 0) && errors.length) {
      self.postMessage({ id, ok: false, error: { message: errors[0], details: errors } })
      return
    }
    self.postMessage({ id, ok: true, result: convert(result) })
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: { message: err instanceof Error ? err.message : String(err) }
    })
  }
}
