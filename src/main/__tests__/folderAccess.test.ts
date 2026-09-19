/**
 * folderAccess decides which paths the renderer may touch. `electron` is
 * stubbed by the test runner: app.getPath answers from the environment set
 * below, so each run gets its own userData and Documents folders.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
// The module reads its paths lazily, on the first call, so the environment set
// below is in place by the time any test runs.
import { examplesDir, grantFolder, hasAccess, requireAccess } from '../folderAccess'

const base = mkdtempSync(path.join(tmpdir(), 'tinystudio-access-'))
const userData = path.join(base, 'userdata')
const documents = path.join(base, 'docs')
const granted = path.join(base, 'projects', 'blinky')
const sibling = path.join(base, 'projects', 'other')
mkdirSync(userData, { recursive: true })
mkdirSync(granted, { recursive: true })
writeFileSync(path.join(userData, 'folder-access.json'), JSON.stringify({ folders: [granted] }))
process.env.TINYSTUDIO_TEST_USERDATA = userData
process.env.TINYSTUDIO_TEST_DOCUMENTS = documents

test('a granted folder and everything inside it is accessible; siblings are not', () => {
  assert.equal(hasAccess(granted), true)
  assert.equal(hasAccess(path.join(granted, 'blinky.ino')), true)
  assert.equal(hasAccess(path.join(granted, 'src', 'deep', 'file.h')), true)
  assert.equal(hasAccess(sibling), false)
  assert.equal(hasAccess(path.join(base, 'projects')), false, 'the parent is not granted')
  assert.equal(hasAccess(granted + '-suffix'), false, 'a longer sibling name is not a subfolder')
})

test('nothing else counts as a path', () => {
  assert.equal(hasAccess(''), false)
  assert.equal(hasAccess(undefined), false)
  assert.equal(hasAccess(42), false)
  assert.equal(hasAccess(null), false)
})

test('the examples folder under Documents is always accessible', () => {
  assert.equal(examplesDir(), path.join(documents, 'tinyStudio Examples'))
  assert.equal(hasAccess(path.join(examplesDir(), 'owner', 'repo', 'blink', 'blink.ino')), true)
  assert.equal(hasAccess(path.join(documents, 'elsewhere')), false)
})

test('case is ignored except on Linux', () => {
  const upper = granted.toUpperCase()
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!
  try {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    assert.equal(hasAccess(upper), true)
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    assert.equal(hasAccess(upper), true)
    Object.defineProperty(process, 'platform', { value: 'linux' })
    assert.equal(hasAccess(upper), upper === granted, 'Linux file systems are case-sensitive')
    assert.equal(hasAccess(granted), true)
  } finally {
    Object.defineProperty(process, 'platform', original)
  }
})

test('requireAccess returns the absolute path or explains what to do', () => {
  assert.equal(requireAccess(granted), path.resolve(granted))
  assert.throws(() => requireAccess(sibling), /Open its folder first/)
})

test('granting a folder makes it accessible now and after a restart', async () => {
  assert.equal(hasAccess(sibling), false)
  await grantFolder(sibling)
  assert.equal(hasAccess(path.join(sibling, 'a.ino')), true)
  const saved = JSON.parse(readFileSync(path.join(userData, 'folder-access.json'), 'utf-8'))
  assert.deepEqual(saved.folders, [granted, path.resolve(sibling)])
  // granting again is a no-op
  await grantFolder(sibling)
  const again = JSON.parse(readFileSync(path.join(userData, 'folder-access.json'), 'utf-8'))
  assert.equal(again.folders.length, 2)
})
