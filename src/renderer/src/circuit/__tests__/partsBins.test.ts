/** Tests for the palette's bin model in lib/partsLibrary — the thing that
 * decides which tab a part shows up under, plus the search that spans bins.
 * Everything here is the real in-memory registry; no DOM required. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  installedPackBins,
  packBinId,
  packIdOfBin,
  partCountsBySource,
  partsInBin,
  registerPart,
  restampPack,
  searchParts,
  sourceOf,
  unregisterParts,
  type PartDef
} from '../../lib/partsLibrary'

const view = {
  breadboard: { svg: '<svg/>', w: 10, h: 10, pins: { '1': [0, 5], '2': [10, 5] } }
} as PartDef['views']

const def = (type: string, extra: Partial<PartDef> = {}): PartDef => ({
  type,
  label: type,
  family: 'Bin Test',
  views: view,
  ...extra
})

// ── sourceOf ────────────────────────────────────────────────────────────────

test('sourceOf: built-ins get the tiny bin, packs their own, the rest is mine', () => {
  // the tiny* boards are their own tab — 'core' is the bundled Fritzing
  // catalogue, which is stamped straight off the shipped manifest
  assert.equal(sourceOf({ builtin: true }), 'tiny')
  assert.equal(sourceOf({}), 'mine')
  assert.equal(sourceOf({ pack: 'sparkfun-sensors' }), 'pack:sparkfun-sensors')
  // builtin wins — a tinyStudio board is never filed under a pack
  assert.equal(sourceOf({ builtin: true, pack: 'whatever' }), 'tiny')
})

test('packBinId / packIdOfBin round-trip, and leave the fixed bins alone', () => {
  assert.equal(packBinId('arduino'), 'pack:arduino')
  assert.equal(packIdOfBin('pack:arduino'), 'arduino')
  assert.equal(packIdOfBin('core'), undefined)
  assert.equal(packIdOfBin('mine'), undefined)
  // ids containing a colon survive (only the first prefix is stripped)
  assert.equal(packIdOfBin(packBinId('a:b')), 'a:b')
})

// ── bins ────────────────────────────────────────────────────────────────────

test('each pack becomes its own bin, and empties out when uninstalled', () => {
  registerPart(def('bin-a1', { pack: 'pack-a' }))
  registerPart(def('bin-a2', { pack: 'pack-a' }))
  registerPart(def('bin-b1', { pack: 'pack-b' }))
  registerPart(def('bin-mine'))

  const bins = installedPackBins()
  const a = bins.find((b) => b.packId === 'pack-a')
  const b = bins.find((b) => b.packId === 'pack-b')
  assert.equal(a?.count, 2)
  assert.equal(a?.bin, 'pack:pack-a')
  assert.equal(b?.count, 1)

  const counts = partCountsBySource()
  assert.equal(counts['pack:pack-a'], 2)
  assert.ok((counts.mine ?? 0) >= 1)

  // only the requested bin's parts come back
  assert.deepEqual(
    partsInBin('pack:pack-a')
      .map((p) => p.type)
      .sort(),
    ['bin-a1', 'bin-a2']
  )

  unregisterParts(['bin-a1', 'bin-a2', 'bin-b1', 'bin-mine'])
  assert.ok(!installedPackBins().some((x) => x.packId === 'pack-a'))
  assert.equal(partCountsBySource()['pack:pack-a'], undefined)
})

// ── migration restamp ───────────────────────────────────────────────────────

test('restampPack re-bins parts and applies their new presentation', () => {
  registerPart(def('restamp-1', { pack: 'legacy', label: '220 Ω Resistor' }))
  registerPart(def('restamp-2', { pack: 'legacy', label: '220 Ω Resistor' }))
  registerPart(def('restamp-builtin', { builtin: true, pack: 'legacy' }))

  const entries = [
    { type: 'restamp-1', label: '220 Ω Resistor', order: 0 },
    { type: 'restamp-2', label: '220 Ω Resistor', order: 1, variantOf: 'restamp-1' },
    { type: 'restamp-builtin', label: 'nope', order: 9 },
    { type: 'not-registered', label: 'nope', order: 9 }
  ]
  const moved = restampPack(entries, 'core-basic')
  // the built-in is skipped (it ships with the app, it isn't pack content),
  // and an unknown type is simply ignored
  assert.deepEqual(moved.map((d) => d.type).sort(), ['restamp-1', 'restamp-2'])

  // the duplicate is now hidden behind the primary — one tile, not two
  assert.deepEqual(
    partsInBin('pack:core-basic').map((p) => p.type),
    ['restamp-1']
  )
  assert.equal(partsInBin('pack:core-basic', { includeVariants: true }).length, 2)
  assert.equal(partCountsBySource()['pack:legacy'], undefined)

  // idempotent — a second pass changes nothing
  assert.equal(restampPack(entries, 'core-basic').length, 0)

  unregisterParts(['restamp-1', 'restamp-2', 'restamp-builtin'])
})

// ── package variants ────────────────────────────────────────────────────────

test('package variants stay placeable but get no tile of their own', () => {
  registerPart(def('var-primary', { pack: 'pack-v', order: 0 }))
  registerPart(def('var-smd-0603', { pack: 'pack-v', order: 1, variantOf: 'var-primary' }))
  registerPart(def('var-smd-0805', { pack: 'pack-v', order: 2, variantOf: 'var-primary' }))

  // the grid shows one tile…
  assert.deepEqual(
    partsInBin('pack:pack-v').map((p) => p.type),
    ['var-primary']
  )
  // …and the tab count agrees with what's on screen
  assert.equal(partCountsBySource()['pack:pack-v'], 1)
  assert.equal(installedPackBins().find((b) => b.packId === 'pack-v')?.count, 1)
  // …but the hidden ones are still in the registry, so a saved document that
  // references smd-0603 keeps resolving
  assert.equal(partsInBin('pack:pack-v', { includeVariants: true }).length, 3)

  unregisterParts(['var-primary', 'var-smd-0603', 'var-smd-0805'])
})

test('a bin is one flat list ordered by order, then family, then label', () => {
  registerPart(def('ord-c', { pack: 'pack-o', order: 2, label: 'C', family: 'Zeta' }))
  registerPart(def('ord-a', { pack: 'pack-o', order: 0, label: 'A', family: 'Zeta' }))
  registerPart(def('ord-b', { pack: 'pack-o', order: 1, label: 'B', family: 'Alpha' }))
  // no explicit order → sorts after everything that has one
  registerPart(def('ord-z', { pack: 'pack-o', label: 'Z', family: 'Alpha' }))
  registerPart(def('ord-y', { pack: 'pack-o', label: 'Y', family: 'Alpha' }))

  assert.deepEqual(
    partsInBin('pack:pack-o').map((p) => p.type),
    ['ord-a', 'ord-b', 'ord-c', 'ord-y', 'ord-z']
  )

  unregisterParts(['ord-a', 'ord-b', 'ord-c', 'ord-y', 'ord-z'])
})

// ── search ──────────────────────────────────────────────────────────────────

test('searchParts spans every bin and ranks label matches first', () => {
  registerPart(def('srch-zeta', { label: 'Widget Zeta', pack: 'pack-s' }))
  registerPart(def('srch-alpha', { label: 'Zeta Widget' }))
  registerPart(def('srch-tagged', { label: 'Nothing Alike', tags: ['zeta'] }))

  const hits = searchParts('zeta').map((m) => m.type)
  assert.ok(hits.includes('srch-zeta'))
  assert.ok(hits.includes('srch-alpha'))
  assert.ok(hits.includes('srch-tagged'), 'tags are searchable')
  // label-prefix beats label-substring beats tag-only
  assert.ok(hits.indexOf('srch-alpha') < hits.indexOf('srch-tagged'))

  // terms are ANDed, so adding a word narrows
  assert.deepEqual(
    searchParts('zeta widget')
      .map((m) => m.type)
      .sort(),
    ['srch-alpha', 'srch-zeta']
  )
  assert.deepEqual(searchParts(''), [])
  assert.equal(searchParts('zeta', 1).length, 1)

  // Hidden package variants ARE findable — the bin grid folds them behind one
  // tile, so search is the only way back to a specific footprint — but they
  // rank below every primary so they don't crowd out the common answer.
  registerPart(def('srch-hidden', { label: 'Widget Zeta 0805', variantOf: 'srch-zeta' }))
  const withVariant = searchParts('zeta').map((m) => m.type)
  assert.ok(withVariant.includes('srch-hidden'), 'variants are searchable')
  assert.ok(withVariant.indexOf('srch-hidden') > withVariant.indexOf('srch-zeta'))
  assert.ok(withVariant.indexOf('srch-hidden') > withVariant.indexOf('srch-tagged'))
  // and searching for the package finds it directly — alongside the real 0805
  // parts in the bundled catalogue, which is the whole point
  assert.ok(
    searchParts('widget 0805')
      .map((m) => m.type)
      .includes('srch-hidden')
  )

  unregisterParts(['srch-zeta', 'srch-alpha', 'srch-tagged', 'srch-hidden'])
})
