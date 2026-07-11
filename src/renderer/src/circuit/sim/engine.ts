/**
 * circuit/sim/engine — the worker-hosted SPICE backend (M4, spec §10.1).
 *
 * Wraps simWorker.ts with a typed request/response protocol, a watchdog
 * (default 10 s — WASM ngspice can spin on non-convergence), and cancellation
 * by terminate+respawn (ngspice has no reentrant abort). The first run pays
 * the engine download/compile; the instance is reused after that.
 */

import SimWorker from './simWorker?worker'
import { SimError, type SimBackend, type SimFailure, type SimRun } from './backend'

interface Pending {
  resolve: (r: SimRun) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class SpiceWorkerBackend implements SimBackend {
  private worker: Worker | null = null
  private pending = new Map<number, Pending>()
  private seq = 0

  private spawn(): Worker {
    if (this.worker) return this.worker
    const w: Worker = new SimWorker()
    w.onmessage = (
      e: MessageEvent<{ id: number; ok: boolean; result?: SimRun; error?: SimFailure }>
    ): void => {
      const p = this.pending.get(e.data.id)
      if (!p) return
      this.pending.delete(e.data.id)
      clearTimeout(p.timer)
      if (e.data.ok && e.data.result) p.resolve(e.data.result)
      else p.reject(new SimError(e.data.error ?? { message: 'simulation failed' }))
    }
    w.onerror = (e): void => {
      this.failAll(new SimError({ message: e.message || 'simulation worker crashed' }))
      this.worker = null
      w.terminate()
    }
    this.worker = w
    return w
  }

  run(netlist: string, timeoutMs = 10000): Promise<SimRun> {
    const id = ++this.seq
    const w = this.spawn()
    return new Promise<SimRun>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.cancel() // engine may be stuck in WASM — replace it
        reject(new SimError({ message: `simulation timed out after ${timeoutMs / 1000}s` }))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      w.postMessage({ id, netlist })
    })
  }

  cancel(): void {
    this.failAll(new SimError({ message: 'simulation cancelled' }))
    this.worker?.terminate()
    this.worker = null // respawned lazily on the next run
  }

  dispose(): void {
    this.cancel()
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }
}

let shared: SimBackend | null = null

/** App-wide backend instance (the engine is heavy — share it across tabs). */
export function getSimBackend(): SimBackend {
  if (!shared) shared = new SpiceWorkerBackend()
  return shared
}
