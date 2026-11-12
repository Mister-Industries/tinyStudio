/** Tests for parts/boardSymbols: the tinyCore module symbol and its header buses. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TINYCORE_PINS } from '../../../../shared/tinycorePins'
import { GRID_BB, emptyDoc } from '../core/model'
import { buildNets } from '../core/nets'
import { headerBuses, isTinyHeaderBoard, tinyCoreSymbol } from '../parts/boardSymbols'

test('headerBuses joins the repeated power pins and nothing else', () => {
  const names = TINYCORE_PINS.map((p) => p.label)
  assert.deepEqual(headerBuses(names), [
    ['GND', 'GND.2', 'GND.3'],
    ['3V3', '3V3.2']
  ])
  assert.deepEqual(headerBuses(['A0', 'D8']), [])
})

test('tinyCore symbol binds every header pin, on the major grid', () => {
  const v = tinyCoreSymbol()
  for (const p of TINYCORE_PINS) {
    const at = v.pins[p.label]
    assert.ok(at, `${p.label} is on the symbol`)
    for (const c of at)
      assert.ok(Math.abs(c / GRID_BB - Math.round(c / GRID_BB)) < 1e-9, `${p.label} on grid`)
  }
  assert.deepEqual(v.pins['GND.2'], v.pins.GND)
  assert.deepEqual(v.pins['3V3.2'], v.pins['3V3'])
  assert.ok(v.svg.includes('IO33') === false, 'on-board LED pins are not drawn')
  assert.ok(v.svg.includes('IO18'), 'GPIO numbers are printed beside pin names')
})

test('a part on GND.2 and a part on GND share a net through the header bus', () => {
  const doc = emptyDoc()
  doc.parts = [
    { id: 'U1', type: 'tinycore' },
    { id: 'R1', type: 'resistor' },
    { id: 'R2', type: 'resistor' }
  ]
  doc.wires = [
    { id: 'w1', from: 'R1:Pin 1', to: 'U1:GND', view: 'sch' },
    { id: 'w2', from: 'R2:Pin 1', to: 'U1:GND.2', view: 'sch' }
  ]
  const names = TINYCORE_PINS.map((p) => p.label)
  const net = buildNets(doc, {
    busesFor: (t) => (isTinyHeaderBoard(t) ? headerBuses(names) : undefined)
  })
  assert.equal(net.pinToNet.get('R1:Pin 1'), net.pinToNet.get('R2:Pin 1'))
})
