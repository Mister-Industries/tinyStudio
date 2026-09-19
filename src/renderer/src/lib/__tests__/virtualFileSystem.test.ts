/**
 * Tests for the in-memory workspace, focused on re-rooting.
 *
 * When a read-only example becomes the user's own repo, the project has to move
 * from `mem://<their-owner>/<their-repo>/<folder>` to `mem://<user>/<new-repo>`.
 * If the move is partial the result is worse than not moving: edits stay filed
 * under the example's key, so they look lost in the new project *and* keep
 * shadowing the original example on every future open.
 */

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { isVirtualPath, virtualFileSystem } from '../virtualFileSystem'

const OLD = 'mem://Mister-Industries/tinyStudio/demo/Blink Example'
const NEW = 'mem://geoff/my-blink'

afterEach(() => virtualFileSystem.clear())

test('re-rooting moves every file and folder to the new root', async () => {
  await virtualFileSystem.seed(OLD, {
    'sketch/sketch.ino': 'void setup(){}',
    'README.md': '# blink',
    'diagram.json': '{}'
  })
  await virtualFileSystem.rerootTo(OLD, NEW)

  assert.equal(await virtualFileSystem.readFile(`${NEW}/sketch/sketch.ino`), 'void setup(){}')
  assert.equal(await virtualFileSystem.pathExists(`${NEW}/README.md`), true)
  assert.equal(await virtualFileSystem.pathExists(`${OLD}/README.md`), false)
  // The intermediate folder has to come along, or the tree renders empty.
  assert.equal(await virtualFileSystem.pathExists(`${NEW}/sketch`), true)
})

test('edits made before the move are the ones that survive it', async () => {
  await virtualFileSystem.seed(OLD, { 'sketch.ino': 'original' })
  await virtualFileSystem.writeFile(`${OLD}/sketch.ino`, 'my edit')
  await virtualFileSystem.rerootTo(OLD, NEW)
  assert.equal(await virtualFileSystem.readFile(`${NEW}/sketch.ino`), 'my edit')
})

test('the old root is left completely empty', async () => {
  await virtualFileSystem.seed(OLD, { a: '1', 'deep/b': '2' })
  await virtualFileSystem.rerootTo(OLD, NEW)
  const stale = await virtualFileSystem.readDirectory(OLD, true)
  assert.deepEqual(stale, [], 'nothing may be left behind to shadow the example')
})

test('re-rooting to the same path is a no-op, not a wipe', async () => {
  await virtualFileSystem.seed(OLD, { a: '1' })
  await virtualFileSystem.rerootTo(OLD, OLD)
  assert.equal(await virtualFileSystem.readFile(`${OLD}/a`), '1')
})

test('the new root reads back as a listable directory', async () => {
  await virtualFileSystem.seed(OLD, { 'sketch.ino': 'x', 'lib/util.h': 'y' })
  await virtualFileSystem.rerootTo(OLD, NEW)
  const top = await virtualFileSystem.readDirectory(NEW, false)
  assert.deepEqual(
    top.map((i) => i.name).sort(),
    ['lib', 'sketch.ino'],
    'one file and one folder at the top level'
  )
  assert.equal(isVirtualPath(NEW), true)
})
