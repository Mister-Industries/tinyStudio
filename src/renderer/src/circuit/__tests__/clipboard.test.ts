/** Tests for core/clipboard — copy payload rules + paste re-iding. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildClipboard, materializePaste, parseClipboard, CLIPBOARD_FORMAT } from '../core/clipboard'
import { emptyDoc, type CircuitDoc, type JunctionEnd } from '../core/model'

function fixture(): CircuitDoc {
  const doc = emptyDoc()
  doc.parts = [
    { id: 'R1', type: 'resistor', attrs: { value: '220' }, bb: { x: 96, y: 96 } },
    { id: 'R2', type: 'resistor', bb: { x: 192, y: 96 } },
    { id: 'LED1', type: 'led-generic-5mm', bb: { x: 288, y: 96 } }
  ]
  doc.wires = [
    { id: 'w1', from: 'R1:2', to: 'R2:1', view: 'bb', color: '#2fa46a' },
    { id: 'w2', from: 'R2:2', to: 'LED1:anode', view: 'bb' },
    { id: 'w3', from: 'LED1:cathode', to: { wire: 'w1', t: 0.5 }, view: 'bb' }
  ]
  return doc
}

test('buildClipboard keeps only wires fully inside the selection', () => {
  const doc = fixture()
  const payload = buildClipboard(doc, ['R1', 'R2'])!
  assert.equal(payload.parts.length, 2)
  // w1 is between R1 and R2 → kept; w2 leaves the selection → dropped;
  // w3 is a junction on w1 but its pin end (LED1) is outside → dropped.
  assert.deepEqual(payload.wires.map((w) => w.id), ['w1'])
})

test('buildClipboard keeps junction riders when the host and both parts are in', () => {
  const doc = fixture()
  const payload = buildClipboard(doc, ['R1', 'R2', 'LED1'])!
  assert.equal(payload.wires.length, 3)
})

test('buildClipboard drops junction riders whose host wire is dropped (fixpoint)', () => {
  const doc = fixture()
  // select all parts but explicitly only wire w3 — its host w1 is a candidate
  // via both-pins-selected, so w3 survives; then remove R2 → w1 dies → w3 dies.
  const p1 = buildClipboard(doc, ['R1', 'R2', 'LED1'], ['w3'])!
  assert.ok(p1.wires.some((w) => w.id === 'w3'))
  const p2 = buildClipboard(doc, ['R1', 'LED1'], ['w3'])
  assert.ok(!p2 || !p2.wires.some((w) => w.id === 'w3'))
})

test('parseClipboard round-trips and rejects foreign text', () => {
  const doc = fixture()
  const payload = buildClipboard(doc, ['R1', 'R2'])!
  const back = parseClipboard(JSON.stringify(payload))!
  assert.equal(back.format, CLIPBOARD_FORMAT)
  assert.equal(back.parts.length, 2)
  assert.equal(parseClipboard('{"hello":"world"}'), null)
  assert.equal(parseClipboard('not json'), null)
})

test('materializePaste assigns fresh refdes, rewrites endpoints, offsets placements', () => {
  const doc = fixture()
  const payload = buildClipboard(doc, ['R1', 'R2'])!
  const { parts, wires, idMap } = materializePaste(doc, payload, { x: 19.2, y: 19.2 })
  // R1/R2 exist → next free are R3/R4
  assert.deepEqual(parts.map((p) => p.id).sort(), ['R3', 'R4'])
  assert.equal(idMap.get('R1'), 'R3')
  assert.equal(parts[0].bb!.x, 96 + 19.2)
  assert.equal(wires.length, 1)
  assert.notEqual(wires[0].id, 'w1')
  assert.equal(wires[0].from, 'R3:2')
  assert.equal(wires[0].to, 'R4:1')
})

test('materializePaste rewrites junction hosts to the new wire ids', () => {
  const doc = fixture()
  const payload = buildClipboard(doc, ['R1', 'R2', 'LED1'])!
  const { wires } = materializePaste(doc, payload, { x: 0, y: 0 })
  const oldW1 = payload.wires.find((w) => w.id === 'w1')!
  const newW1 = wires.find((w) => w.from.toString().startsWith('R') && (w.to as string).toString().startsWith('R'))!
  const rider = wires.find((w) => typeof w.to === 'object')!
  assert.notEqual(newW1.id, oldW1.id)
  assert.equal((rider.to as JunctionEnd).wire, newW1.id)
  assert.equal((rider.to as JunctionEnd).t, 0.5)
})

test('materializePaste against a doc with gaps continues numbering from max', () => {
  const doc = fixture()
  doc.parts.push({ id: 'R9', type: 'resistor', bb: { x: 0, y: 0 } })
  const payload = buildClipboard(doc, ['R1'])!
  const { parts } = materializePaste(doc, payload, { x: 0, y: 0 })
  assert.equal(parts[0].id, 'R10')
})
