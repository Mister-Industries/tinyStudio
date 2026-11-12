/** Tests for export/kicadSch: the circuit as a KiCad 10 schematic. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyDoc, type CircuitPart, type CircuitWire } from '../core/model'
import { buildNets } from '../core/nets'
import {
  kicadSchematic,
  KICAD_SCH_VERSION,
  libField,
  stableUuid,
  symbolPins
} from '../export/kicadSch'
import { KICAD_LIB_SYMBOLS } from '../export/kicadSymbols.gen'
import { circuitBuses } from '../views/partsAdapter'

let wid = 0
const wire = (from: string, to: string): CircuitWire => ({ id: `w${++wid}`, from, to, view: 'bb' })
const part = (id: string, type: string, attrs?: CircuitPart['attrs'], at = 0): CircuitPart => ({
  id,
  type,
  attrs,
  bb: { x: 0, y: 0 },
  sch: { x: at, y: 0 }
})

/** two buttons with pull-downs and an LED with its resistor, on loose rails */
function buttonCircuit(): ReturnType<typeof emptyDoc> {
  const doc = emptyDoc()
  doc.parts = [
    part('SW1', 'tactile-button-6mm', undefined, 0),
    part('SW2', 'tactile-button-12mm', undefined, 80),
    part('R1', 'resistor', { resistance: '10k' }, 160),
    part('R2', 'resistor', { resistance: '330' }, 240),
    part('LED1', 'led-generic-5mm', undefined, 320)
  ]
  doc.wires = [
    wire('SW1:2a', 'R1:Pin 0'),
    wire('SW2:2a', 'R1:Pin 0'),
    wire('R1:Pin 1', 'R2:Pin 0'),
    wire('R2:Pin 1', 'LED1:anode')
  ]
  return doc
}

const balanced = (s: string): boolean => {
  let depth = 0
  for (const ch of s.replace(/"(?:[^"\\]|\\.)*"/g, '')) {
    depth += ch === '(' ? 1 : ch === ')' ? -1 : 0
    if (depth < 0) return false
  }
  return depth === 0
}

test('stableUuid: deterministic, uuid-shaped, distinct', () => {
  assert.equal(stableUuid('a'), stableUuid('a'))
  assert.notEqual(stableUuid('a'), stableUuid('b'))
  assert.match(
    stableUuid('x'),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  )
})

test('symbolPins reads KiCad pin positions', () => {
  const r = symbolPins(KICAD_LIB_SYMBOLS['Device:R'])
  assert.deepEqual(
    r.map((p) => [p.number, p.x, p.y, p.rot]),
    [
      ['1', 0, 3.81, 270],
      ['2', 0, -3.81, 90]
    ]
  )
  assert.equal(symbolPins(KICAD_LIB_SYMBOLS['Connector_Generic:Conn_01x09']).length, 9)
})

test('schematic: stock symbols, one label per connected pin, valid file', () => {
  const doc = buttonCircuit()
  const net = buildNets(doc, { busesFor: circuitBuses })
  const sch = kicadSchematic(doc, net, { date: '2026-11-11' }, { name: 'demo', title: 'Demo' })
  const t = sch.text
  assert.ok(balanced(t), 'brackets balance')
  assert.match(t, new RegExp(`^\\(kicad_sch\\n\\t\\(version ${KICAD_SCH_VERSION}\\)`))
  assert.match(t, /\(title "Demo"\)/)
  for (const id of ['Device:R', 'Device:LED', 'Switch:SW_Push'])
    assert.ok(t.includes(`\t\t(symbol "${id}"`), `${id} embedded`)
  // every placed symbol has an instance under this sheet
  const refs = [...t.matchAll(/\(path "\/([^"]+)" \(reference "([^"]+)"\)/g)]
  assert.deepEqual(refs.map((m) => m[2]).sort(), ['LED1', 'R1', 'R2', 'SW1', 'SW2'])
  assert.ok(refs.every((m) => m[1] === sch.sheetUuid))
  // SW1 pad 2 and SW2 pad 2 and R1 pad 1 share one net: three labels of the same name
  const swNet = sch.netlist.padNets.get('SW1:2')!
  assert.equal(sch.netlist.padNets.get('SW2:2'), swNet)
  const esc = swNet.replace(/[()]/g, '\\$&')
  assert.equal((t.match(new RegExp(`\\(label "${esc}"`, 'g')) ?? []).length, 3)
  // a pin wired to nothing gets a no-connect flag, not a dangling label
  assert.match(t, /\(no_connect \(at /)
  // the footprint goes along, hidden, for Update PCB
  assert.match(t, /\(property "Footprint" "Button_Switch_THT:SW_PUSH_6mm"/)
  assert.match(t, /\(property "Footprint" "SparkFun-Switch:Push_PTH_12x12mm"/)
})

test('schematic: labels sit on the end of a wire that starts at the pin', () => {
  const doc = buttonCircuit()
  const sch = kicadSchematic(doc, buildNets(doc, { busesFor: circuitBuses }), {}, { name: 'd' })
  const ends = new Set(
    [...sch.text.matchAll(/\(wire \(pts \(xy [-\d.]+ [-\d.]+\) \(xy ([-\d.]+) ([-\d.]+)\)\)/g)].map(
      (m) => `${m[1]},${m[2]}`
    )
  )
  const labels = [...sch.text.matchAll(/\(label "[^"]+"\n\t\t\(at ([-\d.]+) ([-\d.]+) /g)]
  assert.ok(labels.length > 0)
  for (const l of labels) assert.ok(ends.has(`${l[1]},${l[2]}`), `label at ${l[1]},${l[2]}`)
  // every wire on the 50 mil grid (the symbols' own drawings needn't be)
  const wires = [...sch.text.matchAll(/\(wire \(pts ([^\n]+)\)\)/g)].map((m) => m[1]).join(' ')
  for (const m of wires.matchAll(/\(xy ([-\d.]+) ([-\d.]+)\)/g))
    for (const v of [+m[1], +m[2]])
      assert.ok(Math.abs(v / 1.27 - Math.round(v / 1.27)) < 1e-6, String(v))
})

test('schematic: the same circuit exports the same uuids', () => {
  const a = buttonCircuit()
  const b = buttonCircuit()
  const ta = kicadSchematic(
    a,
    buildNets(a, { busesFor: circuitBuses }),
    { date: 'x' },
    { name: 'n' }
  ).text
  const tb = kicadSchematic(
    b,
    buildNets(b, { busesFor: circuitBuses }),
    { date: 'x' },
    { name: 'n' }
  ).text
  assert.equal(ta, tb)
})

test('schematic: a wide layout gets a landscape sheet, a tall one is turned upright', () => {
  const wide = buttonCircuit()
  const w = kicadSchematic(wide, buildNets(wide, { busesFor: circuitBuses }), {}, { name: 'w' })
  assert.match(w.text, /\(paper "A\d"\)\n/)
  const tall = buttonCircuit()
  tall.parts.forEach((p, i) => (p.sch = { x: 0, y: i * 160 }))
  const t = kicadSchematic(tall, buildNets(tall, { busesFor: circuitBuses }), {}, { name: 't' })
  assert.match(t.text, /\(paper "A\d" portrait\)\n/)
})

test('fields go where the KiCad library puts them', () => {
  const r = libField(KICAD_LIB_SYMBOLS['Device:R'], 'Reference')!
  assert.deepEqual([r.x, r.y, r.angle], [2.032, 0, 90])
  const doc = buttonCircuit()
  const t = kicadSchematic(doc, buildNets(doc, { busesFor: circuitBuses }), {}, { name: 'f' }).text
  // R1's reference sits 2.032 mm right of the symbol, turned to read along it
  const at =
    /\(lib_id "Device:R"\)\n\t\t\(at ([-\d.]+) ([-\d.]+) 0\)[\s\S]*?\(property "Reference" "R1"\n\t\t\t\(at ([-\d.]+) ([-\d.]+) 90\)/.exec(
      t
    )!
  assert.ok(Math.abs(+at[3] - (+at[1] + 2.032)) < 1e-6)
  assert.equal(+at[4], +at[2])
})
