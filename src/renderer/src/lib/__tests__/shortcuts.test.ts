import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SHORTCUTS, keysOf, matches, shortcutsByScope } from '../shortcuts'

const ev = (
  key: string,
  mods: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}
): { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean } => ({
  key,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt
})

test('every id is unique', () => {
  const ids = SHORTCUTS.map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('matches respects the modifier, Shift and letter case', () => {
  assert.ok(matches(ev('z', { ctrl: true }), 'circuit.undo'))
  assert.ok(matches(ev('Z', { meta: true }), 'circuit.undo'), '⌘ counts as the modifier')
  assert.ok(!matches(ev('z'), 'circuit.undo'), 'no modifier')
  assert.ok(!matches(ev('z', { ctrl: true, shift: true }), 'circuit.undo'), 'Shift is redo')
  assert.ok(matches(ev('z', { ctrl: true, shift: true }), 'circuit.redoAlt'))
  assert.ok(!matches(ev('z', { ctrl: true, alt: true }), 'circuit.undo'), 'Alt never matches')
})

test('multi-key entries and Shift variants stay apart', () => {
  assert.ok(matches(ev('ArrowLeft'), 'circuit.nudge'))
  assert.ok(!matches(ev('ArrowLeft', { shift: true }), 'circuit.nudge'))
  assert.ok(matches(ev('ArrowLeft', { shift: true }), 'circuit.nudgeBig'))
  assert.ok(matches(ev('Backspace'), 'circuit.delete'))
  assert.ok(matches(ev(' '), 'circuit.straightWire'))
})

test('keysOf renders a readable binding', () => {
  assert.match(keysOf('circuit.undo'), /^(Ctrl\+Z|⌘Z)$/)
  assert.match(keysOf('code.prevTab'), /^(Ctrl\+Shift\+Tab|⌘⇧Tab)$/)
  assert.equal(keysOf('circuit.nudgeBig'), 'Shift+Arrows')
  assert.equal(keysOf('circuit.straightWire'), 'Space (hold)')
})

test('the dialog lists every scope and hides alternates', () => {
  const groups = shortcutsByScope()
  assert.deepEqual(
    groups.map((g) => g.scope),
    ['global', 'code', 'circuit', 'parts']
  )
  const listed = groups.flatMap((g) => g.items.map((s) => s.id))
  assert.ok(!listed.includes('circuit.redoAlt'))
  assert.ok(listed.includes('global.shortcuts'))
})
