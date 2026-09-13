/**
 * Tests for the built-in tinyBoard parts — the shared 25-pin stack connector,
 * tinyProto's prototyping cross and its power buses, and the SVG invariants
 * the Circuit view depends on (namespaced gradient ids, Fritzing connectors).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GRID_BB } from '../core/model'
import { buildNets } from '../core/nets'
import { emptyDoc } from '../core/model'
import {
  PART_MANIFEST,
  TINYPROTO_BUSES,
  getPart,
  viewFor,
  type PartView
} from '../../lib/partsLibrary'

const FAMILY = ['tinycore', 'tinyglow', 'tinyproto', 'tinysniff', 'tinyspeak', 'tinydisplay']
const STACK = [
  'GND',
  '3V3',
  'A5',
  'A4',
  'A3',
  'A2',
  'A1',
  'A0',
  'D8',
  'D9',
  'D10',
  'D11',
  'D12',
  'D13',
  '3V3.2',
  'GND.2',
  'SCK',
  'MO',
  'MI',
  'RX',
  'TX',
  'SDA',
  'SCL',
  'PWR',
  'GND.3'
]

function bb(type: string): PartView {
  const def = getPart(type)
  assert.ok(def, `${type} should be a built-in`)
  const v = viewFor(def!, 'breadboard')
  assert.ok(v, `${type} should have a breadboard view`)
  return v!
}

test('the whole family is registered and 1.9in square', () => {
  for (const type of FAMILY) {
    const v = bb(type)
    assert.equal(v.w, 182.4, type)
    assert.equal(v.h, 182.4, type)
    assert.ok(
      PART_MANIFEST.some((m) => m.type === type && m.builtin),
      type
    )
  }
})

test('every board carries the same 25-pin stack connector at the same places', () => {
  const ref = bb('tinycore').pins
  for (const name of STACK) assert.ok(ref[name], `tinycore missing ${name}`)
  for (const type of FAMILY) {
    const pins = bb(type).pins
    for (const name of STACK) {
      assert.deepEqual(pins[name], ref[name], `${type}:${name} must stack onto tinycore`)
    }
  }
})

test('each header is on a 0.1in pitch', () => {
  const pins = bb('tinycore').pins
  const step = (a: string, b: string, axis: 0 | 1): number =>
    Math.abs(pins[b]![axis] - pins[a]![axis])
  // left and right run top to bottom, the bottom header left to right
  const near = (got: number, want: number, what: string): void =>
    assert.ok(Math.abs(got - want) < 1e-6, `${what}: ${got} != ${want}`)
  for (const [a, b] of [
    ['GND', '3V3'],
    ['A1', 'A0'],
    ['D8', 'D9'],
    ['3V3.2', 'GND.2']
  ]) {
    near(step(a, b, 1), GRID_BB, `${a}->${b}`)
  }
  for (const [a, b] of [
    ['SCK', 'MO'],
    ['SCL', 'PWR'],
    ['PWR', 'GND.3']
  ]) {
    near(step(a, b, 0), GRID_BB, `${a}->${b}`)
  }
  // headers hug opposite edges, 17.5 pitches apart, on a square board
  near(pins['GND']![0] + pins['D8']![0], 182.4, 'left/right symmetry')
  near(pins['D8']![0] - pins['GND']![0], 17.5 * GRID_BB, 'header separation')
})

test('tinyProto adds a 183-hole cross: 15 cols x 8 header rows + 9 cols x 15 rows', () => {
  const pins = bb('tinyproto').pins
  const holes = Object.keys(pins).filter((k) => /^[A-O]\.\d+$/.test(k))
  assert.equal(holes.length, 183)
  assert.equal(Object.keys(pins).length, 183 + 25)
  // the horizontal band spans all 15 columns at each of the 8 header rows
  for (const row of [5, 6, 7, 8, 9, 10, 11, 12]) {
    for (const col of 'ABCDEFGHIJKLMNO') assert.ok(pins[`${col}.${row}`], `${col}.${row}`)
  }
  // the vertical band spans all 15 rows in the 9 bottom-header columns
  for (const col of 'DEFGHIJKL') {
    for (let row = 1; row <= 15; row++) assert.ok(pins[`${col}.${row}`], `${col}.${row}`)
  }
  // and nothing outside the cross
  assert.equal(pins['A.1'], undefined)
  assert.equal(pins['O.15'], undefined)
})

test('proto holes share the header lattice — a hole lines up with its header pin', () => {
  const pins = bb('tinyproto').pins
  assert.equal(pins['A.5']![1], pins['GND']![1]) // first header row
  assert.equal(pins['O.12']![1], pins['A0']![1]) // last header row
  assert.equal(pins['D.15']![0], pins['SCK']![0]) // first bottom column
  assert.equal(pins['L.15']![0], pins['GND.3']![0]) // last bottom column
  // the whole field is one lattice: every hole is a whole number of pitches
  // from A.5 in both axes
  const [ox, oy] = pins['A.5']!
  for (const [name, [x, y]] of Object.entries(pins)) {
    if (!/^[A-O]\.\d+$/.test(name)) continue
    const dx = (x - ox) / GRID_BB
    const dy = (y - oy) / GRID_BB
    assert.ok(Math.abs(dx - Math.round(dx)) < 1e-6, `${name} x=${x}`)
    assert.ok(Math.abs(dy - Math.round(dy)) < 1e-6, `${name} y=${y}`)
  }
})

test('only the five ringed groups are bussed; every other hole is an island', () => {
  const pins = bb('tinyproto').pins
  assert.equal(TINYPROTO_BUSES.length, 5)
  const bussed = new Set<string>()
  for (const bus of TINYPROTO_BUSES) {
    for (const p of bus) {
      assert.ok(pins[p], `bus references unknown hole ${p}`)
      assert.ok(!bussed.has(p), `${p} is in two buses`)
      bussed.add(p)
    }
  }
  assert.equal(bussed.size, 21)
  // wire two holes of the left GND bus (a bare board lists no nets at all) and
  // check the bus joined them — including across the L-bend into column D
  const doc = emptyDoc()
  doc.parts = [
    { id: 'P1', type: 'tinyproto', bb: { x: 0, y: 0 } },
    { id: 'R1', type: 'resistor', bb: { x: 400, y: 40 } },
    { id: 'R2', type: 'resistor', bb: { x: 400, y: 90 } }
  ]
  const nets = buildNets(doc, {
    busesFor: (t) => (t === 'tinyproto' ? TINYPROTO_BUSES : undefined),
    implicit: [
      ['R1:1', 'P1:C.5'], // right-hand end of the left GND row
      ['R2:1', 'P1:D.2'] // top of the column that bends off it
    ]
  })
  const a = nets.pinToNet.get('R1:1')
  const b = nets.pinToNet.get('R2:1')
  assert.ok(a != null && b != null)
  assert.equal(a, b, 'the L-shaped GND bus is one net')
  // a neighbouring hole is not on it
  const nets2 = buildNets(doc, {
    busesFor: (t) => (t === 'tinyproto' ? TINYPROTO_BUSES : undefined),
    implicit: [
      ['R1:1', 'P1:C.5'],
      ['R2:1', 'P1:C.7'] // a plain hole one row down — its own island
    ]
  })
  assert.notEqual(nets2.pinToNet.get('R1:1'), nets2.pinToNet.get('R2:1'))
})

test('each board namespaces its gradient ids (shared ids made every board go black)', () => {
  const seen = new Map<string, string>()
  for (const type of FAMILY) {
    const svg = bb(type).svg
    const ids = [...svg.matchAll(/id="([a-z]{2}-[a-z]+)"/g)].map((m) => m[1])
    assert.ok(ids.length > 0, `${type} should define namespaced gradients`)
    for (const id of ids) {
      const prev = seen.get(id)
      assert.equal(prev, undefined, `id "${id}" is shared by ${prev} and ${type}`)
      seen.set(id, type)
    }
    for (const ref of [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])) {
      assert.ok(ids.includes(ref), `${type} references #${ref} but does not define it`)
    }
  }
})

test('the art follows Fritzing conventions', () => {
  for (const type of FAMILY) {
    const svg = bb(type).svg
    assert.match(svg, /width="1\.9in" height="1\.9in"/, type)
    assert.match(svg, /viewBox="0 0 136\.8 136\.8"/, type)
    assert.match(svg, /<g id="breadboard">/, type)
    for (let i = 0; i < 25; i++) {
      assert.ok(svg.includes(`id="connector${i}pin"`), `${type} connector${i}pin`)
      assert.ok(svg.includes(`id="connector${i}terminal"`), `${type} connector${i}terminal`)
    }
  }
})
