/**
 * Tests for the web Studio AI workspace path guard.
 *
 * In the browser the agent's file tools run in the page against the user's
 * picked folder or a mem:// project, so this is the only thing standing between
 * a model-supplied path and files outside the workspace.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workspaceRelative } from '../webAgent'

const ROOT = 'mem://geoff/my-blink'

test('relative paths are normalised', () => {
  assert.equal(workspaceRelative(ROOT, 'sketch/sketch.ino'), 'sketch/sketch.ino')
  assert.equal(workspaceRelative(ROOT, './sketch//sketch.ino'), 'sketch/sketch.ino')
  assert.equal(workspaceRelative(ROOT, 'sketch\\sketch.ino'), 'sketch/sketch.ino')
  assert.equal(workspaceRelative(ROOT, 'a/../b.txt'), 'b.txt')
})

test('the root itself resolves to the empty path', () => {
  assert.equal(workspaceRelative(ROOT, '.'), '')
  assert.equal(workspaceRelative(ROOT, ROOT), '')
  assert.equal(workspaceRelative('', '.'), '')
})

test('a path echoing the workspace root is accepted', () => {
  assert.equal(workspaceRelative(ROOT, `${ROOT}/README.md`), 'README.md')
})

test('climbing out of the workspace is blocked', () => {
  assert.throws(() => workspaceRelative(ROOT, '../other/secret.txt'), /outside the workspace/)
  assert.throws(() => workspaceRelative(ROOT, 'a/../../x'), /outside the workspace/)
  assert.throws(() => workspaceRelative('', '..'), /outside the workspace/)
})

test('a sibling root sharing the prefix stays inside this workspace', () => {
  // Not stripped as "the root": it becomes a (non-existent) path under ROOT,
  // never a path into the sibling project.
  assert.equal(workspaceRelative(ROOT, 'mem://geoff/my-blink-2/x'), 'mem:/geoff/my-blink-2/x')
})
