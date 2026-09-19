/**
 * Tests for the tinyBoard family as it ships: the bundled tinyparts `tinyboards`
 * pack, whose pins are read out of the real SVG files. These pin the family's
 * physical contract: the shared 25-pin stack connector at fixed positions,
 * tinyProto's hole lattice and power buses, so an art edit that nudges a pad
 * off the 0.1in grid fails here instead of in someone's circuit.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GRID_BB, emptyDoc } from '../core/model'
import { buildNets } from '../core/nets'
import { PART_MANIFEST, ensureParts, getPart, viewFor, type PartView } from '../../lib/partsLibrary'
import { buildFolderPart } from '../parts/folderPart'
import { readBundled } from '../parts/bundled'

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

async function bb(type: string): Promise<PartView> {
  await ensureParts([type])
  const def = getPart(type)
  assert.ok(def, `${type} should ship bundled`)
  const v = viewFor(def!, 'breadboard')
  assert.ok(v, `${type} should have a breadboard view`)
  return v!
}

test('the whole family ships bundled, 1.9in square, and loads without warnings', async () => {
  for (const type of FAMILY) {
    const v = await bb(type)
    assert.equal(v.w, 182.4, type)
    assert.equal(v.h, 182.4, type)
    const meta = PART_MANIFEST.find((m) => m.type === type)
    assert.ok(meta?.builtin, `${type} is marked builtin`)
    assert.equal(meta?.layer, 'bundled', type)
    assert.ok(meta?.icon?.startsWith('<svg'), `${type} has a palette icon`)
    assert.deepEqual(getPart(type)!.source?.warnings, [], type)
    assert.equal(
      getPart(type)!.source?.pinsFromSvg?.breadboard,
      true,
      `${type} pins come from its art`
    )
  }
})

test('the stack connector is where it has always been (pins read from the SVG)', async () => {
  // the positions the family was drawn to; saved circuits depend on them
  const pins = (await bb('tinycore')).pins
  assert.deepEqual(pins['GND'], [7.2, 57.6])
  assert.deepEqual(pins['A0'], [7.2, 124.8])
  assert.deepEqual(pins['D8'], [175.2, 57.6])
  assert.deepEqual(pins['GND.2'], [175.2, 124.8])
  assert.deepEqual(pins['SCK'], [52.8, 170.4])
  assert.deepEqual(pins['GND.3'], [129.6, 170.4])
  assert.deepEqual(Object.keys(pins), STACK, 'pin order follows part.json')
})

test('every board carries the same 25-pin stack connector at the same places', async () => {
  const ref = (await bb('tinycore')).pins
  for (const type of FAMILY) {
    const pins = (await bb(type)).pins
    for (const name of STACK) {
      assert.deepEqual(pins[name], ref[name], `${type}:${name} must stack onto tinycore`)
    }
  }
})

test('each header is on a 0.1in pitch', async () => {
  const pins = (await bb('tinycore')).pins
  const step = (a: string, b: string, axis: 0 | 1): number =>
    Math.abs(pins[b]![axis] - pins[a]![axis])
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

test('tinyProto adds a 183-hole cross: 15 cols x 8 header rows + 9 cols x 15 rows', async () => {
  const pins = (await bb('tinyproto')).pins
  const holes = Object.keys(pins).filter((k) => /^[A-O]\.\d+$/.test(k))
  assert.equal(holes.length, 183)
  assert.equal(Object.keys(pins).length, 183 + 25)
  for (const row of [5, 6, 7, 8, 9, 10, 11, 12]) {
    for (const col of 'ABCDEFGHIJKLMNO') assert.ok(pins[`${col}.${row}`], `${col}.${row}`)
  }
  for (const col of 'DEFGHIJKL') {
    for (let row = 1; row <= 15; row++) assert.ok(pins[`${col}.${row}`], `${col}.${row}`)
  }
  assert.equal(pins['A.1'], undefined)
  assert.equal(pins['O.15'], undefined)
})

test('proto holes share the header lattice: a hole lines up with its header pin', async () => {
  const pins = (await bb('tinyproto')).pins
  assert.equal(pins['A.5']![1], pins['GND']![1])
  assert.equal(pins['O.12']![1], pins['A0']![1])
  assert.equal(pins['D.15']![0], pins['SCK']![0])
  assert.equal(pins['L.15']![0], pins['GND.3']![0])
  const [ox, oy] = pins['A.5']!
  for (const [name, [x, y]] of Object.entries(pins)) {
    if (!/^[A-O]\.\d+$/.test(name)) continue
    const dx = (x - ox) / GRID_BB
    const dy = (y - oy) / GRID_BB
    assert.ok(Math.abs(dx - Math.round(dx)) < 1e-6, `${name} x=${x}`)
    assert.ok(Math.abs(dy - Math.round(dy)) < 1e-6, `${name} y=${y}`)
  }
})

test('only the five ringed groups are bussed; every other hole is an island', async () => {
  const pins = (await bb('tinyproto')).pins
  const buses = getPart('tinyproto')!.buses!
  assert.equal(buses.length, 5)
  const bussed = new Set<string>()
  for (const bus of buses) {
    for (const p of bus) {
      assert.ok(pins[p], `bus references unknown hole ${p}`)
      assert.ok(!bussed.has(p), `${p} is in two buses`)
      bussed.add(p)
    }
  }
  assert.equal(bussed.size, 21)
  await ensureParts(['resistor'])
  const busesFor = (t: string): string[][] | undefined => getPart(t)?.buses
  const doc = emptyDoc()
  doc.parts = [
    { id: 'P1', type: 'tinyproto', bb: { x: 0, y: 0 } },
    { id: 'R1', type: 'resistor', bb: { x: 400, y: 40 } },
    { id: 'R2', type: 'resistor', bb: { x: 400, y: 90 } }
  ]
  const nets = buildNets(doc, {
    busesFor,
    implicit: [
      ['R1:1', 'P1:C.5'], // right-hand end of the left GND row
      ['R2:1', 'P1:D.2'] // top of the column that bends off it
    ]
  })
  const a = nets.pinToNet.get('R1:1')
  const b = nets.pinToNet.get('R2:1')
  assert.ok(a != null && b != null)
  assert.equal(a, b, 'the L-shaped GND bus is one net')
  const nets2 = buildNets(doc, {
    busesFor,
    implicit: [
      ['R1:1', 'P1:C.5'],
      ['R2:1', 'P1:C.7']
    ]
  })
  assert.notEqual(nets2.pinToNet.get('R1:1'), nets2.pinToNet.get('R2:1'))
})

test('moving a pad in the art moves the pin, nothing else to update', async () => {
  const def = getPart('tinycore') ?? (await ensureParts(['tinycore']), getPart('tinycore')!)
  const src = def.source!
  // shift pin-GND (tinyCore's pads are <circle>s) one pitch (5.4 viewBox
  // units, 7.2px) to the right
  const edited = src.raw!.breadboard!.replace(
    /(<circle id="pin-GND"[^>]*?cx=")([\d.]+)/,
    (_m, head: string, x: string) => `${head}${(parseFloat(x) + 5.4).toFixed(2)}`
  )
  assert.notEqual(edited, src.raw!.breadboard)
  const moved = await buildFolderPart(
    src.json!,
    async (p) => (p.endsWith('/breadboard.svg') ? edited : readBundled(p)),
    { layer: 'dev', pack: src.pack, dir: src.dir! }
  )
  assert.deepEqual(moved.views.breadboard!.pins['GND'], [14.4, 57.6])
  assert.deepEqual(moved.views.breadboard!.pins['3V3'], def.views.breadboard!.pins['3V3'])
})

test('no two bundled parts share a referenced id or style class once inlined', async () => {
  await ensureParts(PART_MANIFEST.filter((m) => m.layer === 'bundled').map((m) => m.type))
  const owner = new Map<string, string>()
  for (const meta of PART_MANIFEST.filter((m) => m.layer === 'bundled')) {
    const def = getPart(meta.type)!
    for (const v of Object.values(def.views)) {
      const refs = new Set([...v!.svg.matchAll(/url\(\s*['"]?#([^'")\s]+)/g)].map((m) => m[1]))
      for (const id of refs) {
        const prev = owner.get(id)
        assert.ok(!prev || prev === meta.type, `#${id} is defined by both ${prev} and ${meta.type}`)
        owner.set(id, meta.type)
      }
    }
  }
})
