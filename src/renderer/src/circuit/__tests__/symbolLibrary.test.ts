/**
 * Tests for the hand-authored schematic symbol set and the normaliser that
 * cleans up imported art. The point of both is CONSISTENCY, so most of these
 * assert sameness across the whole library rather than checking one symbol's
 * shape: one stroke weight, one type stack, every pin on the major grid.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GRID_BB } from '../core/model'
import { STROKE } from '../parts/style'
import { SYMBOLS, SYMBOL_BY_TYPE, bindSymbol, symbolIdForKeywords } from '../parts/symbolLibrary'
import { gridAlignOffset, normalizeAuthoredSymbol, reinkSvg } from '../parts/normalizeSymbol'
import { schematicVisual } from '../parts/symbols'
import { PART_MANIFEST, ensureParts, getPart, type PartView } from '../../lib/partsLibrary'

const onGrid = (n: number): boolean => Math.abs(n / GRID_BB - Math.round(n / GRID_BB)) < 1e-6

function bindWithGenericPins(id: string): PartView {
  const sym = SYMBOLS[id]
  const v = bindSymbol(
    sym,
    sym.slots.map((_, i) => `p${i}`)
  )
  assert.ok(v, `${id} failed to bind`)
  return v!
}

test('every symbol puts every pin on the major grid', () => {
  for (const id of Object.keys(SYMBOLS)) {
    const v = bindWithGenericPins(id)
    for (const [pin, [x, y]] of Object.entries(v.pins)) {
      assert.ok(onGrid(x) && onGrid(y), `${id}.${pin} is off-grid at ${x},${y}`)
    }
  }
})

test('every symbol draws at the one shared stroke weight', () => {
  for (const id of Object.keys(SYMBOLS)) {
    const v = bindWithGenericPins(id)
    const widths = [...v.svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => parseFloat(m[1]))
    assert.ok(widths.length, `${id} draws nothing`)
    for (const w of widths) {
      // detail strokes (arrowheads, dashed links, glass envelopes) may be
      // lighter, but nothing may be heavier than the body weight and nothing
      // may be a hairline
      assert.ok(w <= STROKE, `${id} has a ${w}px stroke, heavier than the ${STROKE}px body`)
      assert.ok(w >= 1, `${id} has a ${w}px hairline`)
    }
  }
})

test('no symbol bakes in its own colour or font', () => {
  for (const id of Object.keys(SYMBOLS)) {
    const v = bindWithGenericPins(id)
    const hardCoded = [...v.svg.matchAll(/(?:stroke|fill)="(#[0-9a-fA-F]{3,8}|[a-z]+)"/g)]
      .map((m) => m[1])
      .filter((c) => !['none', 'transparent'].includes(c))
      // the probe pennant is deliberately amber; nothing else may be
      .filter((c) => c !== '#f0b429')
    assert.deepEqual(hardCoded, [], `${id} paints with literal colours: ${hardCoded.join(', ')}`)
    assert.ok(!/font-family="(?!var\()/.test(v.svg), `${id} sets its own font`)
  }
})

test('every mapped part actually fits the symbol it is mapped to', async () => {
  const types = Object.keys(SYMBOL_BY_TYPE)
  await ensureParts(types)
  for (const type of types) {
    const def = getPart(type)
    if (!def) continue // builtin generated at view mount (breadboards, sim parts)
    const symbol = SYMBOLS[SYMBOL_BY_TYPE[type]]
    const partPins = Object.keys(def.views.breadboard?.pins ?? {})
    assert.equal(
      partPins.length,
      symbol.slots.length,
      `${type} has ${partPins.length} pins but its symbol has ${symbol.slots.length} terminals`
    )
    // and the resolved view must keep the part's own pin names, or existing
    // wires would dangle the moment the symbol changed
    const v = schematicVisual(def)
    assert.deepEqual(
      Object.keys(v.pins).sort(),
      partPins.slice().sort(),
      `${type} lost or renamed a pin when it took its symbol`
    )
  }
})

test('polarised symbols bind polarity by name, not by pin order', () => {
  // the LED part lists cathode first; the symbol must still put the anode left
  const led = bindSymbol(SYMBOLS.led, ['cathode', 'anode'])
  assert.ok(led)
  assert.equal(led!.pins['anode'][0], 0, 'anode should be the left terminal')
  assert.ok(led!.pins['cathode'][0] > 0, 'cathode should be the right terminal')
  // a battery names its pins '-' and '+'
  const bat = bindSymbol(SYMBOLS.battery, ['-', '+'])
  assert.ok(bat)
  assert.equal(bat!.pins['+'][0], 0)
  // a three-terminal transistor binds by role
  const q = bindSymbol(SYMBOLS.npn, ['E', 'B', 'C'])
  assert.ok(q)
  assert.equal(q!.pins['B'][0], 0, 'base is the left terminal')
  assert.equal(q!.pins['C'][1], 0, 'collector is the top terminal')
  assert.ok(q!.pins['E'][1] > 0, 'emitter is the bottom terminal')
})

test('a symbol refuses a part with the wrong number of terminals', () => {
  assert.equal(bindSymbol(SYMBOLS.resistor, ['a', 'b', 'c']), null)
  assert.equal(bindSymbol(SYMBOLS.npn, ['a', 'b']), null)
})

test('keyword matching only fires on things it can actually identify', () => {
  assert.equal(symbolIdForKeywords('led-generic-5mm LED'), 'led')
  assert.equal(symbolIdForKeywords('some-npn-thing Bipolar Transistor'), 'npn')
  assert.equal(symbolIdForKeywords('electrolytic capacitor'), 'capacitor-polar')
  assert.equal(symbolIdForKeywords('esp32-dev-board microcontroller'), undefined)
})

// ── normaliser ───────────────────────────────────────────────────────────────

test('re-inking replaces hairlines, literal colours and fonts', () => {
  const raw =
    '<svg viewBox="0 0 10 2"><line x1="0" y1="1" x2="10" y2="1" stroke="#787878" stroke-width="0.1524"/>' +
    '<rect x="1" y="0" width="2" height="2" fill="none" stroke="none"/>' +
    '<text x="1" y="1" font-family="OCRA" font-size="0.3" fill="#1f8ac0">VCC</text></svg>'
  // this art is authored in inches: 10 viewBox units across 39.33 px
  const out = reinkSvg(raw, 10 / 39.33)
  assert.ok(!out.includes('#787878'), 'grey stroke survived')
  assert.ok(!out.includes('#1f8ac0'), 'blue text survived')
  assert.ok(!out.includes('OCRA'), 'imported font survived')
  assert.ok(out.includes('stroke="none"'), 'a deliberate no-stroke was overpainted')
  // the restroked width must be OUR weight expressed in the drawing's units
  const w = parseFloat(/stroke-width="([\d.]+)"/.exec(out)![1])
  assert.ok(Math.abs(w - STROKE * (10 / 39.33)) < 1e-3, `restroked to ${w}`)
})

test('grid alignment removes the half-stroke offset Fritzing bakes in', () => {
  const [dx, dy] = gridAlignOffset({ a: [0.47, 4.13], b: [38.87, 4.13] })
  assert.ok(Math.abs(dx - -0.47) < 0.06, `dx=${dx}`)
  // 4.13 is not near a grid line at all — it must not drag the drawing sideways
  assert.ok(Math.abs(dy) < GRID_BB / 2)

  const v: PartView = {
    svg: '<svg viewBox="0 0 10 2"><line x1="0" y1="1" x2="10" y2="1" stroke="#000" stroke-width="0.1"/></svg>',
    w: 39.33,
    h: 8.26,
    pins: { 'Pin 0': [0.47, 4.13], 'Pin 1': [38.87, 4.13] }
  }
  const out = normalizeAuthoredSymbol(v)
  assert.ok(onGrid(out.pins['Pin 0'][0]), `left pin at ${out.pins['Pin 0'][0]}`)
  assert.ok(onGrid(out.pins['Pin 1'][0]), `right pin at ${out.pins['Pin 1'][0]}`)
  assert.equal((out.svg.match(/<g transform="translate/g) || []).length, 1)
  assert.equal((out.svg.match(/<\/g><\/svg>/g) || []).length, 1)
})

test('the schematic palette can draw a symbol for every catalogue part', async () => {
  // The components rail asks the registry for each tile's symbol. Parts are
  // lazily loaded, so this only works once their definitions are in — the
  // schematic rail used to fall back to the Fritzing breadboard photo.
  const types = PART_MANIFEST.map((m) => m.type)
  await ensureParts(types)
  for (const meta of PART_MANIFEST) {
    const def = getPart(meta.type)
    if (!def) continue // generated builtins are registered at view mount
    const symbol = schematicVisual(def)
    assert.ok(symbol.svg.startsWith('<svg'), `${meta.type} has no symbol`)
    assert.notEqual(
      symbol.svg,
      meta.icon,
      `${meta.type} would still draw its breadboard icon on the schematic`
    )
    assert.ok(Object.keys(symbol.pins).length > 0, `${meta.type} symbol has no pins`)
  }
})
