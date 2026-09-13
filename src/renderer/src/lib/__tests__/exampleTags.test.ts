/**
 * Tests for the Examples tag vocabulary and the search/filter layer.
 *
 * The two things worth pinning down here are the ones that silently degrade:
 * tag *canonicalisation* (if "I2C", "Wire" and "i2c" stop folding onto one
 * slug, filters split in two and neither shows the full set) and the colour
 * contract (a board tag whose --board-* family doesn't exist renders as an
 * uncoloured chip, which looks like a styling bug rather than a data one).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ALL_TAGS,
  canonicalizeTags,
  compareTags,
  getTagMeta,
  slugifyTag,
  tagChipStyle
} from '../exampleTags'
import { matchesQuery, normalizeManifest, searchHaystack, type ExampleEntry } from '../examples'

const entry = (over: Partial<ExampleEntry> = {}): ExampleEntry => ({
  title: 'Blink LED',
  description: 'Blink the onboard LED.',
  owner: 'Mister-Industries',
  repo: 'tinyStudio',
  path: 'demo/Blink Example',
  tags: ['tinycore', 'blink', 'led'],
  ...over
})

// ── vocabulary ───────────────────────────────────────────────────────────────

test('tag slugs are unique across the vocabulary', () => {
  const slugs = ALL_TAGS.map((t) => t.slug)
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate tag slug')
})

test('no alias collides with another tag’s slug or alias', () => {
  const seen = new Map<string, string>()
  for (const t of ALL_TAGS) {
    for (const key of [t.slug, ...(t.aliases ?? [])]) {
      const owner = seen.get(key)
      assert.equal(owner, undefined, `"${key}" is claimed by both ${owner} and ${t.slug}`)
      seen.set(key, t.slug)
    }
  }
})

test('slugify folds punctuation, case and the I²C superscript', () => {
  assert.equal(slugifyTag('I²C'), 'i2c')
  assert.equal(slugifyTag('  SD Card '), 'sd-card')
  assert.equal(slugifyTag('ESP-NOW'), 'esp-now')
  assert.equal(slugifyTag('Qwiic Joystick'), 'qwiic-joystick')
})

test('aliases fold onto one canonical slug', () => {
  assert.equal(getTagMeta('Wire').slug, 'i2c')
  assert.equal(getTagMeta('I²C').slug, 'i2c')
  assert.equal(getTagMeta('ble').slug, 'bluetooth')
  assert.equal(getTagMeta('ESP32-S3').slug, 'tinycore')
  assert.equal(getTagMeta('qwiic-joystick').slug, 'qwiic')
})

test('an unknown tag still resolves — as a neutral topic, never dropped', () => {
  const meta = getTagMeta('Time Of Flight')
  assert.equal(meta.slug, 'time-of-flight')
  assert.equal(meta.kind, 'topic')
  assert.equal(tagChipStyle(meta), undefined, 'unknown tags must not claim a board colour')
})

test('canonicalizeTags de-duplicates through aliases and keeps order', () => {
  assert.deepEqual(canonicalizeTags(['Wire', 'i2c', 'I²C', 'PWM']), ['i2c', 'pwm'])
  assert.deepEqual(canonicalizeTags(undefined), [])
})

// ── colour contract ──────────────────────────────────────────────────────────

test('every board tag maps to a --board-* colour family', () => {
  for (const t of ALL_TAGS.filter((t) => t.kind === 'board')) {
    assert.ok(t.colorKey, `${t.slug} is a board tag but has no colorKey`)
    const style = tagChipStyle(t) as Record<string, string> | undefined
    assert.ok(style, `${t.slug} produced no chip style`)
    assert.equal(style['--tag-soft'], `var(--board-${t.colorKey}-soft)`)
    assert.equal(style['--tag-line'], `var(--board-${t.colorKey})`)
    assert.equal(style['--tag-ink'], `var(--board-${t.colorKey}-on)`)
  }
})

test('topic tags stay neutral — colour is reserved for hardware', () => {
  for (const t of ALL_TAGS.filter((t) => t.kind === 'topic')) {
    assert.equal(tagChipStyle(t), undefined, `${t.slug} must not be coloured`)
  }
})

test('boards sort ahead of topics so the chip row leads with hardware', () => {
  const sorted = ['pwm', 'tinysniff', 'i2c', 'tinycore'].sort(compareTags)
  assert.deepEqual(sorted.slice(0, 2), ['tinycore', 'tinysniff'])
})

// ── search ───────────────────────────────────────────────────────────────────

test('search matches title, description and tags', () => {
  const ex = entry()
  assert.ok(matchesQuery(ex, 'blink'))
  assert.ok(matchesQuery(ex, 'onboard'))
  assert.ok(matchesQuery(ex, 'tinycore'))
  assert.ok(!matchesQuery(ex, 'tinysniff'))
})

test('search finds a tag by its alias, not just its slug', () => {
  const ex = entry({ tags: ['bluetooth'], title: 'Mood light', description: 'Colour control.' })
  assert.ok(matchesQuery(ex, 'ble'), 'alias should be searchable')
  assert.ok(matchesQuery(ex, 'bluetooth'))
})

test('multiple terms AND together, in any order', () => {
  const ex = entry({ title: 'WiFi web server', tags: ['tinycore', 'wifi', 'web-server'] })
  assert.ok(matchesQuery(ex, 'server wifi'))
  assert.ok(matchesQuery(ex, 'wifi server'))
  assert.ok(!matchesQuery(ex, 'wifi bluetooth'))
})

test('an empty or whitespace query matches everything', () => {
  assert.ok(matchesQuery(entry(), ''))
  assert.ok(matchesQuery(entry(), '   '))
})

test('search is case-insensitive and matches partial words while typing', () => {
  const ex = entry({ title: 'Potentiometer reading', tags: ['tinycore', 'potentiometer'] })
  assert.ok(matchesQuery(ex, 'POTENT'))
  assert.ok(matchesQuery(ex, 'Potentiometer'))
})

test('an untagged entry is still searchable on its board field', () => {
  const ex = entry({ tags: undefined, board: 'tinyCore + Qwiic Joystick' })
  assert.ok(matchesQuery(ex, 'qwiic'))
  assert.ok(searchHaystack(ex).includes('joystick'))
})

// ── board-field derivation ───────────────────────────────────────────────────
// These are the five board strings that actually appear in the published
// tinyStudio-examples manifest. Getting them wrong shipped a junk
// `tinycore-esp32-s3` chip beside the real tinyCore one and dropped the
// tinySpeak/tinySniff examples entirely, so they are pinned here verbatim.

/** The tags normalizeEntry derives for an entry with only a `board` field. */
const derive = (board: string): string[] =>
  normalizeManifest([entry({ tags: undefined, board })])[0].tags ?? []

test('a parenthetical qualifier does not become a tag of its own', () => {
  assert.deepEqual(derive('tinyCore (ESP32-S3)'), ['tinycore'])
})

test('a HAT reads as its board, alongside the tinyCore it sits on', () => {
  assert.deepEqual(derive('tinyCore + tinySpeak HAT'), ['tinycore', 'tinyspeak'])
  assert.deepEqual(derive('tinyCore + tinySniff HAT'), ['tinycore', 'tinysniff'])
})

test('a multi-word expansion yields both the connector and the part', () => {
  assert.deepEqual(derive('tinyCore + Qwiic Joystick'), ['tinycore', 'qwiic', 'joystick'])
})

test('unrecognised board text is dropped rather than becoming a chip', () => {
  assert.deepEqual(derive('tinyCore / Arduino'), ['tinycore'], '"Arduino" is not vocabulary')
  assert.deepEqual(derive('Some Unknown Board v2'), [])
})

test('declared tags still accept unknown vocabulary — only board text is filtered', () => {
  const [ex] = normalizeManifest([entry({ tags: ['time-of-flight'], board: 'tinyCore / Arduino' })])
  assert.deepEqual(ex.tags, ['tinycore', 'time-of-flight'])
})

test('an unknown tag renders as words, not as a raw slug', () => {
  assert.equal(getTagMeta('time-of-flight').label, 'time of flight')
})
