/**
 * Tests for what Studio AI is told about tinyStudio: the tinyCore pin map, the
 * guides, and the circuit summary behind inspect_circuit.
 *
 * The failures worth catching are the quiet ones: the pin map drifting from the
 * tinycore part.json (the agent would quote pins the circuit editor doesn't
 * have), a guide or screenshot missing from the bundle (read_guide throws
 * mid-conversation), and breadboard holes cluttering (or dropping) connections.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadGuide } from '../../../../shared/agentGuides'
import { GUIDE_IDS } from '../../../../shared/agentGuides/catalog'
import { STUDIO_SYSTEM_PROMPT } from '../../../../shared/agentPrompt'
import { TINYCORE_PINS, tinyCorePin } from '../../../../shared/tinycorePins'
import tinycorePartJson from '../../assets/tinyparts/packs/tinyboards/parts/tinycore/part.json?raw'
import type { CircuitDoc, CircuitPart, CircuitWire } from '../../circuit/core/model'
import { buildNets } from '../../circuit/core/nets'
import { summarizeCircuit, type PartInfo } from '../circuitSummary'

test('the pin map covers exactly the tinycore part.json pins', () => {
  const partPins: string[] = JSON.parse(tinycorePartJson).views.breadboard.pins
  assert.deepEqual(
    TINYCORE_PINS.map((p) => p.label).sort(),
    [...partPins].sort(),
    'src/shared/tinycorePins.ts is out of step with the tinycore part.json'
  )
})

test('pins look up by part.json name, diagram name, or code constant', () => {
  assert.equal(tinyCorePin('D13')?.gpio, 13)
  assert.equal(tinyCorePin('D13')?.code, '13')
  assert.equal(tinyCorePin('A0')?.gpio, 18)
  assert.equal(tinyCorePin('mosi')?.label, 'MO')
  assert.equal(tinyCorePin('I2C_PWR')?.gpio, 6)
  assert.equal(tinyCorePin('LED_BUILTIN')?.gpio, 33)
  assert.equal(tinyCorePin('D99'), undefined)
})

test('every guide loads, with its placeholders filled and screenshots decoded', () => {
  for (const id of GUIDE_IDS) {
    const guide = loadGuide(id)
    assert.ok(guide.markdown.length > 500, `${id} guide is empty`)
    assert.ok(!guide.markdown.includes('{{'), `${id} guide has an unfilled placeholder`)
    for (const img of guide.images) {
      assert.ok(img.data.length > 1000, `${id}: screenshot "${img.caption}" is empty`)
    }
  }
  assert.match(loadGuide('tinycore').markdown, /\| D13 \(13\) \| 13 \| `13` \|/)
})

test('the system prompt lists every guide', () => {
  for (const id of GUIDE_IDS) assert.ok(STUDIO_SYSTEM_PROMPT.includes(`"${id}"`), id)
})

// ── circuit summary ──────────────────────────────────────────────────────────

const LIBRARY: Record<string, PartInfo> = {
  tinycore: { label: 'tinyCore' },
  resistor: { label: 'Resistor' },
  'led-generic-5mm': { label: 'Red LED' },
  'battery-aa': { label: 'AA Battery' },
  'breadboard-half': { label: 'Half breadboard', breadboard: true }
}
const info = (type: string): PartInfo | undefined => LIBRARY[type]

const doc = (parts: CircuitPart[], wires: [string, string][]): CircuitDoc => ({
  format: 'tinystudio-circuit',
  version: 2,
  parts,
  wires: wires.map(([from, to], i): CircuitWire => ({ id: `w${i}`, from, to, view: 'bb' }))
})

test('summary annotates tinyCore pins with GPIO and code, and lists loose parts', () => {
  const d = doc(
    [
      { id: 'U1', type: 'tinycore', bb: { x: 0, y: 0 } },
      { id: 'R1', type: 'resistor', attrs: { value: '220' }, bb: { x: 0, y: 0 } },
      { id: 'LED1', type: 'led-generic-5mm', bb: { x: 0, y: 0 } },
      { id: 'BAT1', type: 'battery-aa' }
    ],
    [
      ['U1:D13', 'R1:Pin 0'],
      ['R1:Pin 1', 'LED1:anode'],
      ['LED1:cathode', 'U1:GND']
    ]
  )
  const text = summarizeCircuit(d, buildNets(d), info)
  assert.match(text, /R1: Resistor \(resistor\) value=220/)
  assert.match(text, /U1:D13 \[tinyCore GPIO 13 · ADC2_CH2 · write 13 in code\] ↔ R1:Pin 0/)
  assert.match(text, /LED1:anode ↔ R1:Pin 1/)
  assert.match(text, /U1:GND \[tinyCore ground\] ↔ LED1:cathode/)
  assert.match(text, /tinyCore pins in use:\n.*U1:D13 .* → R1:Pin 0/)
  assert.match(text, /BAT1: AA Battery \(battery-aa\) \(unplaced, in the tray\)/)
  assert.match(text, /Not connected to anything: BAT1/)
})

test('summary hides breadboard holes but keeps the connections made through them', () => {
  const d = doc(
    [
      { id: 'U1', type: 'tinycore', bb: { x: 0, y: 0 } },
      { id: 'BB1', type: 'breadboard-half', bb: { x: 0, y: 0 } },
      { id: 'LED1', type: 'led-generic-5mm', bb: { x: 0, y: 0 } }
    ],
    [['U1:A5', 'BB1:a1']]
  )
  // LED1's anode is seated in the same hole: a derived, unstored connection.
  const nets = buildNets(d, { implicit: [['LED1:anode', 'BB1:a1']] })
  const text = summarizeCircuit(d, nets, info)
  assert.match(text, /U1:A5 \[tinyCore GPIO 7 · ADC1_CH6 · write A5 in code\] ↔ LED1:anode/)
  assert.doesNotMatch(text, /BB1:a1/)
  assert.doesNotMatch(text, /Not connected to anything: .*BB1/)
})
