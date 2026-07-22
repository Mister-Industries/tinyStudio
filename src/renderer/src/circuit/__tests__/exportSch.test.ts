/** Tests for schematic image export — ink wires + net-label glyphs, valid XML shape. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyDoc, type CircuitDoc } from '../core/model'
import { journeyFromPoints } from '../core/routing'
import { composeSceneSvg } from '../views/exportImage'

test('composeSceneSvg (sch) renders ink wires + net labels with balanced svg tags', () => {
  const doc: CircuitDoc = emptyDoc()
  doc.netLabels = [
    { id: 'nl1', name: 'GND', kind: 'ground', sch: { x: 0, y: 0 } },
    { id: 'nl2', name: 'GND', kind: 'ground', sch: { x: 96, y: 0 } }
  ]
  doc.wires = [
    {
      id: 'w1',
      from: 'nl1:1',
      to: 'nl2:1',
      view: 'sch',
      route: journeyFromPoints(
        [
          { x: 0, y: 0 },
          { x: 96, y: 0 }
        ],
        true
      )
    }
  ]
  const svg = composeSceneSvg(doc, '#ffffff', 'sch')
  assert.ok(svg, 'expected a scene svg')
  assert.ok(svg!.includes('stroke-width="1"'), 'schematic ink wire present')
  assert.ok(svg!.includes('Studio'), 'watermark present')
  const opens = (svg!.match(/<svg/g) || []).length
  const closes = (svg!.match(/<\/svg>/g) || []).length
  assert.equal(opens, closes, 'svg tags balanced')
  assert.ok(opens >= 3, 'outer + two net-label glyphs')
})

test('composeSceneSvg (sch) omits breadboards but keeps their absence graceful', () => {
  const doc: CircuitDoc = emptyDoc()
  doc.parts = [{ id: 'BB1', type: 'breadboard-mini', bb: { x: 0, y: 0 }, sch: { x: 0, y: 0 } }]
  // no sch-renderable geometry ⇒ bounds null ⇒ null (nothing to export), no throw
  const svg = composeSceneSvg(doc, '#ffffff', 'sch')
  assert.equal(svg, null)
})
