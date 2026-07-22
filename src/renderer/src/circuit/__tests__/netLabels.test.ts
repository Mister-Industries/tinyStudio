/** Tests for parts/netLabels — glyph geometry, single pin, grid snapping. */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { GRID_BB, type NetLabel } from '../core/model'
import { NET_LABEL_KINDS, netLabelPinWorld, netLabelView, snapNetLabel } from '../parts/netLabels'

const onGrid = (v: number): boolean => Math.abs(v / GRID_BB - Math.round(v / GRID_BB)) < 1e-6

test('every net-label kind renders one pin named "1"', () => {
  for (const k of NET_LABEL_KINDS) {
    const v = netLabelView(k.kind, k.name)
    assert.deepEqual(Object.keys(v.pins), ['1'])
    assert.ok(v.w > 0 && v.h > 0)
    assert.ok(v.svg.includes('<line') || v.svg.includes('<rect'))
  }
})

test('snapNetLabel lands the pin on the major grid', () => {
  for (const start of [
    { x: 103, y: 57 },
    { x: 0, y: 0 },
    { x: -41, y: 88 }
  ]) {
    const pl = snapNetLabel('ground', 'GND', start)
    const label: NetLabel = { id: 'nl1', name: 'GND', kind: 'ground', sch: pl }
    const p = netLabelPinWorld(label)
    assert.ok(onGrid(p.x) && onGrid(p.y), `pin off grid: ${p.x},${p.y}`)
  }
})

test('ground pin is at the top, power pin at the bottom', () => {
  assert.equal(netLabelView('ground', 'GND').pins['1'][1], 0)
  assert.equal(netLabelView('power', '5V').pins['1'][1], 2 * GRID_BB)
})
