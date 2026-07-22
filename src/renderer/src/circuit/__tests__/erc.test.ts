/** Tests for core/erc — net-model rule checks. */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { runErc } from '../core/erc'
import { emptyDoc, type CircuitDoc, type NetLabel } from '../core/model'
import { buildNets } from '../core/nets'
import { journeyFromPoints } from '../core/routing'

const wire = (id: string, from: string, to: string): CircuitDoc['wires'][number] => ({
  id,
  from,
  to,
  view: 'sch',
  route: journeyFromPoints(
    [
      { x: 0, y: 0 },
      { x: 48, y: 0 }
    ],
    true
  )
})

test('rail short: GND and 5V on the same net is an error', () => {
  const doc = emptyDoc()
  const labels: NetLabel[] = [
    { id: 'nl1', name: 'GND', kind: 'ground', sch: { x: 0, y: 0 } },
    { id: 'nl2', name: '5V', kind: 'power', sch: { x: 48, y: 0 } }
  ]
  doc.netLabels = labels
  doc.wires = [wire('w1', 'nl1:1', 'nl2:1')]
  const issues = runErc(doc, buildNets(doc))
  assert.ok(issues.some((i) => i.severity === 'error' && /Rail short/.test(i.message)))
})

test('floating net label is flagged (info) until wired', () => {
  const doc = emptyDoc()
  doc.netLabels = [{ id: 'nl1', name: 'GND', kind: 'ground', sch: { x: 0, y: 0 } }]
  let issues = runErc(doc, buildNets(doc))
  assert.ok(issues.some((i) => i.id === 'floatlabel:nl1' && i.severity === 'info'))
  // wiring it to a second label clears the floating flag
  doc.netLabels.push({ id: 'nl2', name: 'GND', kind: 'ground', sch: { x: 48, y: 0 } })
  doc.wires = [wire('w1', 'nl1:1', 'nl2:1')]
  issues = runErc(doc, buildNets(doc))
  assert.ok(!issues.some((i) => i.id === 'floatlabel:nl1'))
})

test('missing ground info fires only when power exists without ground', () => {
  const doc = emptyDoc()
  doc.netLabels = [{ id: 'nl1', name: '5V', kind: 'power', sch: { x: 0, y: 0 } }]
  assert.ok(runErc(doc, buildNets(doc)).some((i) => i.id === 'noground'))
  doc.netLabels.push({ id: 'nl2', name: 'GND', kind: 'ground', sch: { x: 48, y: 0 } })
  assert.ok(!runErc(doc, buildNets(doc)).some((i) => i.id === 'noground'))
})
