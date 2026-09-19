/**
 * circuit/sim/engine: the worker-hosted SPICE backend (M4, spec §10.1).
 *
 * Wraps simWorker.ts with a typed request/response protocol and two separate
 * clocks:
 *
 *   - the ENGINE LOAD (download + compile + instantiate ≈20 MB of WASM) has
 *     its own generous budget and its own observable phase, so a cold start
 *     reads as "loading the engine" rather than tripping an analysis watchdog
 *     and reporting a bogus timeout;
 *   - the ANALYSIS has the short watchdog; that one really does mean ngspice
 *     is spinning on a non-convergent circuit.
 *
 * Cancellation is terminate+respawn (ngspice has no reentrant abort). A worker
 * that dies on its own (OOM during the first load is the usual cause) is
 * reported through the same path and the next run respawns it, so a crash
 * costs a message instead of taking the editor down with it.
 */

import SimWorker from './simWorker?worker'
import {
  SimError,
  type EngineStatus,
  type SimBackend,
  type SimFailure,
  type SimRun
} from './backend'

interface Pending {
  resolve: (r: SimRun | undefined) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout> | null
}

type WorkerReply =
  | { type: 'phase'; phase: 'loading' | 'ready' | 'running' }
  | { id: number | null; ok: boolean; result?: SimRun; error?: SimFailure }

/** Engine load budget. Generous on purpose: a cold cache on a slow link can
 * legitimately take a minute, and killing it there only guarantees failure. */
const LOAD_TIMEOUT_MS = 180_000
/** How many times we'll respawn after an unexplained worker death before
 * telling the user the engine won't start on this machine. */
const MAX_RESPAWNS = 2

export class SpiceWorkerBackend implements SimBackend {
  private worker: Worker | null = null
  private pending = new Map<number, Pending>()
  private seq = 0
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private respawns = 0
  private state: EngineStatus = { phase: 'cold', message: 'engine not loaded yet' }
  private listeners = new Set<(s: EngineStatus) => void>()

  // ── status ────────────────────────────────────────────────────────────────

  status(): EngineStatus {
    return this.state
  }

  subscribe(fn: (s: EngineStatus) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private setStatus(next: EngineStatus): void {
    this.state = next
    for (const fn of this.listeners) {
      try {
        fn(next)
      } catch {
        /* a listener must never break the engine */
      }
    }
  }

  // ── worker plumbing ───────────────────────────────────────────────────────

  private spawn(): Worker {
    if (this.worker) return this.worker
    const w: Worker = new SimWorker()
    w.onmessage = (e: MessageEvent<WorkerReply>): void => {
      const data = e.data
      if ('type' in data && data.type === 'phase') {
        if (data.phase === 'loading')
          this.setStatus({ phase: 'loading', message: 'loading the SPICE engine (~20 MB)…' })
        else if (data.phase === 'ready') {
          this.loaded = true
          this.respawns = 0
          this.setStatus({ phase: 'ready', message: 'engine ready' })
        } else this.setStatus({ phase: 'running', message: 'solving…' })
        return
      }
      const reply = data as Exclude<WorkerReply, { type: 'phase' }>
      // a null id is a worker-level crash report; fail everything in flight
      if (reply.id == null) {
        this.onWorkerLost(reply.error?.message ?? 'the simulation engine stopped unexpectedly')
        return
      }
      const p = this.pending.get(reply.id)
      if (!p) return
      this.pending.delete(reply.id)
      if (p.timer) clearTimeout(p.timer)
      if (reply.ok) p.resolve(reply.result)
      else p.reject(new SimError(reply.error ?? { message: 'simulation failed' }))
      if (!this.pending.size && this.loaded)
        this.setStatus({ phase: 'ready', message: 'engine ready' })
    }
    w.onerror = (e): void => {
      e.preventDefault?.()
      this.onWorkerLost(e.message || 'the simulation engine stopped unexpectedly')
    }
    w.onmessageerror = (): void => {
      this.onWorkerLost('the simulation engine sent an unreadable result')
    }
    this.worker = w
    return w
  }

  /**
   * The worker died (OOM during the WASM load is the common one). Reject
   * everything waiting on it with a message the panel can show, drop the
   * instance so the next attempt starts clean, and stop retrying forever.
   */
  private onWorkerLost(message: string): void {
    this.loaded = false
    this.loadPromise = null
    const w = this.worker
    this.worker = null
    try {
      w?.terminate()
    } catch {
      /* already gone */
    }
    this.respawns++
    const exhausted = this.respawns > MAX_RESPAWNS
    const text = exhausted
      ? `${message}; it has failed to start ${this.respawns} times, so simulation is unavailable in this session`
      : message
    this.setStatus({ phase: 'failed', message: text, error: text })
    this.failAll(new SimError({ message: text }))
  }

  private send(
    msg: { op: 'warm' | 'run'; netlist?: string },
    timeoutMs: number | null
  ): Promise<SimRun | undefined> {
    const id = ++this.seq
    const w = this.spawn()
    return new Promise<SimRun | undefined>((resolve, reject) => {
      const timer =
        timeoutMs == null
          ? null
          : setTimeout(() => {
              this.pending.delete(id)
              this.cancel() // engine may be stuck in WASM; replace it
              reject(
                new SimError({
                  message:
                    msg.op === 'warm'
                      ? `the simulation engine did not finish loading after ${Math.round(timeoutMs / 1000)}s`
                      : `the analysis did not converge within ${Math.round(timeoutMs / 1000)}s. Try a coarser step, a shorter run, or check for a floating node`
                })
              )
            }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        w.postMessage({ id, ...msg })
      } catch (err) {
        this.pending.delete(id)
        if (timer) clearTimeout(timer)
        reject(new SimError({ message: (err as Error)?.message ?? 'could not reach the engine' }))
      }
    })
  }

  // ── public API ────────────────────────────────────────────────────────────

  warmup(): Promise<void> {
    if (this.loaded) return Promise.resolve()
    if (this.state.phase === 'failed' && this.respawns > MAX_RESPAWNS)
      return Promise.reject(new SimError({ message: this.state.error ?? 'engine unavailable' }))
    if (!this.loadPromise) {
      this.setStatus({ phase: 'loading', message: 'loading the SPICE engine (~20 MB)…' })
      this.loadPromise = this.send({ op: 'warm' }, LOAD_TIMEOUT_MS)
        .then(() => {
          this.loaded = true
          this.respawns = 0
          this.setStatus({ phase: 'ready', message: 'engine ready' })
        })
        .catch((err) => {
          this.loadPromise = null
          const message = err instanceof Error ? err.message : String(err)
          this.setStatus({ phase: 'failed', message, error: message })
          throw err
        })
    }
    return this.loadPromise
  }

  async run(netlist: string, timeoutMs = 20_000): Promise<SimRun> {
    // The load is waited out on its own clock; only the solve is watchdogged.
    await this.warmup()
    this.setStatus({ phase: 'running', message: 'solving…' })
    try {
      const r = await this.send({ op: 'run', netlist }, timeoutMs)
      if (!r) throw new SimError({ message: 'the engine returned no result' })
      if (this.loaded) this.setStatus({ phase: 'ready', message: 'engine ready' })
      return r
    } catch (err) {
      if (this.loaded && this.state.phase === 'running')
        this.setStatus({ phase: 'ready', message: 'engine ready' })
      throw err
    }
  }

  cancel(): void {
    this.failAll(new SimError({ message: 'simulation cancelled' }))
    try {
      this.worker?.terminate()
    } catch {
      /* already gone */
    }
    this.worker = null // respawned lazily on the next run
    this.loaded = false
    this.loadPromise = null
    if (this.state.phase !== 'failed')
      this.setStatus({ phase: 'cold', message: 'engine stopped; it will reload on the next run' })
  }

  dispose(): void {
    this.cancel()
    this.listeners.clear()
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }
}

let shared: SimBackend | null = null

/** App-wide backend instance (the engine is heavy; share it across tabs). */
export function getSimBackend(): SimBackend {
  if (!shared) shared = new SpiceWorkerBackend()
  return shared
}
