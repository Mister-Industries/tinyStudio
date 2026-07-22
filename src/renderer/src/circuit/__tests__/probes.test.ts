/** core/probes — sim probe recognition + diff-probe subtraction + labeling. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyDoc, type CircuitDoc, type CircuitPart, type CircuitWire } from '../core/model'
import { buildNets } from '../core/nets'
import { generateNetlist } from '../core/netlist'
import { diffProbeVector, diffProbeVectors, probeLabelFor, probesIn } from '../core/probes'
import type { SimRun } from '../sim/backend'

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

/** V1 5V across R1(10k) -> R2(4.7k) to ground, with all three probe kinds
 * wired in: AMM1 in series before R1, VP1 on the OUT node, VD1 across R2. */
function circuitWithProbes(): CircuitDoc {
  const doc = emptyDoc()
  doc.parts = [
    part('V1', 'sim-vdc', { voltage: '5' }),
    part('AMM1', 'sim-probe-i'),
    part('R1', 'resistor', { resistance: '10k' }),
    part('R2', 'resistor', { resistance: '4.7k' }),
    part('VP1', 'sim-probe-v', { label: 'Vout' }),
    part('VD1', 'sim-probe-vdiff', { label: 'Vr2' })
  ]
  doc.netLabels = [{ id: 'nl1', name: 'GND', kind: 'ground', sch: { x: 0, y: 0 } }]
  doc.wires = [
    wire('V1:+', 'AMM1:in'),
    wire('AMM1:out', 'R1:Pin 0'),
    wire('R1:Pin 1', 'R2:Pin 0'),
    wire('R2:Pin 1', 'V1:-'),
    wire('nl1:1', 'V1:-'),
    wire('VP1:+', 'R1:Pin 1'),
    wire('VD1:+', 'R2:Pin 0'),
    wire('VD1:-', 'R2:Pin 1')
  ]
  return doc
}

test('probesIn recognizes all three probe kinds and ignores everything else', () => {
  const doc = circuitWithProbes()
  const probes = probesIn(doc)
  assert.deepEqual(
    probes.map((p) => [p.part.id, p.kind]).sort(),
    [
      ['AMM1', 'current'],
      ['VD1', 'diff'],
      ['VP1', 'voltage']
    ].sort()
  )
})

test('probesIn labels fall back to the part id when attrs.label is unset', () => {
  const doc = emptyDoc()
  doc.parts = [part('P1', 'sim-probe-v')]
  assert.equal(probesIn(doc)[0].label, 'P1')
})

test('diffProbeVector subtracts the two node voltages; undefined when a pin is unwired', () => {
  const doc = circuitWithProbes()
  const net = buildNets(doc)
  const gen = generateNetlist(doc, net)
  const run: SimRun = {
    header: '',
    numPoints: 1,
    vectors: gen.nodeOfNet.map((node, i) =>
      node === '0'
        ? { name: 'v(0)', type: 'voltage' as const, values: [0] }
        : { name: `v(${node})`, type: 'voltage' as const, values: [(i + 1) * 1.5] }
    )
  }
  const vd1 = doc.parts.find((p) => p.id === 'VD1')!
  const vec = diffProbeVector(vd1, net, gen, run)
  assert.ok(vec)
  assert.equal(vec!.name, 'vdiff(VD1)')

  const orphan = part('LONER', 'sim-probe-vdiff')
  const undef = diffProbeVector(orphan, net, gen, run)
  assert.equal(undef, undefined)
})

test('diffProbeVector subtracts real and imaginary parts when the run is complex (AC)', () => {
  const doc = emptyDoc()
  doc.parts = [
    part('R1', 'resistor', { resistance: '1k' }),
    part('R2', 'resistor', { resistance: '1k' }),
    part('VD1', 'sim-probe-vdiff')
  ]
  // two disjoint nets, no GND — so neither resolves to node '0'
  doc.wires = [wire('VD1:+', 'R1:Pin 1'), wire('VD1:-', 'R2:Pin 1')]
  const net = buildNets(doc)
  const gen = generateNetlist(doc, net)
  const plusNode = gen.nodeOfNet[net.pinToNet.get('VD1:+')!]
  const minusNode = gen.nodeOfNet[net.pinToNet.get('VD1:-')!]
  assert.notEqual(plusNode, '0')
  assert.notEqual(minusNode, '0')
  assert.notEqual(plusNode, minusNode)
  const run: SimRun = {
    header: '',
    numPoints: 2,
    vectors: [
      { name: `v(${plusNode})`, type: 'voltage', values: [5, 6], imag: [1, 1.5] },
      { name: `v(${minusNode})`, type: 'voltage', values: [0.5, 0.5], imag: [0.25, 0.25] }
    ]
  }
  const vd1 = doc.parts.find((p) => p.id === 'VD1')!
  const vec = diffProbeVector(vd1, net, gen, run)
  assert.ok(vec)
  assert.deepEqual(vec!.values, [4.5, 5.5])
  assert.deepEqual(vec!.imag, [0.75, 1.25])
})

test('diffProbeVectors only returns diff-kind probes', () => {
  const doc = circuitWithProbes()
  const net = buildNets(doc)
  const gen = generateNetlist(doc, net)
  const run: SimRun = {
    header: '',
    numPoints: 1,
    vectors: gen.nodeOfNet.map((node, i) => ({
      name: node === '0' ? 'v(0)' : `v(${node})`,
      type: 'voltage' as const,
      values: [i]
    }))
  }
  const vecs = diffProbeVectors(doc, net, gen, run)
  assert.deepEqual(
    vecs.map((v) => v.name),
    ['vdiff(VD1)']
  )
})

test('probeLabelFor maps vdiff/current/voltage vector names back to a probe label', () => {
  const doc = circuitWithProbes()
  const net = buildNets(doc)
  const gen = generateNetlist(doc, net)
  assert.equal(probeLabelFor('vdiff(VD1)', doc, net, gen), 'Vr2')
  assert.equal(probeLabelFor('i(vamm1)', doc, net, gen), 'AMM1') // no label set -> id
  const outNode = gen.nodeOfNet[net.pinToNet.get('VP1:+')!]
  assert.equal(probeLabelFor(`v(${outNode})`, doc, net, gen), 'Vout')
  assert.equal(probeLabelFor('v(some-unrelated-node)', doc, net, gen), undefined)
})
