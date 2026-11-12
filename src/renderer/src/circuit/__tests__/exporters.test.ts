/** Tests for circuit/export: KiCad netlist, BOM and SPICE file output. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyDoc, type CircuitDoc, type CircuitPart, type CircuitWire } from '../core/model'
import { buildNets } from '../core/nets'
import {
  bomCsv,
  bomRows,
  compareRefs,
  kicadNetlist,
  spiceFile,
  type ExportContext
} from '../export'

let wid = 0
const wire = (from: string, to: string): CircuitWire => ({ id: `w${++wid}`, from, to, view: 'sch' })
const part = (id: string, type: string, attrs?: CircuitPart['attrs']): CircuitPart => ({
  id,
  type,
  attrs,
  sch: { x: 0, y: 0 }
})

const TINYCORE_PINS = [
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
  'D13'
]
const ctx: ExportContext = {
  date: '2026-11-02',
  pinsOf: (t) => (t === 'tinycore' ? TINYCORE_PINS : []),
  labelOf: (t) => ({ resistor: 'Resistor', 'led-generic-5mm': 'Red LED', tinycore: 'tinyCore' })[t]
}

/** tinyCore D8 → R1 (220) → LED1 → GND, plus a spare 220 and a 10k pull-up on D9. */
function blinky(): CircuitDoc {
  const doc = emptyDoc()
  doc.parts = [
    part('U1', 'tinycore'),
    part('R1', 'resistor', { resistance: '220' }),
    part('R2', 'resistor', { resistance: '10 kΩ' }),
    part('R10', 'resistor', { resistance: '220' }),
    part('LED1', 'led-generic-5mm'),
    part('V1', 'sim-vdc', { voltage: '5' })
  ]
  doc.netLabels = [{ id: 'nl1', name: 'GND', kind: 'ground', sch: { x: 0, y: 0 } }]
  doc.wires = [
    wire('U1:D8', 'R1:Pin 0'),
    wire('R1:Pin 1', 'LED1:anode'),
    wire('LED1:cathode', 'U1:GND'),
    wire('nl1:1', 'U1:GND'),
    wire('U1:3V3', 'R2:Pin 0'),
    wire('R2:Pin 1', 'U1:D9')
  ]
  return doc
}

test('KiCad netlist: components with footprints, simulation-only parts left out', () => {
  const doc = blinky()
  const { text } = kicadNetlist(doc, buildNets(doc), ctx)
  assert.ok(text.startsWith('(export (version "E")'))
  assert.match(
    text,
    /\(comp \(ref "R1"\)\n {6}\(value "220"\)\n {6}\(footprint "SparkFun-Resistor:R_Axial/
  )
  assert.match(text, /\(comp \(ref "R2"\)\n {6}\(value "10k"\)/)
  assert.match(text, /\(comp \(ref "U1"\)[\s\S]*?\(footprint "MR-INDUSTRIES:tinycore"\)/)
  assert.doesNotMatch(text, /"V1"/, 'sim sources are not components')
  // refs in natural order
  const refs = [...text.matchAll(/\(comp \(ref "([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(refs, ['LED1', 'R1', 'R2', 'R10', 'U1'])
  // balanced parentheses (outside strings)
  let depth = 0
  for (const ch of text.replace(/"(?:[^"\\]|\\.)*"/g, '')) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    assert.ok(depth >= 0)
  }
  assert.equal(depth, 0)
})

test('KiCad netlist: named nets keep their name, LED pads are K=1 A=2, board pads follow pin order', () => {
  const doc = blinky()
  const { text } = kicadNetlist(doc, buildNets(doc), ctx)
  const gnd = /\(name "GND"\)\n([\s\S]*?)(?=\n {4}\(net |\n {2}\))/.exec(text)
  assert.ok(gnd, 'GND net present')
  assert.match(gnd[1], /\(node \(ref "LED1"\) \(pin "1"\)\)/)
  assert.match(gnd[1], /\(node \(ref "U1"\) \(pin "1"\)\)/) // GND is tinyCore header pin 1
  // unnamed net: KiCad-style name from its first node; D8 is pin 9
  assert.match(
    text,
    /\(name "Net-\(LED1-Pad2\)"\)\n {6}\(node \(ref "LED1"\) \(pin "2"\)\)\n {6}\(node \(ref "R1"\) \(pin "2"\)\)/
  )
  assert.match(text, /\(node \(ref "U1"\) \(pin "9"\)\)/)
})

test('KiCad netlist: an unmapped part is still exported, with a warning and pin-order pads', () => {
  const doc = emptyDoc()
  doc.parts = [part('X1', 'mystery-widget'), part('R1', 'resistor')]
  doc.wires = [wire('X1:a', 'R1:Pin 0')]
  const res = kicadNetlist(doc, buildNets(doc), { pinsOf: () => ['a', 'b'] })
  assert.match(res.text, /\(comp \(ref "X1"\)[\s\S]*?\(footprint ""\)/)
  assert.match(res.text, /\(node \(ref "X1"\) \(pin "1"\)\)/)
  assert.ok(res.warnings.some((w) => w.startsWith('X1')))
})

test('BOM groups identical parts, sorts refs naturally, skips sim parts', () => {
  const doc = blinky()
  const rows = bomRows(doc, ctx)
  const r220 = rows.find((r) => r.value === '220')!
  assert.deepEqual(r220.refs, ['R1', 'R10'])
  assert.equal(rows.find((r) => r.value === '10k')?.refs.join(), 'R2')
  assert.ok(!rows.some((r) => r.refs.includes('V1')))
  const csv = bomCsv(doc, ctx).text.split('\n')
  assert.equal(csv[0], 'Designator,Quantity,Value,Part,Footprint,LCSC,SparkFun PROD_ID')
  assert.ok(
    csv.includes(
      '"R1, R10",2,220,Resistor,SparkFun-Resistor:R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal,,'
    )
  )
})

test('SPICE file: the simulator netlist with a header and warnings as comments', () => {
  const doc = blinky()
  const { text } = spiceFile(doc, buildNets(doc), ctx)
  const lines = text.split('\n')
  assert.equal(lines[0], '* tinyStudio circuit')
  assert.equal(lines[1], '* Exported from tinyStudio, 2026-11-02')
  assert.ok(
    lines.some((l) => l.startsWith('VU1_3V3 ')),
    'the tinyCore is simulated: its 3V3 rail is a source'
  )
  assert.ok(lines.includes('.end'))
})

test('compareRefs orders R2 before R10 and groups by prefix', () => {
  assert.deepEqual(['R10', 'C1', 'R2', 'LED1'].sort(compareRefs), ['C1', 'LED1', 'R2', 'R10'])
})
