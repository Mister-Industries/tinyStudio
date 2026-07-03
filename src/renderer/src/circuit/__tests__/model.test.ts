/**
 * circuit/core/model tests — v2 parse/serialize round-trip, v1/Wokwi
 * migration, unknown-key preservation (B3), duplicate handling.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  emptyDoc,
  parseCircuitFile,
  serializeDoc,
  splitPinRef,
  type CircuitDoc
} from '../core/model'

test('v2 round-trip is lossless and stable', () => {
  const doc: CircuitDoc = {
    ...emptyDoc('geoff'),
    parts: [
      { id: 'R1', type: 'resistor', attrs: { value: '220' }, bb: { x: 96, y: 48 }, sch: { x: 10, y: 10, rotate: 90 } }
    ],
    wires: [{ id: 'w1', from: 'R1:1', to: 'R1:2', view: 'bb', color: '#2fa46a', route: ['h10'] }]
  }
  const text = serializeDoc(doc)
  const { doc: back, migrated } = parseCircuitFile(text)
  assert.equal(migrated, false)
  assert.equal(back.parts.length, 1)
  assert.deepEqual(back.parts[0].attrs, { value: '220' })
  assert.equal(back.wires[0].id, 'w1')
  assert.equal(serializeDoc(back), text) // stable output
})

test('unknown top-level keys survive round-trip (B3)', () => {
  const input = JSON.stringify({
    format: 'tinystudio-circuit',
    version: 2,
    parts: [],
    wires: [],
    serialMonitor: { display: 'terminal' },
    dependencies: { foo: '1.0' }
  })
  const { doc } = parseCircuitFile(input)
  const out = JSON.parse(serializeDoc(doc))
  assert.deepEqual(out.serialMonitor, { display: 'terminal' })
  assert.deepEqual(out.dependencies, { foo: '1.0' })
})

test('garbage input yields empty doc + warning, never throws', () => {
  const r1 = parseCircuitFile('not json at all {')
  assert.equal(r1.doc.parts.length, 0)
  assert.ok(r1.warnings.length > 0)
  const r2 = parseCircuitFile('null')
  assert.equal(r2.doc.parts.length, 0)
})

test('duplicate part ids are dropped with a warning', () => {
  const input = JSON.stringify({
    format: 'tinystudio-circuit',
    version: 2,
    parts: [
      { id: 'R1', type: 'resistor' },
      { id: 'R1', type: 'resistor' }
    ],
    wires: []
  })
  const { doc, warnings } = parseCircuitFile(input)
  assert.equal(doc.parts.length, 1)
  assert.ok(warnings.some((w) => w.includes('Duplicate')))
})

test('v1 tinyStudio diagram.json migrates: placements, wires, schematic overlay', () => {
  const v1 = JSON.stringify({
    version: 1,
    editor: 'tinystudio',
    author: 'tinyStudio',
    parts: [
      { type: 'tinycore', id: 'tinycore', left: 150, top: 240 },
      { type: 'resistor', id: 'resistor', left: 520, top: 230, rotate: 90, attrs: { value: '1k' } }
    ],
    connections: [
      ['tinycore:SIG', 'resistor:Pin 0', '#36c46b', ['v-22.73', 'h-179.8']]
    ],
    schematic: {
      pos: { resistor: [40, 60] },
      routes: { 'tinycore:SIG>resistor:Pin 0': ['h20'] }
    }
  })
  const { doc, migrated } = parseCircuitFile(v1)
  assert.equal(migrated, true)
  assert.equal(doc.parts.length, 2)
  const res = doc.parts.find((p) => p.id === 'resistor')!
  assert.deepEqual(res.bb, { x: 520, y: 230, rotate: 90 })
  assert.deepEqual(res.sch, { x: 40, y: 60 })
  assert.deepEqual(res.attrs, { value: '1k' })
  const bbWires = doc.wires.filter((w) => w.view === 'bb')
  const schWires = doc.wires.filter((w) => w.view === 'sch')
  assert.equal(bbWires.length, 1)
  assert.equal(bbWires[0].color, '#36c46b')
  assert.deepEqual(bbWires[0].route, ['v-22.73', 'h-179.8'])
  assert.equal(schWires.length, 1)
  assert.deepEqual(schWires[0].route, ['h20'])
  assert.equal(splitPinRef(bbWires[0].from as string).part, 'tinycore')
})

test('Wokwi diagram.json migrates and preserves foreign keys', () => {
  const wokwi = JSON.stringify({
    version: 1,
    author: 'Uri',
    editor: 'wokwi',
    parts: [{ id: 'led1', type: 'wokwi-led', left: 100, top: 50, attrs: { color: 'red' } }],
    connections: [['led1:A', 'led1:C', 'green', ['v10', '*', 'h-5']]],
    serialMonitor: { display: 'terminal' }
  })
  const { doc, migrated } = parseCircuitFile(wokwi)
  assert.equal(migrated, true)
  assert.equal(doc.parts[0].type, 'wokwi-led')
  assert.deepEqual(doc.wires[0].route, ['v10', '*', 'h-5']) // '*' kept for the router
  assert.deepEqual(doc.extra?.serialMonitor, { display: 'terminal' })
  const out = JSON.parse(serializeDoc(doc))
  assert.deepEqual(out.serialMonitor, { display: 'terminal' })
})

test('v1 free-point junction endpoints become pending junctions, not drops', () => {
  const v1 = JSON.stringify({
    version: 1,
    parts: [{ id: 'a', type: 'resistor', left: 0, top: 0 }],
    connections: [
      ['a:1', 'a:2', '#fff', ['h10']],
      ['a:2', { x: 5, y: 0 }, '#fff', []]
    ]
  })
  const { doc } = parseCircuitFile(v1)
  assert.equal(doc.wires.length, 2)
  const j = doc.wires[1].to
  assert.equal(typeof j, 'object')
})
