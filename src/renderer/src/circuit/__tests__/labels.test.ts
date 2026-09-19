/** Tests for schematic text: value formatting and where labels sit. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CircuitPart } from '../core/model'
import { formatValue, labelLayout, refdesOf, valueOf, visibleBox } from '../parts/labels'

test('values print as an engineer writes them', () => {
  assert.equal(formatValue('220', 'Ω'), '220 Ω')
  assert.equal(formatValue('10k', 'Ω'), '10 kΩ')
  assert.equal(formatValue('100n', 'F'), '100 nF')
  assert.equal(formatValue('10u', 'F'), '10 µF')
  assert.equal(formatValue('1k', 'Hz'), '1 kHz')
  assert.equal(formatValue('4.7Meg', 'Ω'), '4.7 MΩ')
  assert.equal(formatValue('5', 'V'), '5 V')
})

test('the printed value is the value that gets simulated', () => {
  const r: CircuitPart = { id: 'R1', type: 'resistor', attrs: { resistance: '4.7k' } }
  assert.equal(valueOf(r, 'Resistor'), '4.7 kΩ')
  // unset falls back to the same default the netlist emitter uses
  const bare: CircuitPart = { id: 'R2', type: 'resistor' }
  assert.equal(valueOf(bare, 'Resistor'), '220 Ω')
  // a 2xAA pack is 3 V, not the generic source default
  const bat: CircuitPart = { id: 'BT1', type: 'battery-aa' }
  assert.equal(valueOf(bat, 'battery'), '3 V')
})

test('sources print both terms; settings are not values', () => {
  const v: CircuitPart = { id: 'V1', type: 'sim-vsin', attrs: { amplitude: '5', frequency: '1k' } }
  assert.equal(valueOf(v, 'sim-vsin'), '5 V 1 kHz')
  // a wiper position (0–1) and a switch state (true/false) belong in the
  // inspector, not on the sheet
  const pot: CircuitPart = { id: 'RV1', type: 'potentiometer-rotary-16mm-5' }
  assert.equal(valueOf(pot, 'potentiometer'), '10 kΩ')
  const sw: CircuitPart = { id: 'SW1', type: 'switch-spst' }
  assert.equal(valueOf(sw, 'switch'), '')
})

test('a part with nothing to say prints no value line', () => {
  const led: CircuitPart = { id: 'LED1', type: 'led-generic-5mm' }
  assert.equal(valueOf(led, 'led'), '')
  assert.equal(refdesOf(led), 'LED1')
  // an explicit label wins over the refdes
  assert.equal(refdesOf({ ...led, attrs: { label: 'Status' } }), 'Status')
})

test('rotating a symbol moves the box its labels hang off', () => {
  assert.deepEqual(visibleBox(57.6, 19.2, 0), { left: 0, top: 0, w: 57.6, h: 19.2 })
  const turned = visibleBox(57.6, 19.2, 90)
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6
  assert.ok(near(turned.w, 19.2))
  assert.ok(near(turned.h, 57.6))
  assert.ok(near(turned.left, 19.2))
  assert.ok(near(turned.top, -19.2))
})

test('vertical parts get their text beside them, not under the wire', () => {
  const horizontal = labelLayout(57.6, 19.2, { a: [0, 9.6], b: [57.6, 9.6] })
  assert.equal(horizontal.side, false)
  assert.ok(horizontal.refdes[1] < 0, 'refdes sits above the symbol')
  assert.ok(horizontal.value[1] > 19.2, 'value sits below the symbol')

  // same resistor, stood on end: text must move to the side
  const rotated = labelLayout(57.6, 19.2, { a: [0, 9.6], b: [57.6, 9.6] }, 90)
  assert.equal(rotated.side, true)
  assert.ok(rotated.refdes[0] > rotated.box.left + rotated.box.w - 1, 'text clears the symbol')

  // a source drawn tall is vertical without any rotation at all
  const source = labelLayout(38.4, 57.6, { '+': [19.2, 0], '-': [19.2, 57.6] })
  assert.equal(source.side, true)
})
