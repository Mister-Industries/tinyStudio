/** Tests for parts/symbols — generated IC-box schematic symbols. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GRID_BB } from '../core/model'
import { generateBoxSymbol, schematicVisual } from '../parts/symbols'
import type { PartDef } from '../../lib/partsLibrary'

const def: PartDef = {
  type: 'testpart',
  label: 'Test Part',
  views: {
    breadboard: {
      svg: '<svg/>',
      w: 50,
      h: 20,
      pins: { VCC: [0, 0], GND: [0, 10], SDA: [50, 0], SCL: [50, 10], INT: [25, 20] }
    }
  }
}

test('generated symbol: every pin on the 9.6 major grid, left/right split by order', () => {
  const v = generateBoxSymbol(def)
  assert.equal(Object.keys(v.pins).length, 5)
  for (const [name, [x, y]] of Object.entries(v.pins)) {
    assert.ok(Math.abs(x / GRID_BB - Math.round(x / GRID_BB)) < 1e-9, `${name} x=${x}`)
    assert.ok(Math.abs(y / GRID_BB - Math.round(y / GRID_BB)) < 1e-9, `${name} y=${y}`)
  }
  // first ceil(5/2)=3 pins on the left edge (x=0), rest on the right edge
  assert.equal(v.pins['VCC'][0], 0)
  assert.equal(v.pins['GND'][0], 0)
  assert.equal(v.pins['SDA'][0], 0)
  assert.equal(v.pins['SCL'][0], v.w)
  assert.equal(v.pins['INT'][0], v.w)
})

test('generated symbol SVG carries the label and ink strokes', () => {
  const v = generateBoxSymbol(def)
  assert.ok(v.svg.includes('Test Part'))
  assert.ok(v.svg.includes('var(--text-strong)'))
  assert.ok(v.svg.includes('viewBox'))
})

test('schematicVisual prefers authored art and caches generated symbols', () => {
  const authored: PartDef = {
    ...def,
    type: 'authored',
    views: { ...def.views, schematic: { svg: '<svg>real</svg>', w: 10, h: 10, pins: { VCC: [0, 0] } } }
  }
  assert.equal(schematicVisual(authored).svg, '<svg>real</svg>')
  const a = schematicVisual(def)
  const b = schematicVisual(def)
  assert.equal(a, b) // cached instance
})
