/**
 * Wires on the back of the board (solder side of a tinyProto or perfboard): the
 * side survives save/load, defaults to the front, and never changes a net.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildNets } from '../core/nets'
import { emptyDoc, parseCircuitFile, serializeDoc, wireSide, type CircuitDoc } from '../core/model'

function doc(partial: Partial<CircuitDoc>): CircuitDoc {
  return { ...emptyDoc(), ...partial }
}

test('a back-side wire round-trips; the front is the unwritten default', () => {
  const d = doc({
    wires: [
      { id: 'w1', from: 'R1:Pin 0', to: 'LED1:anode', view: 'bb', side: 'back' },
      { id: 'w2', from: 'R1:Pin 1', to: 'LED1:cathode', view: 'bb', side: 'front' },
      { id: 'w3', from: 'R1:Pin 1', to: 'LED1:cathode', view: 'bb' }
    ]
  })
  const text = serializeDoc(d)
  const raw = JSON.parse(text) as { wires: Record<string, unknown>[] }
  assert.equal(raw.wires[0].side, 'back')
  assert.equal('side' in raw.wires[1], false)
  assert.equal('side' in raw.wires[2], false)

  const back = parseCircuitFile(text).doc.wires
  assert.deepEqual(back.map(wireSide), ['back', 'front', 'front'])
})

test('a schematic wire never carries a side', () => {
  const d = doc({ wires: [{ id: 'w1', from: 'A:1', to: 'B:1', view: 'sch', side: 'back' }] })
  const raw = JSON.parse(serializeDoc(d)) as { wires: Record<string, unknown>[] }
  assert.equal('side' in raw.wires[0], false)
})

test('front and back wires join the same nets', () => {
  const parts = [
    { id: 'R1', type: 'resistor', bb: { x: 0, y: 0 } },
    { id: 'LED1', type: 'led', bb: { x: 50, y: 0 } },
    { id: 'SW1', type: 'tactile-button-6mm', bb: { x: 100, y: 0 } }
  ]
  const front = buildNets(
    doc({
      parts,
      wires: [
        { id: 'a', from: 'R1:Pin 1', to: 'LED1:anode', view: 'bb' },
        { id: 'b', from: 'LED1:cathode', to: 'SW1:1a', view: 'bb' }
      ]
    })
  )
  const mixed = buildNets(
    doc({
      parts,
      wires: [
        { id: 'a', from: 'R1:Pin 1', to: 'LED1:anode', view: 'bb', side: 'back' },
        { id: 'b', from: 'LED1:cathode', to: 'SW1:1a', view: 'bb' }
      ]
    })
  )
  for (const pin of ['R1:Pin 1', 'LED1:anode', 'LED1:cathode', 'SW1:1a'])
    assert.equal(mixed.pinToNet.get(pin) === undefined, front.pinToNet.get(pin) === undefined)
  assert.equal(mixed.pinToNet.get('R1:Pin 1'), mixed.pinToNet.get('LED1:anode'))
  assert.equal(mixed.meaningful, front.meaningful)
})
