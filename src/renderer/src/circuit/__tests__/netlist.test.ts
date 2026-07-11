/** Golden tests for core/netlist — SPICE generation from the net model. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyDoc, type CircuitDoc, type CircuitPart, type CircuitWire } from '../core/model'
import { buildNets } from '../core/nets'
import { analysisCard, generateNetlist, spiceNum } from '../core/netlist'

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

/** V1 5V across R1(10k) → R2(4.7kΩ) to ground — the RC-divider golden. */
function divider(): CircuitDoc {
  const doc = emptyDoc()
  doc.parts = [
    part('V1', 'sim-vdc', { voltage: '5' }),
    part('R1', 'resistor', { resistance: '10k' }),
    part('R2', 'resistor', { resistance: '4.7kΩ' })
  ]
  doc.netLabels = [{ id: 'nl1', name: 'GND', kind: 'ground', sch: { x: 0, y: 0 } }]
  doc.wires = [
    wire('V1:+', 'R1:Pin 0'),
    wire('R1:Pin 1', 'R2:Pin 0'),
    wire('R2:Pin 1', 'V1:-'),
    wire('nl1:1', 'V1:-')
  ]
  return doc
}

test('voltage divider golden netlist (.op default, GND node = 0)', () => {
  const doc = divider()
  const res = generateNetlist(doc, buildNets(doc), { title: 'divider' })
  const lines = res.netlist.trim().split('\n')
  assert.equal(lines[0], '* divider')
  assert.ok(lines.includes('.op'), 'implicit .op')
  assert.equal(lines[lines.length - 1], '.end')
  // one V, two R cards; GND net is node 0
  const v = lines.find((l) => l.startsWith('VV1'))!
  const r1 = lines.find((l) => l.startsWith('RR1'))!
  const r2 = lines.find((l) => l.startsWith('RR2'))!
  assert.match(v, /^VV1 (\S+) (\S+) DC 5$/)
  assert.match(r2, /4\.7k$/)
  const [, vp, vm] = v.match(/^VV1 (\S+) (\S+) DC 5$/)!
  assert.equal(vm, '0', 'V- rides the GND net')
  assert.ok(r1.includes(` ${vp} `) || r1.startsWith(`RR1 ${vp} `), 'R1 shares the V+ node')
  assert.equal(res.warnings.length, 0)
  assert.equal(res.excluded.length, 0)
})

test('named net labels become node names; analyses cards from sim config', () => {
  const doc = divider()
  doc.netLabels!.push({ id: 'nl2', name: 'OUT', kind: 'net', sch: { x: 0, y: 0 } })
  doc.wires.push(wire('nl2:1', 'R1:Pin 1'))
  doc.sim = { analyses: [{ id: 'a1', kind: 'tran', step: '1u', stop: '5m' }] }
  const res = generateNetlist(doc, buildNets(doc))
  assert.match(res.netlist, /RR1 \S+ OUT 10k/)
  assert.ok(res.netlist.includes('.tran 1u 5m'))
  assert.ok(!res.netlist.includes('.op'), 'explicit analyses replace the default')
})

test('LED maps anode/cathode by name, model card emitted once', () => {
  const doc = emptyDoc()
  doc.parts = [
    part('V1', 'sim-vdc'),
    part('LED1', 'led-generic-5mm'),
    part('LED2', 'led-generic-5mm'),
    part('R1', 'resistor', { resistance: '220' })
  ]
  doc.netLabels = [{ id: 'nl1', name: 'GND', kind: 'ground', sch: { x: 0, y: 0 } }]
  doc.wires = [
    wire('V1:+', 'R1:Pin 0'),
    wire('R1:Pin 1', 'LED1:anode'),
    wire('LED1:cathode', 'LED2:anode'),
    wire('LED2:cathode', 'V1:-'),
    wire('nl1:1', 'V1:-')
  ]
  const res = generateNetlist(doc, buildNets(doc), { familyOf: () => 'LED' })
  const model = res.netlist.split('\n').filter((l) => l.startsWith('.model DLED'))
  assert.equal(model.length, 1, 'one model card for two LEDs')
  // anode before cathode in the D card
  const d1 = res.netlist.split('\n').find((l) => l.startsWith('DLED1'))!
  const anodeNet = res.netlist.split('\n').find((l) => l.startsWith('RR1'))!.split(' ')[2]
  assert.equal(d1.split(' ')[1], anodeNet)
})

test('unknown parts are excluded with a warning; breadboards are transparent', () => {
  const doc = divider()
  doc.parts.push(part('U1', 'mystery-module'), part('BB1', 'breadboard-half'))
  const res = generateNetlist(doc, buildNets(doc), {
    familyOf: (t) => (t.startsWith('breadboard') ? 'breadboard' : undefined)
  })
  assert.deepEqual(res.excluded, ['U1'])
  assert.ok(res.warnings.some((w) => w.includes('U1')))
  assert.ok(!res.netlist.includes('BB1'), 'breadboard emits nothing')
})

test('boards are excluded with an info; open switches drop out, closed conduct', () => {
  const doc = divider()
  doc.parts.push(
    part('U1', 'tinycore'),
    part('SW1', 'pushbutton'),
    part('SW2', 'pushbutton', { closed: 'true' })
  )
  doc.wires.push(wire('SW2:leg0', 'V1:+'), wire('SW2:leg1', 'R1:Pin 0'))
  const res = generateNetlist(doc, buildNets(doc), {
    familyOf: (t) => (t === 'tinycore' ? 'tinyStudio board' : undefined)
  })
  assert.ok(res.excluded.includes('U1'))
  assert.ok(!res.netlist.includes('RSW1'), 'open switch is out')
  assert.match(res.netlist, /RSW2 \S+ \S+ 1m/)
})

test('unconnected pins get fresh nc nodes + warnings', () => {
  const doc = emptyDoc()
  doc.parts = [part('R1', 'resistor')]
  doc.wires = []
  const res = generateNetlist(doc, buildNets(doc))
  // both pins unconnected → nothing wired, but the card still emits with nc/0
  assert.ok(res.netlist.split('\n').some((l) => l.startsWith('RR1')))
})

test('spiceNum normalization', () => {
  assert.equal(spiceNum('4.7kΩ', '1k'), '4.7k')
  assert.equal(spiceNum('10 µF', '1u'), '10u')
  assert.equal(spiceNum('1M', '1'), '1Meg')
  assert.equal(spiceNum('2m', '1'), '2m')
  assert.equal(spiceNum(47, '1'), '47')
  assert.equal(spiceNum(undefined, '5'), '5')
  assert.equal(spiceNum('100 ohm', '1'), '100')
})

test('analysisCard forms', () => {
  assert.equal(analysisCard({ id: 'a', kind: 'op' }), '.op')
  assert.equal(analysisCard({ id: 'a', kind: 'tran', step: '1u', stop: '10m' }), '.tran 1u 10m')
  assert.equal(
    analysisCard({ id: 'a', kind: 'dc', src: 'VV1', from: 0, to: 5, step: 0.1 }),
    '.dc VV1 0 5 0.1'
  )
  assert.equal(
    analysisCard({ id: 'a', kind: 'ac', points: 20, fstart: '1', fstop: '100k' }),
    '.ac dec 20 1 100k'
  )
})
