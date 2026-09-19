/**
 * Tests for cross-view auto-placement: a part added in one view must land,
 * collision-free, in the other one too (no more silent trips to the tray).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GRID_BB, emptyDoc, type CircuitDoc } from '../core/model'
import { placePart } from '../core/commands'
import { registerPart, type PartDef } from '../../lib/partsLibrary'
import { autoPlacementFor, occupiedBoxes } from '../views/partsAdapter'

const box = (type: string, w = 4 * GRID_BB, h = 2 * GRID_BB): PartDef => ({
  type,
  label: type,
  family: 'Passive Elements',
  views: {
    breadboard: { svg: '<svg/>', w, h, pins: { '1': [0, h / 2], '2': [w, h / 2] } },
    schematic: { svg: '<svg/>', w, h, pins: { '1': [0, h / 2], '2': [w, h / 2] } }
  }
})

function overlapsAnything(doc: CircuitDoc, at: { x: number; y: number }): boolean {
  const w = 4 * GRID_BB
  const h = 2 * GRID_BB
  return occupiedBoxes(doc, 'sch').some(
    (b) => at.x < b.x + b.w && at.x + w > b.x && at.y < b.y + b.h && at.y + h > b.y
  )
}

test('auto-placement clears everything already on the sheet', () => {
  registerPart(box('test-widget'))
  let doc: CircuitDoc = emptyDoc()
  doc.parts = [
    { id: 'W1', type: 'test-widget', sch: { x: 0, y: 0 } },
    { id: 'W2', type: 'test-widget', sch: { x: 48, y: 0 } }
  ]
  // place five more and confirm none of them lands on top of an earlier one
  for (let i = 3; i <= 7; i++) {
    const id = `W${i}`
    const pl = autoPlacementFor(doc, 'test-widget', 'sch')
    assert.equal(overlapsAnything(doc, pl), false, `${id} overlaps an existing part`)
    doc = { ...doc, parts: [...doc.parts, { id, type: 'test-widget' }] }
    doc = placePart(id, 'sch', pl).apply(doc)
  }
})

test('auto-placement lands on the major grid', () => {
  registerPart(box('test-widget2'))
  const doc: CircuitDoc = emptyDoc()
  const pl = autoPlacementFor(doc, 'test-widget2', 'sch')
  const onGrid = (n: number): boolean => Math.abs(n / GRID_BB - Math.round(n / GRID_BB)) < 1e-6
  assert.ok(onGrid(pl.x) && onGrid(pl.y), `placement off-grid: ${pl.x},${pl.y}`)
})

test('an empty sheet places at the fixed origin, not at 0,0', () => {
  registerPart(box('test-widget3'))
  const pl = autoPlacementFor(emptyDoc(), 'test-widget3', 'sch')
  assert.ok(pl.x > 0 && pl.y > 0, 'first part should sit inside the sheet, with margin')
})
