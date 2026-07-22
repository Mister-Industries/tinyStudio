/** Tests for parts/breadboard — generator geometry, buses, net integration. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GRID_BB, emptyDoc } from '../core/model'
import { buildNets } from '../core/nets'
import { BREADBOARDS, breadboardBuses, generateBreadboard, isBreadboard } from '../parts/breadboard'

test('every hole sits on a GRID_BB multiple (snap-by-first-pin keeps holes on grid)', () => {
  for (const spec of BREADBOARDS) {
    const { def } = generateBreadboard(spec)
    const pins = def.views.breadboard!.pins
    for (const [name, [x, y]] of Object.entries(pins)) {
      assert.ok(Math.abs(x / GRID_BB - Math.round(x / GRID_BB)) < 1e-9, `${spec.type} ${name} x=${x}`)
      assert.ok(Math.abs(y / GRID_BB - Math.round(y / GRID_BB)) < 1e-9, `${spec.type} ${name} y=${y}`)
    }
  }
})

test('pin counts and naming', () => {
  const { def } = generateBreadboard(BREADBOARDS[1]) // half+, 30 cols, rails
  const pins = def.views.breadboard!.pins
  assert.equal(Object.keys(pins).length, 30 * 10 + 30 * 4)
  assert.ok(pins['a1'] && pins['j30'] && pins['t+7'] && pins['b-30'])
  const mini = generateBreadboard(BREADBOARDS[0]).def.views.breadboard!.pins
  assert.equal(Object.keys(mini).length, 17 * 10)
})

test('buses: per-column banks + one bus per rail', () => {
  const buses = breadboardBuses('breadboard-half')!
  assert.equal(buses.length, 30 * 2 + 4)
  const colBus = buses.find((b) => b.includes('a5'))!
  assert.deepEqual(colBus, ['a5', 'b5', 'c5', 'd5', 'e5'])
  const railBus = buses.find((b) => b.includes('t+1'))!
  assert.equal(railBus.length, 30)
  assert.equal(breadboardBuses('resistor'), undefined)
  assert.ok(isBreadboard('breadboard-mini') && !isBreadboard('resistor'))
})

test('two pins seated in one column share a net (buses + implicit)', () => {
  const doc = emptyDoc()
  doc.parts = [
    { id: 'BB1', type: 'breadboard-half', bb: { x: 0, y: 0 } },
    { id: 'R1', type: 'resistor', bb: { x: 100, y: 100 } },
    { id: 'LED1', type: 'led', bb: { x: 200, y: 100 } }
  ]
  const nets = buildNets(doc, {
    busesFor: breadboardBuses,
    implicit: [
      ['R1:2', 'BB1:a5'],
      ['LED1:anode', 'BB1:e5'] // same column, different row → same bus
    ]
  })
  const r = nets.pinToNet.get('R1:2')
  const l = nets.pinToNet.get('LED1:anode')
  assert.ok(r != null && l != null)
  assert.equal(r, l)
  // rails span the board
  const nets2 = buildNets(doc, {
    busesFor: breadboardBuses,
    implicit: [
      ['R1:2', 'BB1:t+1'],
      ['LED1:anode', 'BB1:t+30']
    ]
  })
  assert.equal(nets2.pinToNet.get('R1:2'), nets2.pinToNet.get('LED1:anode'))
})
