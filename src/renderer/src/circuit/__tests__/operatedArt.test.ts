/** Tests for views/partsAdapter.partArtFor: switches and buttons drawn as operated. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CircuitPart } from '../core/model'
import { partArtFor, type PartVisual } from '../views/partsAdapter'

const vis = (svg: string): PartVisual =>
  ({ def: {}, v: { svg, w: 60, h: 40, pins: {} } }) as unknown as PartVisual
const part = (type: string, closed: boolean): CircuitPart => ({
  id: 'SW1',
  type,
  attrs: closed ? { closed: true } : {}
})

const SLIDE =
  '<svg viewBox="0 0 60 40"><rect x="14" y="8" width="32" height="14" rx="3" fill="#1a1f3d"/>' +
  '<rect x="16" y="10" width="13" height="10" rx="2" fill="#cfd6ff"/></svg>'

test('slide switch: the knob moves across when closed, and only then', () => {
  assert.equal(partArtFor(part('switch-spst', false), vis(SLIDE), 'bb'), SLIDE)
  const on = partArtFor(part('switch-spst', true), vis(SLIDE), 'bb')
  assert.match(on, /<rect x="31" y="10" width="13" height="10"/)
  assert.doesNotMatch(on, /<rect x="16" y="10"/)
})

const BUTTON =
  '<svg viewBox="0 0 50.562 56.168"><g id="breadboard"><rect id="leg"/>' +
  '<ellipse fill="#DFDFDF" cx="25.014" cy="15.211" rx="17.54" ry="7.316"/>' +
  '<g><path fill="#CC1414" d="M0 0"/></g></g></svg>'

test('pushbutton: the cap (after the housing ring) sinks, clipped to the ring', () => {
  const down = partArtFor(part('pushbutton', true), vis(BUTTON), 'bb')
  assert.match(down, /<clipPath id="pb-SW1">/)
  assert.match(down, /<g transform="translate\(0 2\.6\)"><g><path fill="#CC1414"/)
  // the legs and housing stay where they are
  assert.ok(down.indexOf('<rect id="leg"/>') < down.indexOf('translate('))
  assert.ok(down.endsWith('</g></g></g></svg>'))
  assert.equal(partArtFor(part('pushbutton', false), vis(BUTTON), 'bb'), BUTTON)
})
