/**
 * Tests for reference-designator renumbering — the fix for a migrated
 * diagram.json printing part-file slugs ("led", "battery-aa_y90") beside every
 * symbol instead of R1 / LED2 / BT3.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyDoc, type CircuitDoc } from '../core/model'
import { renumberParts } from '../core/commands'
import { looksLikeSlug, renumberAll } from '../core/refdes'

const prefixOf = (type: string): string =>
  ({ resistor: 'R', 'led-generic-5mm': 'LED', 'battery-aa': 'BT', tinycore: 'U' })[type] ?? 'P'

function migratedDoc(): CircuitDoc {
  const doc = emptyDoc()
  doc.parts = [
    { id: 'battery-aa_y90', type: 'battery-aa', sch: { x: 300, y: 200 } },
    { id: 'led', type: 'led-generic-5mm', sch: { x: 200, y: 100 } },
    { id: 'resistor', type: 'resistor', sch: { x: 100, y: 100 } },
    { id: 'tinycore', type: 'tinycore', sch: { x: 400, y: 100 } }
  ]
  doc.wires = [
    { id: 'w1', from: 'resistor:Pin 1', to: 'led:anode', view: 'sch' },
    { id: 'w2', from: 'led:cathode', to: 'battery-aa_y90:-', view: 'sch' }
  ]
  return doc
}

test('slug ids are recognised, real refdes are left alone', () => {
  assert.equal(looksLikeSlug('battery-aa_y90'), true)
  assert.equal(looksLikeSlug('led'), true)
  assert.equal(looksLikeSlug('resistor'), true)
  assert.equal(looksLikeSlug('R1'), false)
  assert.equal(looksLikeSlug('LED12'), false)
  assert.equal(looksLikeSlug('U1'), false)
})

test('renumbering reads the sheet: top to bottom, left to right', () => {
  const mapping = renumberAll(migratedDoc(), prefixOf, 'sch')
  // top row first, left to right: resistor(100,100) → led(200,100) → tinycore(400,100)
  assert.equal(mapping['resistor'], 'R1')
  assert.equal(mapping['led'], 'LED1')
  assert.equal(mapping['tinycore'], 'U1')
  // then the row below
  assert.equal(mapping['battery-aa_y90'], 'BT1')
})

test('renumbering rewrites every wire endpoint with the new names', () => {
  const doc = migratedDoc()
  const next = renumberParts(renumberAll(doc, prefixOf, 'sch')).apply(doc)
  assert.deepEqual(next.parts.map((p) => p.id).sort(), ['BT1', 'LED1', 'R1', 'U1'])
  assert.deepEqual(
    next.wires.map((w) => `${w.from}>${w.to}`),
    ['R1:Pin 1>LED1:anode', 'LED1:cathode>BT1:-']
  )
})

test('a rename that collides with an existing id still lands', () => {
  // renaming one at a time would hit renamePart's uniqueness guard and no-op:
  // 'a' wants to become 'R1', but 'R1' is already taken by the part that is
  // itself about to become 'R2'
  const doc = emptyDoc()
  doc.parts = [
    { id: 'R1', type: 'resistor', sch: { x: 200, y: 100 } },
    { id: 'a', type: 'resistor', sch: { x: 100, y: 100 } }
  ]
  doc.wires = [{ id: 'w1', from: 'a:Pin 0', to: 'R1:Pin 0', view: 'sch' }]
  const mapping = renumberAll(doc, prefixOf, 'sch')
  assert.deepEqual(mapping, { a: 'R1', R1: 'R2' })
  const next = renumberParts(mapping).apply(doc)
  assert.deepEqual(
    next.parts.map((p) => p.id),
    ['R2', 'R1']
  )
  assert.equal(next.wires[0].from, 'R1:Pin 0')
  assert.equal(next.wires[0].to, 'R2:Pin 0')
})

test('renumbering an already-tidy document is a no-op', () => {
  const doc = emptyDoc()
  doc.parts = [
    { id: 'R1', type: 'resistor', sch: { x: 100, y: 100 } },
    { id: 'R2', type: 'resistor', sch: { x: 200, y: 100 } }
  ]
  assert.deepEqual(renumberAll(doc, prefixOf, 'sch'), {})
})
