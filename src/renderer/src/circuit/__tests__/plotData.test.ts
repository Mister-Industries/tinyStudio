/** Tests for views/sim/plotData: how a run is arranged for the on-screen plot. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SimRun } from '../sim'
import { plotModel, valueAt } from '../views/sim/plotData'

const tran: SimRun = {
  header: '',
  numPoints: 3,
  vectors: [
    { name: 'time', type: 'time', values: [0, 1, 2] },
    { name: 'v(a)', type: 'voltage', values: [0, 1, 2] },
    { name: 'i(v1)', type: 'current', values: [0, -1e-3, -2e-3] },
    { name: 'v(b)', type: 'voltage', values: [3, 3, 3] }
  ]
} as SimRun

test('plotModel: volts and amps go on separate stacked panels', () => {
  const m = plotModel(tran, 'tran')!
  assert.deepEqual(
    m.panels.map((p) => [p.key, p.traces.map((t) => t.label)]),
    [
      ['V', ['V(a)', 'V(b)']],
      ['A', ['I(v1)']]
    ]
  )
  // colours follow the vector, not the panel position
  assert.deepEqual(
    m.panels.map((p) => p.traces.map((t) => t.color)),
    [[0, 2], [1]]
  )
  assert.equal(m.xUnit, 's')
})

test('plotModel: a pick narrows the traces; labelFor renames them', () => {
  const m = plotModel(
    tran,
    'tran',
    (n) => (n === 'v(b)' ? 'VOUT' : undefined),
    (n) => n === 'v(b)'
  )!
  assert.deepEqual(
    m.panels.map((p) => p.traces.map((t) => t.label)),
    [['VOUT']]
  )
})

test('plotModel: AC is magnitude over phase', () => {
  const ac = {
    header: '',
    numPoints: 2,
    vectors: [
      { name: 'frequency', type: 'frequency', values: [10, 100] },
      { name: 'v(out)', type: 'voltage', values: [1, 0], imag: [0, 1] },
      { name: 'i(v1)', type: 'current', values: [1, 1], imag: [0, 0] }
    ]
  } as SimRun
  const m = plotModel(ac, 'ac')!
  assert.deepEqual(
    m.panels.map((p) => p.key),
    ['dB', 'deg']
  )
  assert.equal(m.panels[0].traces.length, 1)
  assert.ok(Math.abs(m.panels[1].traces[0].values[1] - 90) < 1e-9)
  assert.ok(m.log)
})

test('valueAt interpolates and clamps', () => {
  assert.equal(valueAt([0, 1, 2], [0, 10, 20], 1.5), 15)
  assert.equal(valueAt([0, 1, 2], [0, 10, 20], -1), 0)
  assert.equal(valueAt([0, 1, 2], [0, 10, 20], 9), 20)
})
