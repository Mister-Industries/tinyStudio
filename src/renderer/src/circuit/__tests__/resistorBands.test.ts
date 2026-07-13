/** Tests for parts/resistorBands — value parsing, 4-band color code, SVG recolor. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bandColorsFor, decorateResistor, DIGIT_COLORS, parseOhms } from '../parts/resistorBands'

test('parseOhms handles the usual spellings', () => {
  assert.equal(parseOhms('220'), 220)
  assert.equal(parseOhms('4.7k'), 4700)
  assert.equal(parseOhms('4.7kΩ'), 4700)
  assert.equal(parseOhms('1M'), 1e6)
  assert.equal(parseOhms('1Meg'), 1e6)
  assert.equal(parseOhms('10 ohm'), 10)
  assert.equal(parseOhms(330), 330)
  assert.equal(parseOhms('0'), null)
  assert.equal(parseOhms('abc'), null)
  assert.equal(parseOhms(undefined), null)
})

test('band colors follow the IEC code', () => {
  // 220 Ω = red red brown
  assert.deepEqual(bandColorsFor(220), {
    d1: DIGIT_COLORS[2],
    d2: DIGIT_COLORS[2],
    mult: DIGIT_COLORS[1]
  })
  // 4.7 kΩ = yellow violet red
  assert.deepEqual(bandColorsFor(4700), {
    d1: DIGIT_COLORS[4],
    d2: DIGIT_COLORS[7],
    mult: DIGIT_COLORS[2]
  })
  // 1 MΩ = brown black green
  assert.deepEqual(bandColorsFor(1e6), {
    d1: DIGIT_COLORS[1],
    d2: DIGIT_COLORS[0],
    mult: DIGIT_COLORS[5]
  })
  // 4.7 Ω = yellow violet gold
  const sub10 = bandColorsFor(4.7)!
  assert.equal(sub10.d1, DIGIT_COLORS[4])
  assert.equal(sub10.d2, DIGIT_COLORS[7])
  assert.equal(sub10.mult, '#AD9F4E')
})

const ART =
  '<svg><path id="band_1_st" fill="#C40808" d="M0 0"/>' +
  '<rect id="band_2_nd" fill="#C40808"/>' +
  '<rect id="band_rd_multiplier" fill="#8A3D06"/>' +
  '<rect id="gold_band" fill="#AD9F4E"/></svg>'

test('decorateResistor recolors exactly the three value bands', () => {
  const out = decorateResistor(ART, '4.7k')
  assert.ok(out.includes(`id="band_1_st" fill="${DIGIT_COLORS[4]}"`), 'digit 1 → yellow')
  assert.ok(out.includes(`id="band_2_nd" fill="${DIGIT_COLORS[7]}"`), 'digit 2 → violet')
  assert.ok(out.includes(`id="band_rd_multiplier" fill="${DIGIT_COLORS[2]}"`), 'mult → red')
  assert.ok(out.includes('id="gold_band" fill="#AD9F4E"'), 'tolerance band untouched')
})

test('decorateResistor leaves art alone for bad values or non-resistor art', () => {
  assert.equal(decorateResistor(ART, 'garbage'), ART)
  assert.equal(decorateResistor(ART, undefined), ART)
  const other = '<svg><rect fill="#123456"/></svg>'
  assert.equal(decorateResistor(other, '220'), other)
})
