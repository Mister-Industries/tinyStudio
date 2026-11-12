/** Tests for export/kicadHat and export/zip: a tinyCore circuit as a KiCad HAT project. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyDoc, type CircuitPart, type CircuitWire } from '../core/model'
import { buildNets } from '../core/nets'
import { kicadHatProject } from '../export/kicadHat'
import { crc32, zipFiles } from '../export/zip'
import { circuitBuses } from '../views/partsAdapter'

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
  assert.match(
    hat.files['Blinky-HAT/sym-lib-table'],
    /\(lib \(name "Device"\) \(type "KiCad"\) \(uri "\$\{KICAD10_SYMBOL_DIR\}\/Device\.kicad_sym"\)/
  )
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
      `\\(lib_id "Connector_Generic:Conn_01x0\\d"\\)[\\s\\S]*?\\(uuid "([^"]+)"\\)\\s*\\(property "Reference" "${j}"`
    ).exec(sch)![1]
    assert.ok(pcb.includes(`(path "/${symUuid}")`), `${j} linked`)
  }
  assert.equal((pcb.match(/\(sheetfile "Blinky-HAT\.kicad_sch"\)/g) ?? []).length, 3)
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
