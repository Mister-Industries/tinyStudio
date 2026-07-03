/**
 * circuit/core/routing tests — journey decode/encode incl. the Wokwi "*"
 * semantics (B2 fix), bend extraction, simplification, junction parametrics.
 * Runner: `npm run test:circuit` (esbuild bundle → node --test).
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  bendsFromJourney,
  buildWirePoints,
  decodeJourney,
  dragSegment,
  isStraightRoute,
  journeyFromPoints,
  pointAtT,
  simplifyWirePoints,
  tAtPoint,
  wirePoints
} from '../core/routing'

const src = { x: 0, y: 0 }
const tgt = { x: 100, y: 50 }

test('decodeJourney: plain source-anchored h/v', () => {
  const pts = decodeJourney(src, tgt, ['h100', 'v50'])
  assert.deepEqual(pts, [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 }
  ])
})

test('decodeJourney: empty journey auto-completes orthogonally', () => {
  const pts = decodeJourney(src, tgt)
  assert.equal(pts[0].x, 0)
  assert.equal(pts[pts.length - 1].y, 50)
  assert.ok(pts.length >= 2)
  // all segments axis-aligned
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i].x - pts[i - 1].x)
    const dy = Math.abs(pts[i].y - pts[i - 1].y)
    assert.ok(dx < 0.001 || dy < 0.001, `segment ${i} not orthogonal`)
  }
})

test('decodeJourney: Wokwi "*" — post-star applies in reverse from target (B2)', () => {
  // Wokwi docs example: ["v10","h5","*","v-15","h10"]
  // v10,h5 from source; from TARGET walk back: h10 → 10px left of target,
  // then v-15 → 15px below target; gap auto-completed.
  const s = { x: 0, y: 0 }
  const t = { x: 100, y: 100 }
  const pts = decodeJourney(s, t, ['v10', 'h5', '*', 'v-15', 'h10'])
  // source chain
  assert.deepEqual(pts[0], { x: 0, y: 0 })
  assert.deepEqual(pts[1], { x: 0, y: 10 })
  assert.deepEqual(pts[2], { x: 5, y: 10 })
  // target chain end: …, {90,115}, {90,100}? walk: target(100,100) ← h10 means
  // "10 right of target-side point", so backward = (90,100); then v-15 backward = (90,115)
  const n = pts.length
  assert.deepEqual(pts[n - 1], { x: 100, y: 100 })
  assert.deepEqual(pts[n - 2], { x: 90, y: 100 })
  assert.deepEqual(pts[n - 3], { x: 90, y: 115 })
})

test('decodeJourney: "*" with empty halves degrades gracefully', () => {
  const pts = decodeJourney(src, tgt, ['*'])
  assert.deepEqual(pts[0], src)
  assert.deepEqual(pts[pts.length - 1], tgt)
})

test('journeyFromPoints round-trips orthogonal routes', () => {
  const original = ['h48', 'v-19.2', 'h20']
  const pts = decodeJourney(src, { x: 68, y: -19.2 }, original)
  const encoded = journeyFromPoints(pts)
  assert.deepEqual(encoded, original)
})

test('straight (d) routes survive encode/decode', () => {
  const j = ['d30,40', 'h10']
  assert.ok(isStraightRoute(j))
  const pts = wirePoints(src, { x: 40, y: 40 }, j)
  assert.deepEqual(pts[1], { x: 30, y: 40 })
  const back = journeyFromPoints(pts, true)
  assert.deepEqual(back, j)
})

test('bendsFromJourney drops endpoint-coincident points', () => {
  const bends = bendsFromJourney(['h100', 'v50'], src, tgt)
  assert.deepEqual(bends, [{ x: 100, y: 0 }])
})

test('buildWirePoints re-elbows around fixed bends', () => {
  const bends = [{ x: 50, y: 0 }]
  const pts = buildWirePoints({ x: 0, y: 10 }, bends, { x: 100, y: 60 })
  assert.deepEqual(pts[0], { x: 0, y: 10 })
  assert.deepEqual(pts[pts.length - 1], { x: 100, y: 60 })
  assert.ok(pts.some((p) => p.x === 50 && p.y === 0))
})

test('simplifyWirePoints removes collinear + duplicate points', () => {
  const pts = simplifyWirePoints([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 30 }
  ])
  assert.deepEqual(pts, [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 30 }
  ])
})

test('dragSegment inserts corners at anchored endpoints (U-pull)', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 }
  ]
  const out = dragSegment(pts, 0, 'horizontal', 0, 20)
  assert.deepEqual(out, [
    { x: 0, y: 0 },
    { x: 0, y: 20 },
    { x: 100, y: 20 },
    { x: 100, y: 0 }
  ])
})

test('pointAtT / tAtPoint are inverse-ish along a polyline', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 }
  ]
  const mid = pointAtT(pts, 0.5)
  assert.deepEqual(mid, { x: 100, y: 0 })
  assert.ok(Math.abs(tAtPoint(pts, { x: 100, y: 1 }) - 0.505) < 0.01)
  assert.ok(Math.abs(tAtPoint(pts, { x: 50, y: 0 }) - 0.25) < 0.001)
})
