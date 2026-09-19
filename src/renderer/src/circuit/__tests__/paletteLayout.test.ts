/** Tests for views/palette/paletteLayout — Fritzing-style tabs and sections. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PART_MANIFEST,
  getPackInfo,
  registerPart,
  unregisterPart,
  type PackInfo,
  type PartMeta
} from '../../lib/partsLibrary'
import { BREADBOARDS, generateBreadboard } from '../parts/breadboard'
import {
  CORE_TAB,
  MINE_TAB,
  paletteTabs,
  searchParts,
  tabIdFor
} from '../views/palette/paletteLayout'

const part = (type: string, extra: Partial<PartMeta> = {}): PartMeta => ({
  type,
  label: type,
  family: '',
  views: ['breadboard'],
  pins: 2,
  ...extra
})

const PACKS: Record<string, PackInfo> = {
  core: { id: 'core', name: 'Core', group: 'tinyStudio', sections: ['Basic', 'Input'] },
  tinyboards: {
    id: 'tinyboards',
    name: 'tinyBoards',
    group: 'tinyStudio',
    sections: ['tinyCore Boards']
  },
  'sparkfun-sensors': { id: 'sparkfun-sensors', name: 'SparkFun · Sensors', group: 'SparkFun' },
  'sparkfun-rf': { id: 'sparkfun-rf', name: 'SparkFun · RF', group: 'SparkFun' },
  arduino: { id: 'arduino', name: 'Arduino', group: 'Vendors', sections: ['Boards', 'Shields'] },
  seeed: { id: 'seeed', name: 'Seeed Studio', group: 'Vendors' }
}
const lookup = (id: string): PackInfo | undefined => PACKS[id]

test('tabs: Core and Mine first, then Arduino and SparkFun, SparkFun packs sharing one tab', () => {
  const tabs = paletteTabs(
    [
      part('seeeduino', { bin: 'seeed' }),
      part('mic', { bin: 'sparkfun-sensors' }),
      part('radio', { bin: 'sparkfun-rf' }),
      part('uno', { bin: 'arduino' }),
      part('resistor', { bin: 'core', section: 'Basic' })
    ],
    lookup
  )
  assert.deepEqual(
    tabs.map((t) => t.id),
    [CORE_TAB, MINE_TAB, 'arduino', 'sparkfun', 'seeed']
  )
  const sparkfun = tabs.find((t) => t.id === 'sparkfun')!
  // a pack without sections becomes a section named after it inside a shared tab
  assert.deepEqual(
    sparkfun.sections.map((s) => s.title),
    ['RF', 'Sensors']
  )
})

test('sections follow the pack.json order, parts their listing position', () => {
  const tabs = paletteTabs(
    [
      part('ldr', { bin: 'core', section: 'Input', position: 3 }),
      part('capacitor', { bin: 'core', section: 'Basic', position: 1 }),
      part('resistor', { bin: 'core', section: 'Basic', position: 0 }),
      part('tinycore', { bin: 'tinyboards', section: 'tinyCore Boards', position: 0 }),
      part('breadboard', { bin: 'core', section: 'Breadboard View' })
    ],
    lookup
  )
  const core = tabs.find((t) => t.id === CORE_TAB)!
  assert.deepEqual(
    core.sections.map((s) => [s.title, s.parts.map((p) => p.type)]),
    [
      // tinyBoards sorts before Core, so its declared section comes first
      ['tinyCore Boards', ['tinycore']],
      ['Basic', ['resistor', 'capacitor']],
      ['Input', ['ldr']],
      // not declared by any pack: after the declared ones
      ['Breadboard View', ['breadboard']]
    ]
  )
})

test('parts without a pack go to Mine; variants get no tile but search finds them', () => {
  const manifest = [
    part('my-sensor', { label: 'My Sensor' }),
    part('cap', { bin: 'core', label: 'Capacitor' }),
    part('cap-0805', { bin: 'core', label: 'Capacitor (0805)', variantOf: 'cap' })
  ]
  const tabs = paletteTabs(manifest, lookup)
  assert.deepEqual(
    tabs.find((t) => t.id === MINE_TAB)!.sections[0].parts.map((p) => p.type),
    ['my-sensor']
  )
  const coreTypes = tabs.find((t) => t.id === CORE_TAB)!.sections.flatMap((s) => s.parts)
  assert.deepEqual(
    coreTypes.map((p) => p.type),
    ['cap']
  )
  assert.deepEqual(
    searchParts(manifest, 'capacitor 0805', lookup).map((p) => p.type),
    ['cap-0805']
  )
  assert.deepEqual(
    searchParts(manifest, 'cap', lookup).map((p) => p.type),
    ['cap', 'cap-0805']
  )
})

test('search-only parts (simulation sources, probes) get no tile but search finds them', () => {
  const manifest = [
    part('resistor', { bin: 'core', section: 'Basic' }),
    part('sim-probe-v', { bin: 'core', label: 'Voltage Probe', searchOnly: true })
  ]
  const core = paletteTabs(manifest, lookup).find((t) => t.id === CORE_TAB)!
  assert.deepEqual(
    core.sections.flatMap((s) => s.parts).map((p) => p.type),
    ['resistor']
  )
  assert.deepEqual(
    searchParts(manifest, 'probe', lookup).map((p) => p.type),
    ['sim-probe-v']
  )
})

test('tabIdFor: packs in the tinyStudio group share Core, unknown packs get their own tab', () => {
  assert.equal(tabIdFor(undefined, undefined), MINE_TAB)
  assert.equal(tabIdFor('core', undefined), CORE_TAB)
  assert.equal(
    tabIdFor('my-pack', { id: 'my-pack', name: 'Mine too', group: 'Vendors' }),
    'my-pack'
  )
})

test('bundled packs: Core opens with the tinyCore boards, then Fritzing Core order', () => {
  const { def } = generateBreadboard(BREADBOARDS[0])
  registerPart(def)
  try {
    const core = paletteTabs(PART_MANIFEST, getPackInfo).find((t) => t.id === CORE_TAB)!
    const titles = core.sections.map((s) => s.title)
    assert.deepEqual(titles.slice(0, 5), ['tinyCore Boards', 'Basic', 'Input', 'Output', 'Power'])
    assert.ok(titles.includes('Breadboard View'), 'generated breadboards sit in Breadboard View')
    assert.equal(core.sections[0].parts[0].type, 'tinycore')
    assert.equal(core.sections[1].parts[0].type, 'resistor')
    assert.ok(!titles.includes('Measuring Tools'), 'probes are search-only')
    // every bundled part has a place
    const placed = core.sections.flatMap((s) => s.parts).filter((p) => p.layer === 'bundled')
    assert.equal(placed.length, PART_MANIFEST.filter((p) => p.layer === 'bundled').length)
  } finally {
    unregisterPart(def.type)
  }
})

test('a local edit of a shipped part stays in its tab and section', () => {
  registerPart({
    type: 'resistor',
    label: 'Resistor (edited)',
    origin: 'edit',
    views: { breadboard: { svg: '<svg/>', w: 10, h: 10, pins: { a: [0, 0], b: [10, 0] } } }
  })
  try {
    const meta = PART_MANIFEST.find((p) => p.type === 'resistor')!
    assert.equal(meta.layer, 'user')
    assert.equal(meta.bin, 'core')
    assert.equal(meta.section, 'Basic')
  } finally {
    unregisterPart('resistor')
  }
})
