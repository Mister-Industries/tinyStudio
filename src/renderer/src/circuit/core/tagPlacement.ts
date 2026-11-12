/**
 * circuit/core/tagPlacement: where a new probe tag goes so it reads clearly.
 *
 * A tag dropped right where the user clicked usually lands on the wire they
 * clicked (and often on its neighbours). This tries spots around the click,
 * nearest first, on all four diagonals and then further out, and takes the
 * first one that touches no part, label, wire or other tag. If every spot is
 * taken, the least-covered one wins. Pure: boxes in, a position out.
 */

import type { Pt } from './model'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

const overlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

/**
 * Top-left corner for a `size` tag near `at`, clear of `obstacles` by `gap`.
 * Candidates go up-right first (the habit of every schematic: a reading sits
 * above and after its node), then the other diagonals, then straight up and
 * down, at growing distances.
 */
export function clearTagSpot(
  at: Pt,
  size: { w: number; h: number },
  obstacles: Box[],
  gap: number
): Pt {
  const { w, h } = size
  const near = obstacles.filter(
    (o) =>
      o.x < at.x + 8 * (w + h) &&
      o.x + o.w > at.x - 8 * (w + h) &&
      o.y < at.y + 8 * (w + h) &&
      o.y + o.h > at.y - 8 * (w + h)
  )
  const cost = (p: Pt): number => {
    const box = { x: p.x - gap, y: p.y - gap, w: w + 2 * gap, h: h + 2 * gap }
    return near.reduce((s, o) => s + overlap(box, o) + (overlap(box, o) > 0 ? 1 : 0), 0)
  }
  let best: Pt | null = null
  let bestCost = Infinity
  for (const k of [1, 2, 3, 4.5, 6]) {
    const d = gap * 2 * k
    const tries: Pt[] = [
      { x: at.x + d, y: at.y - h - d },
      { x: at.x + d, y: at.y + d },
      { x: at.x - w - d, y: at.y - h - d },
      { x: at.x - w - d, y: at.y + d },
      { x: at.x - w / 2, y: at.y - h - d * 1.5 },
      { x: at.x - w / 2, y: at.y + d * 1.5 }
    ]
    for (const p of tries) {
      const c = cost(p)
      if (c === 0) return p
      if (c < bestCost) {
        bestCost = c
        best = p
      }
    }
  }
  return best ?? { x: at.x + gap * 2, y: at.y - h - gap * 2 }
}
