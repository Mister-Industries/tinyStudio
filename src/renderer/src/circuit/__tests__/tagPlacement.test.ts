/** Tests for core/tagPlacement: new probe tags land clear of the drawing. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clearTagSpot, type Box } from '../core/tagPlacement'

const hits = (p: { x: number; y: number }, size: { w: number; h: number }, boxes: Box[]): boolean =>
  boxes.some((b) => p.x < b.x + b.w && p.x + size.w > b.x && p.y < b.y + b.h && p.y + size.h > b.y)

test('an empty sheet: the tag goes up and to the right of the click', () => {
  const p = clearTagSpot({ x: 100, y: 100 }, { w: 60, h: 18 }, [], 4)
  assert.ok(p.x > 100 && p.y + 18 < 100)
})

test('a horizontal wire through the click: the tag sits off it', () => {
  const size = { w: 60, h: 18 }
  const wire: Box = { x: 0, y: 100, w: 400, h: 1 }
  const p = clearTagSpot({ x: 100, y: 100 }, size, [wire], 4)
  assert.ok(!hits(p, size, [wire]))
})

test('wires above and right: it finds a free quadrant', () => {
  const size = { w: 60, h: 18 }
  const boxes: Box[] = [
    { x: 0, y: 100, w: 400, h: 1 },
    { x: 100, y: 0, w: 1, h: 100 },
    { x: 104, y: 20, w: 200, h: 78 } // a part up and to the right
  ]
  const p = clearTagSpot({ x: 100, y: 100 }, size, boxes, 4)
  assert.ok(!hits(p, size, boxes), JSON.stringify(p))
})

test('boxed in on every side: still returns a spot, the least covered', () => {
  const p = clearTagSpot(
    { x: 100, y: 100 },
    { w: 60, h: 18 },
    [{ x: -500, y: -500, w: 1000, h: 1000 }],
    4
  )
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y))
})
