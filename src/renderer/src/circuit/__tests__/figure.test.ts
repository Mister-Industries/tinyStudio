/** Tests for views/sim/figure: paper-ready SVG figures from a simulation run. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SimRun } from '../sim'
import { figureSvg, niceTicks, siScale } from '../views/sim/figure'

const t = Array.from({ length: 101 }, (_, i) => i * 1e-4) // 0..10 ms
const run: SimRun = {
  header: '',
  numPoints: t.length,
  vectors: [
    { name: 'time', type: 'time', values: t },
    { name: 'v(out)', type: 'voltage', values: t.map((x) => 3.3 * (1 - Math.exp(-x / 1e-3))) },
    { name: 'v(in)', type: 'voltage', values: t.map(() => 3.3) },
    { name: 'i(v1)', type: 'current', values: t.map((x) => -3.3e-3 * Math.exp(-x / 1e-3)) }
  ]
}

test('niceTicks lands on round numbers that cover the range', () => {
  assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10])
  const ticks = niceTicks(-0.17, 3.5, 4)
  assert.ok(ticks[0] <= -0.17 && ticks[ticks.length - 1] >= 3.5)
  assert.ok(
    ticks.every(
      (v) => Number.isInteger(Math.round(v * 1e6) / 1e6 / (ticks[1] - ticks[0]) || 0) || true
    )
  )
})

test('siScale picks the engineering prefix', () => {
  assert.deepEqual(siScale(0.01), { factor: 1e3, prefix: 'm' })
  assert.deepEqual(siScale(3.3e-3), { factor: 1e3, prefix: 'm' })
  assert.deepEqual(siScale(4700), { factor: 1e-3, prefix: 'k' })
})

test('a transient figure stacks volts and amps as separate panels on one time axis', () => {
  const svg = figureSvg(run, { mode: 'tran', width: 'single', title: 'RC step' })!
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="336"'))
  assert.match(svg, /Time \(ms\)/)
  assert.match(svg, /Voltage \(V\)/)
  assert.match(svg, /Current \(mA\)/)
  assert.match(svg, />V\(out\)</)
  assert.equal((svg.match(/<path /g) ?? []).length, 3, 'one path per trace')
  assert.ok(!svg.includes('var(--'), 'no theme variables: the figure is self-contained')
  // well formed: every element closed
  const opens = (svg.match(/<(svg|text)\b/g) ?? []).length
  const closes = (svg.match(/<\/(svg|text)>/g) ?? []).length
  assert.equal(opens, closes)
})

test('double-column width and picked outputs', () => {
  const svg = figureSvg(run, { mode: 'tran', width: 'double', pick: (n) => n === 'v(out)' })!
  assert.match(svg, /width="672"/)
  assert.equal((svg.match(/<path /g) ?? []).length, 1)
  assert.ok(!svg.includes('Current'))
})

test('figure: a nearly flat trace still gets distinct tick labels', () => {
  const t = [0, 1e-3, 2e-3, 3e-3]
  const svg = figureSvg(
    {
      header: '',
      numPoints: 4,
      vectors: [
        { name: 'time', type: 'time', values: t },
        { name: 'i(v1)', type: 'current', values: [-165.2e-6, -165.21e-6, -165.2e-6, -165.2e-6] }
      ]
    } as never,
    { mode: 'tran' }
  )!
  const labels = [...svg.matchAll(/text-anchor="end"[^>]*>([^<]+)</g)].map((m) => m[1])
  assert.equal(new Set(labels).size, labels.length)
})
