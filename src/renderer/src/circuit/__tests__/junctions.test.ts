/** Tests for core/junctions: solder dots where three or more conductors meet. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { junctionPoints } from '../core/junctions'

const G = 4.8

test('a T on one net gets a dot; a plain crossing of two nets does not', () => {
  const tee = junctionPoints(
    [
      {
        net: 'a',
        pts: [
          { x: 0, y: 0 },
          { x: 96, y: 0 }
        ]
      },
      {
        net: 'a',
        pts: [
          { x: 48, y: 0 },
          { x: 48, y: 48 }
        ]
      }
    ],
    [],
    G
  )
  assert.deepEqual(tee, [{ x: 48, y: 0 }])
  const cross = junctionPoints(
    [
      {
        net: 'a',
        pts: [
          { x: 0, y: 24 },
          { x: 96, y: 24 }
        ]
      },
      {
        net: 'b',
        pts: [
          { x: 48, y: 0 },
          { x: 48, y: 48 }
        ]
      }
    ],
    [],
    G
  )
  assert.deepEqual(cross, [])
})

test('wires sharing a track and branching off it get one dot at the branch', () => {
  const dots = junctionPoints(
    [
      {
        net: 'a',
        pts: [
          { x: 0, y: 0 },
          { x: 96, y: 0 }
        ]
      },
      // runs along the first wire, then turns down at x = 48
      {
        net: 'a',
        pts: [
          { x: 0, y: 0 },
          { x: 48, y: 0 },
          { x: 48, y: 48 }
        ]
      }
    ],
    [],
    G
  )
  assert.deepEqual(dots, [{ x: 48, y: 0 }])
})

test('a pin with two wires on it is a three-way junction', () => {
  const dots = junctionPoints(
    [
      {
        net: 'a',
        pts: [
          { x: 0, y: 0 },
          { x: 48, y: 0 }
        ]
      },
      {
        net: 'a',
        pts: [
          { x: 0, y: 0 },
          { x: 0, y: 48 }
        ]
      }
    ],
    [{ x: 0, y: 0 }],
    G
  )
  assert.deepEqual(dots, [{ x: 0, y: 0 }])
})
