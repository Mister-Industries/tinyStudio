/** Tests for core/autoroute: obstacle-aware schematic routing. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  autoroute,
  crossesWall,
  drawingPath,
  type Rect,
  type RouteOptions
} from '../core/autoroute'
import type { Pt } from '../core/model'

const G = 4.8
const opts = (walls: Rect[]): RouteOptions => ({ grid: G, walls, stub: 9.6 })

/** True when any segment of the path passes through the inside of a rect. */
function crosses(pts: Pt[], r: Rect): boolean {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / G
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / (n || 1)
      const y = a.y + ((b.y - a.y) * k) / (n || 1)
      if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true
    }
  }
  return false
}

const orthogonal = (pts: Pt[]): boolean =>
  pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y)

test('a wire goes around a part body sitting between its pins', () => {
  const wall = { x: 48, y: -28.8, w: 48, h: 57.6 }
  const routes = autoroute(
    [{ id: 'w', net: 'a', s: { x: 0, y: 0 }, sDir: 'r', t: { x: 144, y: 0 }, tDir: 'l' }],
    opts([wall])
  )
  const pts = routes.get('w')!
  assert.deepEqual(pts[0], { x: 0, y: 0 })
  assert.deepEqual(pts[pts.length - 1], { x: 144, y: 0 })
  assert.ok(orthogonal(pts))
  assert.ok(!crosses(pts, wall), JSON.stringify(pts))
})

test('two nets running side by side get separate tracks', () => {
  const routes = autoroute(
    [
      { id: 'a', net: 'A', s: { x: 0, y: 0 }, sDir: 'r', t: { x: 192, y: 0 }, tDir: 'l' },
      { id: 'b', net: 'B', s: { x: 0, y: 9.6 }, sDir: 'r', t: { x: 192, y: 0 + 9.6 }, tDir: 'l' }
    ],
    opts([])
  )
  const a = routes.get('a')!
  const b = routes.get('b')!
  // straight shots: no reason to bend, and they never share a track
  assert.equal(a.length, 2)
  assert.equal(b.length, 2)
})

test('routing is deterministic', () => {
  const req = [
    {
      id: 'w',
      net: 'a',
      s: { x: 0, y: 0 },
      sDir: 'd' as const,
      t: { x: 96, y: 96 },
      tDir: 'l' as const
    }
  ]
  const wall = { x: 20, y: 30, w: 30, h: 30 }
  assert.deepEqual(autoroute(req, opts([wall])).get('w'), autoroute(req, opts([wall])).get('w'))
})

test('drawingPath: the usual L when it is clear', () => {
  const p = drawingPath({ x: 0, y: 0 }, { x: 100, y: 50 }, [], 4.8, false)
  assert.equal(p.length, 3)
})

test('drawingPath: takes the other L when the first runs through a part', () => {
  // the default L goes right first (wide); a part sits on that leg
  const part = { x: 40, y: -10, w: 20, h: 20 }
  const p = drawingPath({ x: 0, y: 0 }, { x: 100, y: 50 }, [part], 4.8, false)
  assert.ok(!crossesWall(p, [part]))
  assert.deepEqual(p[1], { x: 0, y: 50 })
})

test('drawingPath: goes around when both Ls are blocked', () => {
  const walls = [
    { x: 40, y: -10, w: 20, h: 20 }, // on the right-first leg
    { x: -10, y: 20, w: 20, h: 20 } // on the down-first leg
  ]
  const p = drawingPath({ x: 0, y: 0 }, { x: 96, y: 52.8 }, walls, 4.8, false)
  assert.ok(!crossesWall(p, walls), JSON.stringify(p))
  assert.deepEqual(p[0], { x: 0, y: 0 })
  assert.deepEqual(p[p.length - 1], { x: 96, y: 52.8 })
})

test('drawingPath: a straight line the user lines up is left alone, part or not', () => {
  const part = { x: 40, y: -10, w: 20, h: 20 }
  const p = drawingPath({ x: 0, y: 0 }, { x: 100, y: 0 }, [part], 4.8, false)
  assert.deepEqual(p.length <= 3 && p[p.length - 1], { x: 100, y: 0 })
  assert.ok(crossesWall(p, [part]))
})

test('drawingPath: a part holding one of the ends is not in the way', () => {
  const board = { x: -50, y: -50, w: 120, h: 120 } // the pin sits inside its board
  const p = drawingPath({ x: 0, y: 0 }, { x: 200, y: 100 }, [board], 4.8, false)
  assert.equal(p.length, 3)
})

test('drawingPath: from a pin on a chip edge to the far side goes around the chip', () => {
  // a chip box whose left edge carries the start pin (leads inside the box)
  const chip = { x: 0, y: -40, w: 100, h: 160 }
  const s = { x: 0, y: 0 }
  const t = { x: 158.4, y: 38.4 }
  const p = drawingPath(s, t, [chip], 4.8, false)
  const body = { x: 4.8, y: -40, w: 95.2, h: 160 }
  assert.ok(!crossesWall(p, [body]), JSON.stringify(p))
  assert.deepEqual(p[p.length - 1], t)
})
