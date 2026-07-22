/**
 * circuit/core store + commands tests — undo/redo, drag merging, cascades,
 * duplicate-wire guard (B5), rename rewrites (B4-adjacent), echo guard.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  addPart,
  addWire,
  composite,
  deleteParts,
  deleteWires,
  placePart,
  renamePart,
  setPartAttr
} from '../core/commands'
import { emptyDoc } from '../core/model'
import { nextRefdes, prefixForFamily } from '../core/refdes'
import { CircuitStore } from '../core/store'

function freshStore(): CircuitStore {
  return new CircuitStore(emptyDoc('test'))
}

test('dispatch/undo/redo round-trip', () => {
  const s = freshStore()
  s.dispatch(addPart({ id: 'R1', type: 'resistor', bb: { x: 0, y: 0 } }))
  assert.equal(s.getDoc().parts.length, 1)
  assert.ok(s.canUndo())
  s.undo()
  assert.equal(s.getDoc().parts.length, 0)
  assert.ok(s.canRedo())
  s.redo()
  assert.equal(s.getDoc().parts.length, 1)
})

test('merge-key drags collapse into ONE undo step', () => {
  const s = freshStore()
  s.dispatch(addPart({ id: 'R1', type: 'resistor', bb: { x: 0, y: 0 } }))
  for (let i = 1; i <= 10; i++) {
    s.dispatch(placePart('R1', 'bb', { x: i * 9.6, y: 0 }, [], true))
  }
  assert.equal(s.getDoc().parts[0].bb!.x, 96)
  s.undo() // one undo returns to pre-drag position
  assert.equal(s.getDoc().parts[0].bb!.x, 0)
  s.undo()
  assert.equal(s.getDoc().parts.length, 0)
})

test('attr edits merge per key; new command breaks the merge chain', () => {
  const s = freshStore()
  s.dispatch(addPart({ id: 'R1', type: 'resistor' }))
  s.dispatch(setPartAttr('R1', 'value', '1'))
  s.dispatch(setPartAttr('R1', 'value', '10'))
  s.dispatch(setPartAttr('R1', 'value', '100'))
  s.dispatch(setPartAttr('R1', 'tolerance', '5%')) // different key → new step
  assert.equal(s.getDoc().parts[0].attrs!.value, '100')
  s.undo()
  assert.equal(s.getDoc().parts[0].attrs!.tolerance, undefined)
  assert.equal(s.getDoc().parts[0].attrs!.value, '100')
  s.undo()
  assert.equal(s.getDoc().parts[0].attrs?.value, undefined)
})

test('duplicate wires are rejected either direction (B5)', () => {
  const s = freshStore()
  s.dispatch(addWire({ id: 'w1', from: 'A:1', to: 'B:1', view: 'bb' }))
  s.dispatch(addWire({ id: 'w2', from: 'B:1', to: 'A:1', view: 'bb' })) // reversed dup
  assert.equal(s.getDoc().wires.length, 1)
  s.dispatch(addWire({ id: 'w3', from: 'A:1', to: 'B:1', view: 'sch' })) // other view OK
  assert.equal(s.getDoc().wires.length, 2)
})

test('renamePart rewrites wire endpoints; collision is a no-op', () => {
  const s = freshStore()
  s.dispatch(addPart({ id: 'R1', type: 'resistor' }))
  s.dispatch(addPart({ id: 'R2', type: 'resistor' }))
  s.dispatch(addWire({ from: 'R1:1', to: 'R2:1', view: 'bb' }))
  s.dispatch(renamePart('R1', 'R9'))
  assert.equal(s.getDoc().wires[0].from, 'R9:1')
  const before = s.getDoc()
  s.dispatch(renamePart('R9', 'R2')) // collision
  assert.equal(s.getDoc(), before)
})

test('deleteParts cascades wires and repairs junction riders', () => {
  const s = freshStore()
  s.dispatch(addPart({ id: 'A', type: 'x' }))
  s.dispatch(addPart({ id: 'B', type: 'x' }))
  s.dispatch(addPart({ id: 'C', type: 'x' }))
  s.dispatch(addWire({ id: 'host', from: 'A:1', to: 'B:1', view: 'bb' }))
  s.dispatch(addWire({ id: 'rider', from: 'C:1', to: { wire: 'host', t: 0.5 }, view: 'bb' }))
  // deleting B removes host (touches B) — rider re-anchors to host.from = A:1
  s.dispatch(deleteParts(['B']))
  const wires = s.getDoc().wires
  assert.equal(wires.length, 1)
  assert.equal(wires[0].id, 'rider')
  assert.equal(wires[0].to, 'A:1')
  // undo restores everything as one step
  s.undo()
  assert.equal(s.getDoc().wires.length, 2)
  assert.equal(s.getDoc().parts.length, 3)
})

test('deleteWires drops degenerate riders that collapse onto themselves', () => {
  const s = freshStore()
  s.dispatch(addWire({ id: 'host', from: 'A:1', to: 'B:1', view: 'bb' }))
  s.dispatch(addWire({ id: 'rider', from: 'A:1', to: { wire: 'host', t: 0.5 }, view: 'bb' }))
  s.dispatch(deleteWires(['host']))
  // rider re-anchors to A:1 → degenerate (A:1 → A:1) → removed
  assert.equal(s.getDoc().wires.length, 0)
})

test('composite = one undo step', () => {
  const s = freshStore()
  s.dispatch(
    composite('Add wired pair', [
      addPart({ id: 'R1', type: 'resistor' }),
      addPart({ id: 'R2', type: 'resistor' }),
      addWire({ from: 'R1:2', to: 'R2:1', view: 'bb' })
    ])
  )
  assert.equal(s.getDoc().parts.length, 2)
  assert.equal(s.getDoc().wires.length, 1)
  s.undo()
  assert.equal(s.getDoc().parts.length, 0)
  assert.equal(s.getDoc().wires.length, 0)
})

test('replaceFromFile: echo ignored, external edit is undoable', () => {
  const { store } = CircuitStore.fromFile('{}')
  store.dispatch(addPart({ id: 'R1', type: 'resistor' }))
  const text = store.serialize()
  const echo = store.replaceFromFile(text)
  assert.equal(echo.applied, false)
  const edited = text.replace('"R1"', '"R7"')
  const ext = store.replaceFromFile(edited)
  assert.equal(ext.applied, true)
  assert.equal(store.getDoc().parts[0].id, 'R7')
  store.undo()
  assert.equal(store.getDoc().parts[0].id, 'R1')
})

test('refdes assignment', () => {
  const d = emptyDoc()
  d.parts.push({ id: 'R1', type: 'r' }, { id: 'R3', type: 'r' }, { id: 'LED1', type: 'led' })
  assert.equal(nextRefdes(d, 'R'), 'R4')
  assert.equal(nextRefdes(d, 'LED'), 'LED2')
  assert.equal(nextRefdes(d, 'U'), 'U1')
  assert.equal(prefixForFamily('Diode LED'), 'D') // 'diode' matches first
  assert.equal(prefixForFamily(undefined, 'Q'), 'Q')
  // longest-key-first: a breadboard is BB, not U (it contains 'board')
  assert.equal(prefixForFamily('breadboard'), 'BB')
  assert.equal(prefixForFamily('Custom Board'), 'U')
})
