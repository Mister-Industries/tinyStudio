/** Tests for export/kicadHat and export/zip: a tinyCore circuit as a KiCad HAT project. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyDoc, type CircuitPart, type CircuitWire } from '../core/model'
import { buildNets } from '../core/nets'
import { kicadHatProject } from '../export/kicadHat'
import { crc32, zipFiles } from '../export/zip'
import { circuitBuses, implicitSeats, pinWorldOf } from '../views/partsAdapter'
import { ensureParts } from '../../lib/partsLibrary'

let wid = 0
const wire = (from: string, to: string): CircuitWire => ({ id: `w${++wid}`, from, to, view: 'bb' })
const part = (id: string, type: string, attrs?: CircuitPart['attrs']): CircuitPart => ({
  id,
  type,
  attrs,
  bb: { x: 0, y: 0 }
})

/** D8 → R1 → LED1 → GND on a tinyCore */
function ledCircuit(): ReturnType<typeof emptyDoc> {
  const doc = emptyDoc()
  doc.parts = [
    part('U1', 'tinycore'),
    part('R1', 'resistor', { resistance: '1k' }),
    part('LED1', 'led-generic-5mm')
  ]
  doc.wires = [
    wire('U1:D8', 'R1:Pin 0'),
    wire('R1:Pin 1', 'LED1:anode'),
    wire('LED1:cathode', 'U1:GND.2')
  ]
  return doc
}

test('HAT: the tinyCore becomes J1-J3 and its nets reach the header pads', () => {
  const doc = ledCircuit()
  const hat = kicadHatProject(
    doc,
    buildNets(doc, { busesFor: circuitBuses }),
    { date: '2026-11-02' },
    'Blinky HAT'
  )
  const files = Object.keys(hat.files)
  assert.deepEqual(files.sort(), [
    'Blinky-HAT/Blinky-HAT.kicad_pcb',
    'Blinky-HAT/Blinky-HAT.kicad_pro',
    'Blinky-HAT/Blinky-HAT.kicad_sch',
    'Blinky-HAT/Blinky-HAT.net',
    'Blinky-HAT/README.txt',
    'Blinky-HAT/sym-lib-table'
  ])
  assert.deepEqual(hat.keepIfExists.sort(), [
    'Blinky-HAT/Blinky-HAT.kicad_pcb',
    'Blinky-HAT/Blinky-HAT.kicad_pro',
    'Blinky-HAT/fp-lib-table',
    'Blinky-HAT/sym-lib-table'
  ])
  // only KiCad's own libraries go in the table: SparkFun's are the user's install
  assert.match(
    hat.files['Blinky-HAT/sym-lib-table'],
    /\(lib \(name "power"\) \(type "KiCad"\) \(uri "\$\{KICAD10_SYMBOL_DIR\}\/power\.kicad_sym"\)/
  )
  assert.doesNotMatch(hat.files['Blinky-HAT/sym-lib-table'], /SparkFun/)
  const net = hat.files['Blinky-HAT/Blinky-HAT.net']
  // the board itself is not a component; its headers are
  assert.doesNotMatch(net, /\(ref "U1"\)/)
  for (const j of ['J1', 'J2', 'J3']) assert.match(net, new RegExp(`\\(comp \\(ref "${j}"\\)`))
  // D8 is J2 pad 8; GND.2 is J2 pad 1, bussed with the other GND pins
  assert.match(
    net,
    /\(name "D8"\)\s*\n\s*\(node \(ref "J2"\) \(pin "8"\)\)\s*\n\s*\(node \(ref "R1"\)/
  )
  assert.match(net, /\(name "GND"\)[\s\S]*?\(node \(ref "J1"\) \(pin "1"\)\)/)

  const pcb = hat.files['Blinky-HAT/Blinky-HAT.kicad_pcb']
  assert.match(pcb, /\(title "Blinky HAT"\)/)
  assert.equal((pcb.match(/"Edge\.Cuts"/g) ?? []).length >= 8, true)
  assert.doesNotMatch(pcb, /\{\{/, 'every placeholder filled or dropped')
  // the header pad on D8's net carries the same name the netlist gave it
  const d8 =
    /\(net \(code "\d+"\) \(name "([^"]+)"\)\s*\n\s*\(node \(ref "J2"\) \(pin "8"\)\)/.exec(net)![1]
  assert.ok(pcb.includes(`(net "${d8}")`), d8)
  // brackets balance: KiCad rejects a file that doesn't
  let depth = 0
  for (const ch of pcb.replace(/"(?:[^"\\]|\\.)*"/g, ''))
    depth += ch === '(' ? 1 : ch === ')' ? -1 : 0
  assert.equal(depth, 0)
  const pro = JSON.parse(hat.files['Blinky-HAT/Blinky-HAT.kicad_pro'])
  assert.equal(pro.meta.filename, 'Blinky-HAT.kicad_pro')
  // the project's one sheet is this schematic, not tinyMove's
  const sch = hat.files['Blinky-HAT/Blinky-HAT.kicad_sch']
  const sheetUuid = /^\t\(uuid "([^"]+)"\)/m.exec(sch)![1]
  assert.deepEqual(pro.schematic.top_level_sheets, [
    { filename: 'Blinky-HAT.kicad_sch', name: 'Blinky-HAT', uuid: sheetUuid }
  ])
  assert.equal(pro.schematic.used_designators, '')
  assert.doesNotMatch(hat.files['Blinky-HAT/Blinky-HAT.kicad_pro'], /tinyMove/)
  // each header footprint is linked to its schematic symbol
  for (const j of ['J1', 'J2', 'J3']) {
    const symUuid = new RegExp(
      `\\(lib_id "SparkFun-Connector:Conn_01x0\\d_P2\\.54mm"\\)[\\s\\S]*?\\(uuid "([^"]+)"\\)\\s*\\(property "Reference" "${j}"`
    ).exec(sch)![1]
    assert.ok(pcb.includes(`(path "/${symUuid}")`), `${j} linked`)
  }
  // the three headers and the two parts, each linked to its symbol
  assert.equal((pcb.match(/\(sheetfile "Blinky-HAT\.kicad_sch"\)/g) ?? []).length, 5)
  // the parts come on the board, on their nets, fields hidden (SLK-406)
  assert.match(pcb, /\(footprint "SparkFun-Resistor:R_Axial_DIN0207[^"]*"/)
  assert.match(pcb, /\(footprint "SparkFun-LED:LED_5mm_PTH_Red_Silk"/)
  assert.match(
    pcb,
    /\(property "Reference" "R1"\n\t\t\t\(at [^\n]*\n\t\t\t\(layer "F\.Fab"\)\n\t\t\t\(hide yes\)/
  )
  assert.match(pcb, /\(pad "1" thru_hole[\s\S]*?\(net "D8"\)/)
  // GND pours on both sides, the name on the silk, the version in bottom copper
  assert.equal((pcb.match(/\(zone\n\t\t\(net "GND"\)/g) ?? []).length, 2)
  assert.match(pcb, /\(gr_text "Blinky HAT"[\s\S]*?\(layer "F\.SilkS"\)/)
  assert.match(pcb, /\(gr_text "v0\.1"[\s\S]*?\(layer "B\.Cu" knockout\)/)
  assert.match(pcb, /\(rev "v0\.1"\)/)
  // design rules: 6/10/22/50 mil tracks, 24/12 mil vias, power nets 10 mil
  assert.deepEqual(pro.board.design_settings.track_widths, [0, 0.1524, 0.254, 0.5588, 1.27])
  assert.deepEqual(pro.board.design_settings.via_dimensions[1], { diameter: 0.6096, drill: 0.3048 })
  assert.ok(
    pro.net_settings.netclass_patterns.some((p: { pattern: string }) => p.pattern === 'GND')
  )
  assert.deepEqual(pro.board.design_settings.drc_exclusions, [])
})

test('HAT: a circuit already using J1 pushes the headers to free refs', () => {
  const doc = ledCircuit()
  doc.parts.push(part('J1', 'screw-terminal-2'))
  const hat = kicadHatProject(doc, buildNets(doc, { busesFor: circuitBuses }), {}, 'x')
  const net = hat.files['x/x.net']
  assert.match(net, /\(comp \(ref "J101"\)/)
  assert.match(hat.files['x/x.kicad_pcb'], /\(property "Reference" "J101"/)
})

test('zip: stored entries with correct CRCs and a central directory', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  const z = zipFiles({ 'a/b.txt': 'hello', 'c.txt': 'world!' }, new Date(2026, 10, 2, 12, 0, 0))
  const v = new DataView(z.buffer)
  assert.equal(v.getUint32(0, true), 0x04034b50)
  const end = z.length - 22
  assert.equal(v.getUint32(end, true), 0x06054b50)
  assert.equal(v.getUint16(end + 10, true), 2)
  const cd = v.getUint32(end + 16, true)
  assert.equal(v.getUint32(cd, true), 0x02014b50)
})

test('HAT: stock KiCad footprints get a project fp-lib-table; SparkFun ones do not', () => {
  const doc = ledCircuit()
  doc.parts.push(part('SW1', 'tactile-button-6mm'), part('SW2', 'tactile-button-12mm'))
  doc.wires.push(wire('SW1:2a', 'U1:D9'), wire('SW2:2a', 'U1:D10'))
  const hat = kicadHatProject(doc, buildNets(doc, { busesFor: circuitBuses }), {}, 'b')
  const table = hat.files['b/fp-lib-table']
  assert.ok(table, 'written when a stock footprint is used')
  assert.match(table, /^\(fp_lib_table\n\t\(version 7\)/)
  assert.match(
    table,
    /\(lib \(name "Button_Switch_THT"\) \(type "KiCad"\) \(uri "\$\{KICAD10_FOOTPRINT_DIR\}\/Button_Switch_THT\.pretty"\)/
  )
  assert.doesNotMatch(table, /SparkFun/)
  assert.match(hat.files['b/b.net'], /SparkFun-Switch:Push_PTH_12x12mm/)
})

test('HAT: a part on a tinyProto lands on the board across the holes its legs are in', async () => {
  await ensureParts(['tinycore', 'tinyproto', 'resistor'])
  const core: CircuitPart = { id: 'U1', type: 'tinycore', bb: { x: 96, y: 96 } }
  const proto: CircuitPart = { id: 'P1', type: 'tinyproto', bb: { x: 96, y: 96 } }
  // a resistor across H.5 to L.5, four holes (10.16 mm) apart
  const r: CircuitPart = {
    id: 'R1',
    type: 'resistor',
    attrs: { resistance: '10k' },
    bb: { x: 0, y: 0 }
  }
  const p0 = pinWorldOf(r, 'Pin 0')!
  const h = pinWorldOf(proto, 'H.5')!
  r.bb = { x: h.x - p0.x, y: h.y - p0.y }
  const doc = emptyDoc()
  doc.parts = [core, proto, r]
  doc.wires = [
    { id: 'a', from: 'P1:D8', to: 'P1:H.5', view: 'bb', side: 'back' },
    { id: 'b', from: 'P1:GND', to: 'P1:L.5', view: 'bb', side: 'back' }
  ]
  const seats = implicitSeats(doc)
  const nets = buildNets(doc, {
    busesFor: circuitBuses,
    implicit: seats.map((s): [string, string] => [s.pin, s.hole])
  })
  // as the app does: a leg seated in a hole is at that hole
  const seatAt = new Map(seats.map((s) => [s.pin, s.pos]))
  const pinAt = (id: string, pin: string): { x: number; y: number } | null => {
    const p = doc.parts.find((q) => q.id === id)
    return seatAt.get(`${id}:${pin}`) ?? (p ? pinWorldOf(p, pin) : null)
  }
  const hat = kicadHatProject(doc, nets, { pinAt }, 'onboard')
  const pcb = hat.files['onboard/onboard.kicad_pcb']
  assert.ok(!hat.warnings.some((w) => /below the board/.test(w)), hat.warnings.join('; '))
  const at =
    /\(footprint "SparkFun-Resistor:[^"]*"[\s\S]*?\(at ([-\d.]+) ([-\d.]+)(?: (\d+))?\)/.exec(pcb)!
  // H.5 is 7 holes right of J1 pin 1 (GND, 126.26, 96.14): the resistor is
  // centred between H.5 and L.5, on the row, lying flat
  const holeX = (col: number): number => 126.26 + (24 + col * 9.6 - 7.2) * (25.4 / 96)
  assert.ok(Math.abs(+at[1] - (holeX(7) + holeX(11)) / 2) < 0.1, `x ${at[1]}`)
  assert.ok(Math.abs(+at[2] - 96.13) < 0.1, `y ${at[2]}`)
  assert.ok(!at[3] || +at[3] % 180 === 0, `rotation ${at[3]}`)
  // its pads are on the nets of the holes it sits in
  assert.match(pcb, /\(footprint "SparkFun-Resistor:[\s\S]*?\(net "D8"\)[\s\S]*?\(net "GND"\)/)
})

test('HAT: every placed pad carries its net, even in footprints whose pads have no uuid', () => {
  const doc = emptyDoc()
  doc.parts = [part('U1', 'tinycore'), part('C1', 'capacitor-electrolytic-medium')]
  doc.wires = [wire('U1:3V3', 'C1:+'), wire('C1:-', 'U1:GND.2')]
  const hat = kicadHatProject(doc, buildNets(doc, { busesFor: circuitBuses }), {}, 'Cap HAT')
  const pcb = hat.files['Cap-HAT/Cap-HAT.kicad_pcb'] as string
  const c1 = pcb.slice(pcb.indexOf('(property "Reference" "C1"'))
  const pads = c1.slice(0, c1.indexOf('\n\t)\n')).match(/\(pad "[^"]*"[\s\S]*?\n\t\t\)/g) ?? []
  assert.equal(pads.length, 2)
  assert.match(pads.join(), /\(net "3V3"\)/)
  assert.match(pads.join(), /\(net "GND"\)/)
})

test('HAT: an unused header pin is a no-connect named as KiCad names it, its pin name noted', () => {
  const doc = ledCircuit()
  const hat = kicadHatProject(doc, buildNets(doc, { busesFor: circuitBuses }), {}, 'Blinky HAT')
  const pcb = hat.files['Blinky-HAT/Blinky-HAT.kicad_pcb'] as string
  const sch = hat.files['Blinky-HAT/Blinky-HAT.kicad_sch'] as string
  // A5 is J1 pin 3 and nothing uses it
  assert.match(pcb, /\(net "unconnected-\(J1-Pin_3-Pad3\)"\)/)
  assert.doesNotMatch(pcb, /\(net "A5"\)/)
  assert.match(sch, /\(text "A5"/)
  assert.doesNotMatch(sch, /\(global_label "A5"/)
  // D8 is wired: it keeps its name
  assert.match(pcb, /\(net "D8"\)/)
})
