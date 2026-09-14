/**
 * The symbol editor's data model: layouts from pin names and from existing
 * art, well-formedness, pin geometry on the grid, and an SVG the parts
 * pipeline reads back with the same pins.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  draftFromPins,
  draftFromView,
  nearestSlot,
  normalizeDraft,
  pinTip,
  renderDraft,
  sideLength,
  type SymbolDraft
} from '../parts/symbolDraft'
import { scanPins } from '../parts/svgArt'
import { SCH_GRID as P } from '../parts/style'

test('draftFromPins splits the pins left and right like the generated box', () => {
  const d = draftFromPins(['OUT', 'VCC', 'GND'], 'IR Receiver')
  assert.deepEqual(
    d.pins.map((p) => `${p.name}:${p.side}${p.pos}`),
    ['OUT:L1', 'VCC:L2', 'GND:R1']
  )
  assert.equal(d.h, 3, 'two rows plus one')
  assert.equal(d.shape, 'rect')
})

test('normalizeDraft keeps pins on slots their side has and never on one slot twice', () => {
  const d = normalizeDraft({
    name: 'X',
    shape: 'rect',
    fill: 'none',
    w: 4,
    h: 3,
    pins: [
      { name: 'A', side: 'L', pos: 1 },
      { name: 'B', side: 'L', pos: 1 },
      { name: 'C', side: 'L', pos: 9 },
      { name: 'D', side: 'T', pos: 0 }
    ]
  })
  assert.equal(sideLength(d, 'L'), 2)
  assert.deepEqual(
    d.pins.map((p) => `${p.name}:${p.side}${p.pos}`),
    ['A:L1', 'B:L2', 'D:T1'],
    'C had no free slot left on a side of length 2'
  )
  assert.deepEqual(normalizeDraft({ ...d, shape: 'circle', w: 3, h: 5 }).w, 5, 'a circle is square')
})

test('pin tips land on the grid at the art edge', () => {
  const d = draftFromPins(['A', 'B', 'C', 'D'], 'U')
  const { w, h } = renderDraft(d)
  for (const pin of d.pins) {
    const [x, y] = pinTip(d, pin)
    assert.ok([0, w].includes(x) || [0, h].includes(y), `${pin.name} on an edge`)
    const onGrid = (n: number): boolean => Math.abs(n / P - Math.round(n / P)) < 1e-6
    assert.ok(onGrid(x) && onGrid(y), `${pin.name} at ${x},${y} is on the grid`)
  }
})

test('the rendered SVG scans back to the same pins, for every shape and fill', () => {
  for (const shape of ['rect', 'circle', 'triangle'] as const) {
    for (const fill of ['none', 'white', 'yellow'] as const) {
      const d: SymbolDraft = {
        name: 'Op amp',
        shape,
        fill,
        w: 4,
        h: 4,
        pins: [
          { name: 'IN+', side: 'L', pos: 1 },
          { name: 'IN-', side: 'L', pos: 3 },
          { name: 'OUT', side: 'R', pos: 2 },
          { name: 'V+', side: 'T', pos: 2 },
          { name: 'V-', side: 'B', pos: 2 }
        ]
      }
      const r = renderDraft(d)
      const scanned = Object.fromEntries(scanPins(r.svg, r.w, r.h).pins.map((p) => [p.name, p.at]))
      assert.deepEqual(scanned, r.pins, `${shape}/${fill}`)
      assert.match(r.svg, /id="pin-IN\+"/)
      assert.match(r.svg, fill === 'none' ? /fill="none" stroke="#000000"/ : /fill="#ff/)
      assert.match(r.svg, /Op amp/)
    }
  }
})

test('draftFromView puts each pin on the side of the art it is nearest', () => {
  const view = {
    svg: '<svg/>',
    w: 6 * P,
    h: 5 * P,
    pins: { A: [0, 2 * P], B: [6 * P, 3 * P], C: [3 * P, 0], D: [0, 4 * P] } as Record<
      string,
      [number, number]
    >
  }
  const d = draftFromView(view, 'Part')
  assert.deepEqual(
    d.pins.map((p) => `${p.name}:${p.side}${p.pos}`),
    ['A:L1', 'D:L2', 'B:R1', 'C:T1']
  )
  assert.equal(d.w, 4)
  assert.equal(d.h, 3)
})

test('nearestSlot maps a dragged point to the closest side and grid slot', () => {
  const d = draftFromPins(['A', 'B', 'C', 'D'], 'U') // body 4 wide, 3 tall
  const { w, h } = renderDraft(d)
  assert.deepEqual(nearestSlot(d, 1, 2 * P), { side: 'L', pos: 1 })
  assert.deepEqual(nearestSlot(d, w - 1, 3 * P + 2), { side: 'R', pos: 2 })
  assert.deepEqual(nearestSlot(d, 3 * P, 1), { side: 'T', pos: 2 })
  assert.deepEqual(nearestSlot(d, 3 * P, h - 1), { side: 'B', pos: 2 })
  assert.deepEqual(nearestSlot(d, 1, h - 2), { side: 'L', pos: sideLength(d, 'L') }, 'clamped')
})
