/**
 * circuit/core/nets tests — DSU nets across views, buses, junction identity
 * (B9), net labels, dangling detection.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildNets, danglingJunctions } from '../core/nets'
import { emptyDoc, type CircuitDoc } from '../core/model'

function doc(partial: Partial<CircuitDoc>): CircuitDoc {
  return { ...emptyDoc(), ...partial }
}

test('wires merge pins into one net; views share the net model', () => {
  const d = doc({
    parts: [
      { id: 'R1', type: 'resistor', bb: { x: 0, y: 0 } },
      { id: 'LED1', type: 'led', bb: { x: 50, y: 0 } }
    ],
    wires: [
      { id: 'w1', from: 'R1:2', to: 'LED1:anode', view: 'bb' },
      { id: 'w2', from: 'R1:2', to: 'LED1:anode', view: 'sch' } // same net drawn in sch
    ]
  })
  const m = buildNets(d)
  assert.equal(m.meaningful, 1)
  assert.equal(m.pinToNet.get('R1:2'), m.pinToNet.get('LED1:anode'))
  assert.equal(m.wireToNet.get('w1'), m.wireToNet.get('w2'))
})

test('junction endpoint joins the HOST WIRE net by identity (B9)', () => {
  const d = doc({
    wires: [
      { id: 'w1', from: 'A:1', to: 'B:1', view: 'bb' },
      { id: 'w2', from: 'C:1', to: { wire: 'w1', t: 0.5 }, view: 'bb' }
    ]
  })
  const m = buildNets(d)
  assert.equal(m.meaningful, 1)
  assert.equal(m.pinToNet.get('C:1'), m.pinToNet.get('A:1'))
})

test('buses merge internally-common pins (breadboard rows)', () => {
  const d = doc({
    parts: [{ id: 'BB1', type: 'breadboard-half', bb: { x: 0, y: 0 } }],
    wires: [
      { id: 'w1', from: 'X:1', to: 'BB1:a1', view: 'bb' },
      { id: 'w2', from: 'Y:1', to: 'BB1:e1', view: 'bb' }
    ]
  })
  const buses = (type: string): string[][] | undefined =>
    type === 'breadboard-half' ? [['a1', 'b1', 'c1', 'd1', 'e1']] : undefined
  const with_ = buildNets(d, { busesFor: buses })
  assert.equal(with_.pinToNet.get('X:1'), with_.pinToNet.get('Y:1'))
  const without = buildNets(d)
  assert.notEqual(without.pinToNet.get('X:1'), without.pinToNet.get('Y:1'))
})

test('same-named net labels merge nets and name them', () => {
  const d = doc({
    netLabels: [
      { id: 'nl1', name: 'GND', kind: 'ground', sch: { x: 0, y: 0 } },
      { id: 'nl2', name: 'GND', kind: 'ground', sch: { x: 100, y: 0 } }
    ],
    wires: [
      { id: 'w1', from: 'A:1', to: 'nl1:1', view: 'sch' },
      { id: 'w2', from: 'B:1', to: 'nl2:1', view: 'sch' }
    ]
  })
  const m = buildNets(d)
  assert.equal(m.pinToNet.get('A:1'), m.pinToNet.get('B:1'))
  const idx = m.pinToNet.get('A:1')!
  assert.equal(m.netNames[idx], 'GND')
})

test('implicit connections (drop-to-connect seam) merge nets', () => {
  const d = doc({
    wires: [{ id: 'w1', from: 'BB1:a5', to: 'LED1:anode', view: 'bb' }]
  })
  const m = buildNets(d, { implicit: [['R1:1', 'BB1:a5']] })
  assert.equal(m.pinToNet.get('R1:1'), m.pinToNet.get('LED1:anode'))
})

test('danglingJunctions finds bad hosts, cross-view refs, self-refs', () => {
  const d = doc({
    wires: [
      { id: 'w1', from: 'A:1', to: 'B:1', view: 'bb' },
      { id: 'ok', from: 'C:1', to: { wire: 'w1', t: 0.3 }, view: 'bb' },
      { id: 'gone', from: 'D:1', to: { wire: 'nope', t: 0.3 }, view: 'bb' },
      { id: 'xview', from: 'E:1', to: { wire: 'w1', t: 0.3 }, view: 'sch' },
      { id: 'selfy', from: 'F:1', to: { wire: 'selfy', t: 0.3 }, view: 'bb' }
    ]
  })
  const bad = danglingJunctions(d).sort()
  assert.deepEqual(bad, ['gone', 'selfy', 'xview'])
})

test('bare bus pins are not counted as meaningful nets', () => {
  const d = doc({ parts: [{ id: 'BB1', type: 'bb', bb: { x: 0, y: 0 } }] })
  const m = buildNets(d, { busesFor: () => [['a1', 'b1']] })
  assert.equal(m.meaningful, 0)
})
