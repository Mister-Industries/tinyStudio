/**
 * circuit/views/sim/useLiveOp: keep a DC operating point solved while
 * Simulate is open, so the circuit visibly responds to every change.
 *
 * Wokwi and CircuitLab both feel "alive" because flipping a switch shows its
 * effect at once. Here every edit (a button press, a pin set HIGH, a value
 * changed) re-solves `.op` in the background and hands back node voltages,
 * which drive the LEDs' glow and the voltage chips in both views. It is
 * independent of the analysis the panel runs: a Time Domain plot doesn't stop
 * the breadboard from lighting up.
 *
 * Runs are sequenced: a result that arrives after a newer edit is dropped.
 */

import React from 'react'
import type { CircuitDoc } from '../../core/model'
import { generateNetlist, type NetlistResult } from '../../core/netlist'
import type { NetModel } from '../../core/nets'
import { defaultAttrsFor } from '../../parts/naming'
import { getSimBackend, type SimRun } from '../../sim'

export interface LiveOp {
  gen: NetlistResult
  run: SimRun
}

/** short debounce: presses feel instant, a drag doesn't queue 60 solves */
const DEBOUNCE_MS = 80
/** an operating point is quick; anything slower is a circuit that won't converge */
const OP_TIMEOUT_MS = 8000

/** The doc as an .op run: same circuit, the panel's analyses swapped out. */
export function asOperatingPoint(doc: CircuitDoc): CircuitDoc {
  return { ...doc, sim: { ...doc.sim, analyses: [{ id: 'live', kind: 'op' }] } }
}

export function useLiveOp(
  doc: CircuitDoc,
  netModel: NetModel,
  enabled: boolean,
  familyOf: (type: string) => string | undefined
): { live: LiveOp | null; error: string | null } {
  const [live, setLive] = React.useState<LiveOp | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const seq = React.useRef(0)
  const familyRef = React.useRef(familyOf)
  familyRef.current = familyOf

  React.useEffect(() => {
    const mine = ++seq.current
    if (!enabled) {
      setLive(null)
      setError(null)
      return
    }
    const t = setTimeout(() => {
      // nothing to solve yet: no parts, or nothing SPICE understands
      if (!doc.parts.length) return
      const gen = generateNetlist(asOperatingPoint(doc), netModel, {
        familyOf: (type) => familyRef.current(type),
        defaultAttrsOf: defaultAttrsFor,
        title: 'tinyStudio live'
      })
      getSimBackend()
        .run(gen.netlist, OP_TIMEOUT_MS)
        .then((run) => {
          if (seq.current !== mine) return
          setLive({ gen, run })
          setError(null)
        })
        .catch((e: unknown) => {
          if (seq.current !== mine) return
          setLive(null)
          setError(e instanceof Error ? e.message : String(e))
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [doc, netModel, enabled])

  return { live, error }
}
