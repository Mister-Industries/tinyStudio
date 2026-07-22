/** Sim integration (spec §14): run ngspice-WASM (eecircuit-engine) on golden
 * netlists produced by core/netlist and assert spot values within 1%.
 * The engine is imported from node_modules at runtime (too big to bundle). */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { emptyDoc, type CircuitPart, type CircuitWire } from '../core/model'
import { buildNets } from '../core/nets'
import { generateNetlist } from '../core/netlist'

interface EngineSim {
  start: () => Promise<void>
  setNetList: (s: string) => void
  runSim: () => Promise<{
    numPoints: number
    data: { name: string; values: number[] }[]
  }>
  getError: () => string[]
}

async function makeSim(): Promise<EngineSim> {
  const href = pathToFileURL(
    join(process.cwd(), 'node_modules', 'eecircuit-engine', 'dist', 'eecircuit-engine.mjs')
  ).href
  const mod = (await import(href)) as { Simulation: new () => EngineSim }
  const sim = new mod.Simulation()
  await sim.start()
  return sim
}

let wid = 0
const wire = (from: string, to: string): CircuitWire => ({
  id: `w${++wid}`,
  from,
  to,
  view: 'sch'
})
const part = (id: string, type: string, attrs?: CircuitPart['attrs']): CircuitPart => ({
  id,
  type,
  attrs,
  sch: { x: 0, y: 0 }
})

const vec = (
  res: { data: { name: string; values: number[] }[] },
  name: string
): number[] | undefined => res.data.find((d) => d.name.toLowerCase() === name)?.values

test('engine solves the generated divider .op within 1%', async () => {
  const doc = emptyDoc()
  doc.parts = [
    part('V1', 'sim-vdc', { voltage: '5' }),
    part('R1', 'resistor', { resistance: '10k' }),
    part('R2', 'resistor', { resistance: '4.7k' })
  ]
  doc.netLabels = [
    { id: 'nl1', name: 'GND', kind: 'ground', sch: { x: 0, y: 0 } },
    { id: 'nl2', name: 'OUT', kind: 'net', sch: { x: 0, y: 0 } }
  ]
  doc.wires = [
    wire('V1:+', 'R1:Pin 0'),
    wire('R1:Pin 1', 'R2:Pin 0'),
    wire('R2:Pin 1', 'V1:-'),
    wire('nl1:1', 'V1:-'),
    wire('nl2:1', 'R1:Pin 1')
  ]
  const { netlist, warnings } = generateNetlist(doc, buildNets(doc))
  assert.equal(warnings.length, 0)

  const sim = await makeSim()
  sim.setNetList(netlist)
  const res = await sim.runSim()
  assert.equal(res.numPoints, 1)
  const out = vec(res, 'v(out)')
  assert.ok(out, `v(out) present (got: ${res.data.map((d) => d.name).join(', ')})`)
  const expected = 5 * (4.7 / 14.7)
  assert.ok(Math.abs(out![0] - expected) / expected < 0.01, `v(out)=${out![0]} ≈ ${expected}`)
})

test('engine runs a generated RC transient with sane charge curve', async () => {
  const doc = emptyDoc()
  doc.parts = [
    part('V1', 'sim-vdc', { voltage: '5' }),
    part('R1', 'resistor', { resistance: '1k' }),
    part('C1', 'capacitor-ceramic-100mil', { capacitance: '1u' })
  ]
  doc.netLabels = [
    { id: 'nl1', name: 'GND', kind: 'ground', sch: { x: 0, y: 0 } },
    { id: 'nl2', name: 'OUT', kind: 'net', sch: { x: 0, y: 0 } }
  ]
  doc.wires = [
    wire('V1:+', 'R1:Pin 0'),
    wire('R1:Pin 1', 'C1:0'),
    wire('C1:1', 'V1:-'),
    wire('nl1:1', 'V1:-'),
    wire('nl2:1', 'C1:0')
  ]
  doc.sim = { analyses: [{ id: 'a1', kind: 'tran', step: '10u', stop: '5m', uic: true }] }
  const { netlist } = generateNetlist(doc, buildNets(doc))

  const sim = await makeSim()
  sim.setNetList(netlist)
  const res = await sim.runSim()
  assert.ok(res.numPoints > 50, 'transient produced a waveform')
  const t = vec(res, 'time')!
  const out = vec(res, 'v(out)')!
  assert.ok(t && out && t.length === out.length)
  // fully charged by 5·RC = 5 ms → within 1% of 5 V at the end
  const final = out[out.length - 1]
  assert.ok(Math.abs(final - 5) / 5 < 0.01, `final=${final}`)
  // at t ≈ RC (1 ms) the cap sits near 5·(1-1/e) ≈ 3.161 V (±5% for step interp)
  const i = t.findIndex((x) => x >= 1e-3)
  const atRc = out[i]
  assert.ok(Math.abs(atRc - 3.161) / 3.161 < 0.05, `v(RC)=${atRc}`)
})

test('current probe (M4 leftover): engine reports the divider branch current', async () => {
  const doc = emptyDoc()
  doc.parts = [
    part('V1', 'sim-vdc', { voltage: '5' }),
    part('AMM1', 'sim-probe-i'),
    part('R1', 'resistor', { resistance: '10k' }),
    part('R2', 'resistor', { resistance: '4.7k' })
  ]
  doc.netLabels = [{ id: 'nl1', name: 'GND', kind: 'ground', sch: { x: 0, y: 0 } }]
  doc.wires = [
    wire('V1:+', 'AMM1:in'),
    wire('AMM1:out', 'R1:Pin 0'),
    wire('R1:Pin 1', 'R2:Pin 0'),
    wire('R2:Pin 1', 'V1:-'),
    wire('nl1:1', 'V1:-')
  ]
  const { netlist, warnings } = generateNetlist(doc, buildNets(doc))
  assert.equal(warnings.length, 0)
  assert.match(netlist, /VAMM1 \S+ \S+ DC 0/)

  const sim = await makeSim()
  sim.setNetList(netlist)
  const res = await sim.runSim()
  const i = vec(res, 'i(vamm1)')
  assert.ok(i, `i(vamm1) present (got: ${res.data.map((d) => d.name).join(', ')})`)
  // 5V across 14.7k, current flows V+ -> AMM1 -> R1 -> R2 -> V- (into V- => negative by SPICE convention)
  const expected = 5 / 14700
  assert.ok(Math.abs(Math.abs(i![0]) - expected) / expected < 0.01, `i(vamm1)=${i![0]} ≈ ±${expected}`)
})
