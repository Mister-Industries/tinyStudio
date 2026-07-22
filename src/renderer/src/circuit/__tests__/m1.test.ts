/** M1 core additions: composite mergeKey gesture collapsing, pending-junction
 * detection, and reroute application through placePart composites. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as cmd from '../core/commands'
import { emptyDoc, isPendingJunction, type CircuitDoc, type JunctionEnd } from '../core/model'
import { CircuitStore } from '../core/store'

function fixture(): CircuitDoc {
  const doc = emptyDoc()
  doc.parts = [
    { id: 'R1', type: 'resistor', bb: { x: 0, y: 0 } },
    { id: 'R2', type: 'resistor', bb: { x: 96, y: 0 } }
  ]
  doc.wires = [{ id: 'w1', from: 'R1:2', to: 'R2:1', view: 'bb', route: ['h48'] }]
  return doc
}

test('composite commands with a mergeKey collapse into one undo step', () => {
  const store = new CircuitStore(fixture())
  for (let i = 1; i <= 5; i++) {
    store.dispatch(
      cmd.composite(
        'Move 2 parts',
        [
          cmd.placePart('R1', 'bb', { x: i * 9.6, y: 0 }),
          cmd.placePart('R2', 'bb', { x: 96 + i * 9.6, y: 0 })
        ],
        'movebb:R1,R2'
      )
    )
  }
  assert.equal(store.getDoc().parts[0].bb!.x, 48)
  store.undo()
  // one undo returns to the pre-gesture doc, not the previous frame
  assert.equal(store.getDoc().parts[0].bb!.x, 0)
  assert.equal(store.getDoc().parts[1].bb!.x, 96)
  assert.equal(store.canUndo(), false)
})

test('different mergeKeys do not merge', () => {
  const store = new CircuitStore(fixture())
  store.dispatch(cmd.composite('Move', [cmd.placePart('R1', 'bb', { x: 9.6, y: 0 })], 'movebb:R1'))
  store.dispatch(cmd.composite('Move', [cmd.placePart('R2', 'bb', { x: 105.6, y: 0 })], 'movebb:R2'))
  store.undo()
  assert.equal(store.getDoc().parts[1].bb!.x, 96)
  assert.equal(store.getDoc().parts[0].bb!.x, 9.6)
  assert.equal(store.canUndo(), true)
})

test('placePart applies reroutes alongside the placement', () => {
  const store = new CircuitStore(fixture())
  store.dispatch(cmd.placePart('R1', 'bb', { x: 9.6, y: 0 }, [{ wireId: 'w1', route: ['h38.4'] }]))
  assert.deepEqual(store.getDoc().wires[0].route, ['h38.4'])
  store.undo()
  assert.deepEqual(store.getDoc().wires[0].route, ['h48'])
})

test('isPendingJunction recognizes migrated free-point endpoints only', () => {
  const pending = { wire: '', t: -1, x: 10, y: 20 } as unknown as JunctionEnd
  assert.equal(isPendingJunction(pending), true)
  assert.equal(isPendingJunction({ wire: 'w1', t: 0.5 }), false)
  assert.equal(isPendingJunction('R1:1'), false)
})

test('setWireEnds resolves a pending junction to a real {wire,t}', () => {
  const doc = fixture()
  doc.wires.push({
    id: 'w2',
    from: 'R2:2',
    to: { wire: '', t: -1, x: 48, y: 0 } as unknown as JunctionEnd,
    view: 'bb'
  })
  const store = new CircuitStore(doc)
  store.dispatch(
    cmd.composite('Resolve migrated junctions', [
      cmd.setWireEnds('w2', undefined, { wire: 'w1', t: 0.5 })
    ])
  )
  const w2 = store.getDoc().wires.find((w) => w.id === 'w2')!
  assert.deepEqual(w2.to, { wire: 'w1', t: 0.5 })
  assert.equal(isPendingJunction(w2.to), false)
})
