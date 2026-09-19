/**
 * Tests for parts/naming: the human-readable label + category layer, and its
 * contract with the two systems that used to read the raw Fritzing family:
 * SPICE emitter matching (netlist) and refdes assignment.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CATEGORY_ORDER,
  compareCategories,
  humanizeCategory,
  humanizeLabel,
  resolveNaming
} from '../parts/naming'
import { PART_MANIFEST, partsByFamily, registerPart, type PartDef } from '../../lib/partsLibrary'
import { prefixForFamily } from '../core/refdes'
import { simAttrsFor } from '../core/netlist'

test('curated parts get a real name, not the Fritzing slug', () => {
  assert.equal(resolveNaming('led-generic-5mm', 'led', 'LED').label, 'LED (5 mm)')
  assert.equal(resolveNaming('battery-aa', 'Battery', 'Battery').label, '2× AA Battery Pack (3 V)')
  assert.equal(
    resolveNaming('sparkfun-discretesemi-mosfet-nchannel-pth', 'MOSFET-NCHANNEL', 'sparkfun Mosfet')
      .label,
    'N-Channel MOSFET'
  )
  // a value never belongs in the name; it lives in attrs
  assert.equal(resolveNaming('resistor', '220 Ω Resistor', 'Resistor').label, 'Resistor')
})

test('humanizeLabel handles slugs, acronyms, units and Fritzing noise suffixes', () => {
  assert.equal(humanizeLabel('led'), 'LED')
  assert.equal(humanizeLabel('battery-aa_y90'), 'Battery AA')
  assert.equal(humanizeLabel('ir_receiver'), 'IR Receiver')
  assert.equal(humanizeLabel('resistor-3mm'), 'Resistor 3 mm')
  assert.equal(humanizeLabel('transistor-to92'), 'Transistor TO-92')
  // deliberate mixed case survives untouched
  assert.equal(humanizeLabel('tinyCore'), 'tinyCore')
})

test('unknown families map onto a display category', () => {
  assert.equal(humanizeCategory('Capacitor [bidirectional]'), 'Passive Elements')
  assert.equal(humanizeCategory('microcontroller board (lilypad)'), 'Integrated Circuits')
  assert.equal(humanizeCategory('sparkfun Electret Mic'), 'Audio')
  assert.equal(humanizeCategory('TE General Purpose Relays'), 'Relays')
  assert.equal(humanizeCategory(''), 'Uncategorized')
})

test('every shipped part has a readable label and a known category', () => {
  for (const meta of PART_MANIFEST) {
    assert.ok(
      !/^[a-z0-9]+([_-][a-z0-9]+)+$/.test(meta.label),
      `${meta.type} still shows a slug label: ${meta.label}`
    )
    assert.ok(meta.label.trim().length > 1, `${meta.type} has an empty label`)
    assert.ok(
      CATEGORY_ORDER.includes(meta.family),
      `${meta.type} landed in an uncurated category: ${meta.family}`
    )
  }
})

test('the components rail lists categories in the curated order', () => {
  const groups = partsByFamily().map((g) => g.family)
  const ranks = groups.map((g) => CATEGORY_ORDER.indexOf(g))
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i] > ranks[i - 1], `${groups[i]} sorts before ${groups[i - 1]}`)
  }
  assert.equal(compareCategories('Breadboards', 'Sources') < 0, true)
})

test('renaming a category cannot change how a part simulates', () => {
  // The display category is "Passive Elements"; the sim keywords must still
  // read as a resistor so the netlist emitter (and its attrs) match.
  const r = resolveNaming('resistor', '220 Ω Resistor', 'Resistor')
  assert.equal(r.category, 'Passive Elements')
  assert.deepEqual(
    simAttrsFor('resistor', r.sim).map((a) => a.key),
    ['resistance']
  )
  // LEDs show under "Diodes" but must not be emitted as a plain diode
  const led = resolveNaming('led-generic-5mm', 'led', 'LED')
  assert.equal(led.category, 'Diodes')
  assert.equal(led.prefix, 'LED')
  assert.equal(prefixForFamily(`${led.sim} led-generic-5mm`, led.prefix), 'LED')
  // the relay is 4-pin: it must stay clear of the 2-terminal switch emitter
  const relay = resolveNaming('te-relay', 'RELAY', 'TE General Purpose Relays')
  assert.equal(relay.category, 'Relays')
  assert.equal(simAttrsFor('te-relay', relay.sim).length, 0)
})

test('registerPart applies naming to dropped/imported parts', () => {
  const raw: PartDef = {
    type: 'my-photo-transistor',
    label: 'my-photo-transistor',
    family: 'Bipolar Transistor',
    views: { breadboard: { svg: '<svg/>', w: 10, h: 10, pins: { E: [0, 0], C: [10, 0] } } }
  }
  registerPart(raw)
  const meta = PART_MANIFEST.find((m) => m.type === 'my-photo-transistor')
  assert.ok(meta)
  assert.equal(meta!.label, 'My Photo Transistor')
  assert.equal(meta!.family, 'Transistors')
  // provenance kept for sim matching
  assert.equal(meta!.simFamily, 'Bipolar Transistor')
})
