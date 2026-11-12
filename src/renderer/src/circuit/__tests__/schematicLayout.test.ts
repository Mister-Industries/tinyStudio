/** Tests for core/schematicLayout: breadboard connectivity → a drawn schematic. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyDoc, type CircuitDoc, type CircuitWire } from '../core/model'
import { buildNets } from '../core/nets'
import { layoutSchematic, type LayoutResult, type SymbolInfo } from '../core/schematicLayout'
import { headerBuses, tinyCoreSymbol } from '../parts/boardSymbols'

const R: SymbolInfo = { w: 57.6, h: 19.2, pins: { 'Pin 0': [0, 9.6], 'Pin 1': [57.6, 9.6] } }
const S: SymbolInfo = { w: 57.6, h: 19.2, pins: { leg0: [0, 9.6], leg1: [57.6, 9.6] } }
const LED: SymbolInfo = { w: 57.6, h: 28.8, pins: { anode: [0, 19.2], cathode: [57.6, 19.2] } }
const GND: SymbolInfo = { w: 19.2, h: 19.2, pins: { '1': [9.6, 0] } }
const VCC: SymbolInfo = { w: 28.8, h: 19.2, pins: { '1': [14.4, 19.2] } }
const core = tinyCoreSymbol()

function blink(): CircuitDoc {
  const doc = emptyDoc()
  doc.parts = [
    { id: 'U1', type: 'tinycore' },
    { id: 'R1', type: 'resistor' },
    { id: 'LED1', type: 'led' },
    { id: 'R2', type: 'resistor' },
    { id: 'S1', type: 'button' }
  ]
  const w = (from: string, to: string, i: number): CircuitWire => ({
    id: `b${i}`,
    from,
    to,
    view: 'bb' as const
  })
  doc.wires = [
    ['U1:D8', 'R1:Pin 0'],
    ['R1:Pin 1', 'LED1:anode'],
    ['LED1:cathode', 'U1:GND'],
    ['U1:3V3', 'R2:Pin 0'],
    ['R2:Pin 1', 'U1:D9'],
    ['U1:D9', 'S1:leg0'],
    ['S1:leg1', 'U1:GND.2']
  ].map(([a, b], i) => w(a, b, i))
  return doc
}

function run(doc: CircuitDoc): LayoutResult {
  const nets = buildNets(doc, {
    busesFor: (t) => (t === 'tinycore' ? headerBuses(Object.keys(core.pins)) : undefined)
  })
  const symbols: Record<string, SymbolInfo> = { tinycore: core, resistor: R, led: LED, button: S }
  return layoutSchematic({
    doc,
    nets,
    symbolOf: (t) => symbols[t] ?? null,
    isBoard: (t) => t === 'tinycore',
    labelSymbol: (k) => (k === 'ground' ? GND : VCC)
  })
}

test('rails become symbols, never wires', () => {
  const res = run(blink())
  const names = res.netLabels.map((l) => `${l.kind}:${l.name}`).sort()
  // board 3V3 + GND, LED cathode, pull-up top, button bottom
  assert.ok(names.includes('ground:GND'))
  assert.ok(names.includes('power:3V3'))
  for (const w of res.wires) {
    const ends = [w.from, w.to].map(String)
    assert.ok(
      !ends.includes('U1:GND') || ends.some((e) => e.startsWith('gl')),
      'GND only wires to a symbol'
    )
  }
})

test('series parts lie flat, shunts and pull-ups stand up', () => {
  const res = run(blink())
  assert.equal(res.placements.R1.rotate ?? 0, 0)
  assert.ok([90, 270].includes(res.placements.LED1.rotate ?? 0))
  assert.ok([90, 270].includes(res.placements.R2.rotate ?? 0))
  assert.ok([90, 270].includes(res.placements.S1.rotate ?? 0))
})

test('no two placed parts overlap', () => {
  const res = run(blink())
  const size: Record<string, SymbolInfo> = { U1: core, R1: R, LED1: LED, R2: R, S1: S }
  const box = (id: string): { x: number; y: number; w: number; h: number } => {
    const pl = res.placements[id]
    const s = size[id]
    const q = pl.rotate === 90 || pl.rotate === 270
    const w = q ? s.h : s.w
    const h = q ? s.w : s.h
    const x = pl.x + (s.w - w) / 2
    const y = pl.y + (s.h - h) / 2
    return { x, y, w, h }
  }
  const ids = Object.keys(size)
  for (const a of ids)
    for (const b of ids) {
      if (a >= b) continue
      const p = box(a)
      const q = box(b)
      const overlap = p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y
      assert.ok(!overlap, `${a} overlaps ${b}: ${JSON.stringify(p)} ${JSON.stringify(q)}`)
    }
})
