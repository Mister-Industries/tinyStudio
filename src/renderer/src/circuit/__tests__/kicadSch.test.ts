/** Tests for export/kicadSch: the circuit as a KiCad 10 schematic. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyDoc, type CircuitPart, type CircuitWire } from '../core/model'
import { buildNets } from '../core/nets'
import { kicadHatProject } from '../export/kicadHat'
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
  for (const id of [
    'SparkFun-Resistor:10k_Axial_1/6W',
    'SparkFun-LED:LED_Red_5mm_PTH_Silk',
    'SparkFun-Switch:SPST_Push_PTH_12x12mm_h8.0mm',
    'Switch:SW_Push'
  ])
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

test('schematic: US Letter, title block, titled blocks with dashed dividers', () => {
  const doc = buttonCircuit()
  const t = kicadSchematic(
    doc,
    buildNets(doc, { busesFor: circuitBuses }),
    { date: 'd' },
    {
      name: 'b',
      title: 'Blocks',
      company: 'Acme',
      designer: 'Ada'
    }
  ).text
  assert.match(t, /\(paper "USLetter"\)/)
  assert.match(t, /\(rev "v0\.1"\)/)
  assert.match(t, /\(company "Acme"\)/)
  assert.match(t, /\(comment 1 "Designed by: Ada"\)/)
  for (const title of ['LEDs'])
    assert.match(t, new RegExp(`\\(text "${title}"[\\s\\S]*?\\(font \\(size 3 3\\)`))
})

/** A tinyCore with a button and pull-down on D8, and an LED and resistor on D9. */
function hatCircuit(): ReturnType<typeof emptyDoc> {
  const doc = emptyDoc()
  doc.parts = [
    part('U1', 'tinycore'),
    part('SW1', 'tactile-button-6mm'),
    part('R1', 'resistor', { resistance: '10k' }),
    part('R2', 'resistor', { resistance: '330' }),
    part('LED1', 'led-generic-5mm'),
    part('C1', 'capacitor-ceramic-100mil', { capacitance: '100n' })
  ]
  doc.wires = [
    wire('U1:3V3', 'SW1:1a'),
    wire('SW1:2a', 'U1:D8'),
    wire('U1:D8', 'R1:Pin 0'),
    wire('R1:Pin 1', 'U1:GND'),
    wire('U1:D9', 'R2:Pin 0'),
    wire('R2:Pin 1', 'LED1:anode'),
    wire('LED1:cathode', 'U1:GND.2'),
    wire('C1:0', 'U1:3V3.2'),
    wire('C1:1', 'U1:GND.3')
  ]
  return doc
}

test('schematic: supplies point up, GND down, signals between blocks are input global labels', () => {
  const doc = hatCircuit()
  const hat = kicadHatProject(doc, buildNets(doc, { busesFor: circuitBuses }), {}, 'p')
  const t = hat.files['p/p.kicad_sch']
  const power = [...t.matchAll(/\(lib_id "power:(GND|\+3V3)"\)\n\t\t\(at [-\d.]+ [-\d.]+ (\d+)\)/g)]
  assert.ok(power.some((m) => m[1] === 'GND') && power.some((m) => m[1] === '+3V3'))
  for (const m of power) assert.equal(m[2], '0', `${m[1]} drawn upright (its library orientation)`)
  // the supply symbol carries the net's own name
  assert.match(t, /\(lib_id "power:\+3V3"\)[\s\S]*?\(property "Value" "3V3"/)
  const shapes = [...t.matchAll(/\(global_label "([^"]+)"\n\t\t\(shape (\w+)\)/g)]
  assert.deepEqual([...new Set(shapes.map((m) => m[1]))].sort(), ['D8', 'D9'])
  for (const m of shapes) assert.equal(m[2], 'input')
  assert.match(t, /\(stroke \(width 0\) \(type dash\)\)/)
  for (const title of ['tinyCore Headers', 'Buttons', 'LEDs', 'Decoupling'])
    assert.match(t, new RegExp(`\\(text "${title}"`))
  assert.deepEqual(connectivity(t).dangling, [])
})

/** Every point a wire, label, power symbol or flag must meet, checked like ERC's connectivity. */
function connectivity(t: string): { dangling: string[]; pins: number } {
  const key = (x: number, y: number): string => `${Math.round(x * 100)},${Math.round(y * 100)}`
  const wireEnds = new Map<string, number>()
  const onWire: [number, number, number, number][] = []
  for (const m of t.matchAll(
    /\(wire \(pts \(xy ([-\d.]+) ([-\d.]+)\) \(xy ([-\d.]+) ([-\d.]+)\)\)/g
  )) {
    const [x0, y0, x1, y1] = [+m[1], +m[2], +m[3], +m[4]]
    for (const k of [key(x0, y0), key(x1, y1)]) wireEnds.set(k, (wireEnds.get(k) ?? 0) + 1)
    onWire.push([x0, y0, x1, y1])
  }
  const touchesWire = (x: number, y: number): boolean =>
    onWire.some(
      ([x0, y0, x1, y1]) =>
        Math.min(x0, x1) - 1e-6 <= x &&
        x <= Math.max(x0, x1) + 1e-6 &&
        Math.min(y0, y1) - 1e-6 <= y &&
        y <= Math.max(y0, y1) + 1e-6 &&
        Math.abs((x1 - x0) * (y - y0) - (y1 - y0) * (x - x0)) < 1e-6
    )
  const anchors = new Set<string>()
  for (const m of t.matchAll(
    /\((?:global_label|label) "[^"]+"\n\t\t(?:\(shape \w+\)\n\t\t)?\(at ([-\d.]+) ([-\d.]+)/g
  ))
    anchors.add(key(+m[1], +m[2]))
  for (const m of t.matchAll(/\(no_connect \(at ([-\d.]+) ([-\d.]+)\)/g))
    anchors.add(key(+m[1], +m[2]))
  // every placed symbol's pins, from the same library definitions the file embeds
  const pinsAt: string[] = []
  for (const m of t.matchAll(
    /\n\t\(symbol\n\t\t\(lib_id "([^"]+)"\)\n\t\t\(at ([-\d.]+) ([-\d.]+) (\d+)\)(\n\t\t\(mirror x\))?/g
  )) {
    const def = KICAD_LIB_SYMBOLS[m[1]]
    if (!def) continue
    const [X, Y, rot, mirror] = [+m[2], +m[3], +m[4], !!m[5]]
    for (const p of symbolPins(def)) {
      const dx = p.x
      let dy = -p.y
      if (mirror) dy = -dy
      const a = (rot * Math.PI) / 180
      const c = Math.round(Math.cos(a))
      const s = Math.round(Math.sin(a))
      pinsAt.push(key(X + dx * c + dy * s, Y - dx * s + dy * c))
    }
  }
  // everything that connects sits on the 50 mil grid (ERC's connection grid)
  const offGrid = [...pinsAt, ...wireEnds.keys(), ...anchors].filter((k) =>
    k.split(',').some((v) => Math.abs(+v / 127 - Math.round(+v / 127)) > 1e-6)
  )
  const pinSet = new Set(pinsAt)
  const dangling: string[] = []
  for (const p of pinsAt) {
    const [x, y] = p.split(',').map((v) => +v / 100)
    if (
      !wireEnds.has(p) &&
      !anchors.has(p) &&
      !touchesWire(x, y) &&
      pinsAt.filter((q) => q === p).length < 2
    )
      dangling.push(`pin ${p}`)
  }
  for (const a of anchors) {
    const [x, y] = a.split(',').map((v) => +v / 100)
    if (!wireEnds.has(a) && !pinSet.has(a) && !touchesWire(x, y)) dangling.push(`label/flag ${a}`)
  }
  for (const [k, n] of wireEnds) {
    const [x, y] = k.split(',').map((v) => +v / 100)
    const joined =
      n > 1 ||
      pinSet.has(k) ||
      anchors.has(k) ||
      onWire
        .filter(([x0, y0, x1, y1]) => !(key(x0, y0) === k || key(x1, y1) === k))
        .some(() => touchesWire(x, y))
    if (!joined) dangling.push(`wire end ${k}`)
  }
  return { dangling: [...dangling, ...offGrid.map((k) => `off grid ${k}`)], pins: pinsAt.length }
}

test('schematic: nothing dangles, every pin is wired, labelled or flagged', () => {
  const doc = buttonCircuit()
  const t = kicadSchematic(doc, buildNets(doc, { busesFor: circuitBuses }), {}, { name: 'c' }).text
  const { dangling, pins } = connectivity(t)
  assert.equal(pins, 10)
  assert.deepEqual(dangling, [])
})

test('fields go where the KiCad library puts them', () => {
  const r = libField(KICAD_LIB_SYMBOLS['Device:R'], 'Reference')!
  assert.deepEqual([r.x, r.y, r.angle], [2.032, 0, 90])
})
