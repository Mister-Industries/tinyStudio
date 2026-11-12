/** Parts plug into a tinyProto's holes, and a tinyProto stacked on a tinyCore joins its header. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyDoc, type CircuitPart } from '../core/model'
import { buildNets } from '../core/nets'
import { ensureParts } from '../../lib/partsLibrary'
import { isBreadboard, isHoleBoard } from '../parts/breadboard'
import { circuitBuses, implicitSeats, pinWorldOf } from '../views/partsAdapter'

/** a part placed so `pin` sits exactly in `hole` of `board` */
function seatedOn(board: CircuitPart, hole: string, part: CircuitPart, pin: string): CircuitPart {
  const at = pinWorldOf(board, hole)!
  const p0 = pinWorldOf({ ...part, bb: { x: 0, y: 0 } }, pin)!
  return { ...part, bb: { x: at.x - p0.x, y: at.y - p0.y } }
}

test('isHoleBoard: breadboards and the tinyProto, nothing else', () => {
  assert.ok(isHoleBoard('tinyproto'))
  assert.ok(isHoleBoard('breadboard-half'))
  assert.ok(!isBreadboard('tinyproto'))
  assert.ok(!isHoleBoard('tinycore'))
  assert.ok(!isHoleBoard('resistor'))
})

test('a resistor in tinyProto holes seats; a stacked tinyCore joins the header', async () => {
  await ensureParts(['tinycore', 'tinyproto', 'resistor'])
  const proto: CircuitPart = { id: 'P1', type: 'tinyproto', bb: { x: 96, y: 96 } }
  const core: CircuitPart = { id: 'U1', type: 'tinycore', bb: { x: 96, y: 96 } }
  const r = seatedOn(proto, 'H.5', { id: 'R1', type: 'resistor' }, 'Pin 0')
  const doc = emptyDoc()
  doc.parts = [core, proto, r]
  doc.wires = [{ id: 'w1', from: 'P1:D8', to: 'P1:H.5', view: 'bb', side: 'back' }]
  const seats = implicitSeats(doc)
  const holeOf = new Map(seats.map((s) => [s.pin, s.hole]))
  assert.equal(holeOf.get('R1:Pin 0'), 'P1:H.5')
  assert.equal(holeOf.get('R1:Pin 1'), 'P1:L.5')
  assert.equal(
    holeOf.get('U1:D8'),
    'P1:D8',
    'every tinyCore header pin lands on the tinyProto header'
  )
  const nets = buildNets(doc, {
    busesFor: circuitBuses,
    implicit: seats.map((s): [string, string] => [s.pin, s.hole])
  })
  assert.equal(nets.pinToNet.get('R1:Pin 0'), nets.pinToNet.get('U1:D8'))
  assert.notEqual(nets.pinToNet.get('R1:Pin 1'), nets.pinToNet.get('U1:D8'))
})

test('a part half off the tinyProto does not seat', async () => {
  await ensureParts(['tinyproto', 'resistor'])
  const proto: CircuitPart = { id: 'P1', type: 'tinyproto', bb: { x: 0, y: 0 } }
  const r = seatedOn(proto, 'H.5', { id: 'R1', type: 'resistor' }, 'Pin 0')
  // half a pitch across and down: each leg sits between four holes
  r.bb!.x += 4.8
  r.bb!.y += 4.8
  const doc = emptyDoc()
  doc.parts = [proto, r]
  assert.deepEqual(implicitSeats(doc), [])
})
