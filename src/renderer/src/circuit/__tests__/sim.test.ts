/** Sim integration (spec §14): run ngspice-WASM (eecircuit-engine) on golden
 * netlists produced by core/netlist and assert spot values within 1%.
 * The engine is imported from node_modules at runtime (too big to bundle). */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { emptyDoc, type CircuitPart, type CircuitWire } from '../core/model'
import { buildNets } from '../core/nets'
import { generateNetlist, type NetlistResult } from '../core/netlist'
import { ledStates } from '../core/liveState'
import type { SimRun } from '../sim/backend'

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
  assert.ok(
    Math.abs(Math.abs(i![0]) - expected) / expected < 0.01,
    `i(vamm1)=${i![0]} ≈ ±${expected}`
  )
})

// ── tinyCore as a black-box microcontroller ──────────────────────────────────

const headerBus = (t: string): string[][] | undefined =>
  t === 'tinycore'
    ? [
        ['GND', 'GND.2', 'GND.3'],
        ['3V3', '3V3.2']
      ]
    : undefined

/** D9 with a 10k pull-up to 3V3 and a button to GND; D8 drives an LED through 220R. */
function tinyCoreBench(closed: boolean, d8: string, d9 = 'input'): NetlistResult {
  const doc = emptyDoc()
  doc.parts = [
    part('U1', 'tinycore', { 'mode.D8': d8, 'mode.D9': d9 }),
    part('R1', 'resistor', { resistance: '220' }),
    part('LED1', 'led-generic-5mm'),
    part('R2', 'resistor', { resistance: '10k' }),
    part('S1', 'pushbutton', { closed })
  ]
  doc.netLabels = [{ id: 'nl1', name: 'BTN', kind: 'net', sch: { x: 0, y: 0 } }]
  doc.wires = [
    wire('U1:D8', 'R1:Pin 0'),
    wire('R1:Pin 1', 'LED1:anode'),
    wire('LED1:cathode', 'U1:GND'),
    wire('U1:3V3', 'R2:Pin 0'),
    wire('R2:Pin 1', 'U1:D9'),
    wire('U1:D9', 'S1:leg0'),
    wire('S1:leg1', 'U1:GND.2'),
    wire('nl1:1', 'U1:D9')
  ]
  return generateNetlist(doc, buildNets(doc, { busesFor: headerBus }))
}

test('tinyCore: 3V3 is live and GND is ground, so a pull-up button reads HIGH, then LOW when pressed', async () => {
  const sim = await makeSim()
  for (const [closed, expect] of [
    [false, 3.3],
    [true, 0]
  ] as const) {
    const gen = tinyCoreBench(closed, 'low')
    sim.setNetList(gen.netlist)
    const res = await sim.runSim()
    const v = vec(res, 'v(btn)')?.[0]
    assert.ok(v !== undefined, gen.netlist)
    assert.ok(
      Math.abs(v - expect) < 0.05,
      `button ${closed ? 'pressed' : 'released'}: V(D9) = ${v}`
    )
  }
})

test('tinyCore: an output driven HIGH lights the LED through its resistor', async () => {
  const sim = await makeSim()
  const gen = tinyCoreBench(false, 'high')
  sim.setNetList(gen.netlist)
  const res = await sim.runSim()
  const i = vec(res, 'i(vu1_d8)')?.[0]
  assert.ok(i !== undefined, res.data.map((d) => d.name).join(', '))
  // (3.3 V - ~1.9 V LED) / (220 + 25 ohm): a few mA, flowing out of the pin
  assert.ok(Math.abs(i) > 2e-3 && Math.abs(i) < 9e-3, `LED current ${i}`)
  const off = tinyCoreBench(false, 'low')
  sim.setNetList(off.netlist)
  const dark = vec(await sim.runSim(), 'i(vu1_d8)')?.[0]
  assert.ok(dark !== undefined && Math.abs(dark) < 1e-6, `LOW pin sources no current: ${dark}`)
})

test('tinyCore: an internal pull-up holds an unconnected input at 3V3', async () => {
  const doc = emptyDoc()
  doc.parts = [
    part('U1', 'tinycore', { 'mode.D10': 'pullup' }),
    part('C1', 'capacitor-ceramic-100mil')
  ]
  doc.netLabels = [{ id: 'nl1', name: 'IN', kind: 'net', sch: { x: 0, y: 0 } }]
  doc.wires = [wire('U1:D10', 'C1:0'), wire('C1:1', 'U1:GND'), wire('nl1:1', 'U1:D10')]
  const gen = generateNetlist(doc, buildNets(doc, { busesFor: headerBus }))
  const sim = await makeSim()
  sim.setNetList(gen.netlist)
  const v = vec(await sim.runSim(), 'v(in)')?.[0]
  assert.ok(v !== undefined && Math.abs(v - 3.3) < 0.01, `V(D10) = ${v}`)
})

test('square wave source: an RC low-pass charges toward the high level within one period', async () => {
  const doc = emptyDoc()
  doc.parts = [
    part('V1', 'sim-vpulse', { low: '0', high: '3.3', frequency: '100', duty: '50' }),
    part('R1', 'resistor', { resistance: '1k' }),
    part('C1', 'capacitor-ceramic-100mil', { capacitance: '1u' })
  ]
  doc.netLabels = [
    { id: 'g', name: 'GND', kind: 'ground', sch: { x: 0, y: 0 } },
    { id: 'o', name: 'OUT', kind: 'net', sch: { x: 0, y: 0 } }
  ]
  doc.wires = [
    wire('V1:+', 'R1:Pin 0'),
    wire('R1:Pin 1', 'C1:0'),
    wire('C1:1', 'V1:-'),
    wire('g:1', 'V1:-'),
    wire('o:1', 'C1:0')
  ]
  doc.sim = { analyses: [{ id: 't', kind: 'tran', step: '20u', stop: '10m' }] }
  const gen = generateNetlist(doc, buildNets(doc))
  assert.match(gen.netlist, /PULSE\(0 3\.3 0 /)
  const sim = await makeSim()
  sim.setNetList(gen.netlist)
  const res = await sim.runSim()
  const out = vec(res, 'v(out)')!
  // tau = 1 ms; at the end of the 5 ms high half the cap is ~99% charged
  const peak = Math.max(...out)
  assert.ok(peak > 3.2 && peak <= 3.31, `peak V(out) = ${peak}`)
  assert.ok(out[0] < 0.01, 'starts discharged')
})

test('liveState: an LED current worked back from its voltage matches what ngspice drew', async () => {
  const sim = await makeSim()
  const asRun = (res: { numPoints: number; data: { name: string; values: number[] }[] }): SimRun =>
    ({
      header: '',
      numPoints: res.numPoints,
      vectors: res.data.map((d) => ({ name: d.name, type: 'voltage', values: d.values }))
    }) as SimRun
  const on = tinyCoreBench(false, 'high')
  sim.setNetList(on.netlist)
  const res = await sim.runSim()
  const drawn = Math.abs(vec(res, 'i(vu1_d8)')![0])
  const led = ledStates(on, asRun(res)).get('LED1')!
  assert.ok(Math.abs(led.amps - drawn) / drawn < 0.02, `LED ${led.amps} vs source ${drawn}`)
  assert.ok(led.glow > 0.5 && !led.over)

  const off = tinyCoreBench(false, 'low')
  sim.setNetList(off.netlist)
  const dark = ledStates(off, asRun(await sim.runSim())).get('LED1')!
  assert.equal(dark.glow, 0)
})

test('liveState: a tinyCore on-board LED is keyed by board and name', async () => {
  const doc = emptyDoc()
  doc.parts = [part('U1', 'tinycore', { 'mode.LED_SIG': 'high' })]
  const gen = generateNetlist(doc, buildNets(doc))
  const sim = await makeSim()
  sim.setNetList(gen.netlist)
  const res = await sim.runSim()
  const run = {
    header: '',
    numPoints: res.numPoints,
    vectors: res.data.map((d) => ({ name: d.name, type: 'voltage', values: d.values }))
  } as SimRun
  const states = ledStates(gen, run)
  const sig = states.get('U1:LED_SIG')
  assert.ok(sig && sig.amps > 0.5e-3 && sig.amps < 3e-3, `SIG ${sig?.amps}`)
  assert.equal(states.has('U1'), false)
})
