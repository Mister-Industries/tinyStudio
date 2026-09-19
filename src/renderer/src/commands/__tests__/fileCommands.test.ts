/**
 * The file actions against a fake file system: opening a folder builds the
 * tree and lands on the sketch, a refresh keeps ids so tabs survive, and a
 * rename follows through to the open tab. The real Redux store is used; the
 * `fileSystem` singleton's methods are replaced for the duration.
 */
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { fileSystem, type FileSystemItem } from '../../lib/fileSystem'
import { VIRTUAL_PREFIX } from '../../lib/virtualFileSystem'
import { selectOpenFiles } from '../../redux/fileSlice'
import { store } from '../../redux/store'
import { openFileItem, openFolder, refreshWorkspace, renameItem } from '../fileCommands'

const ROOT = `${VIRTUAL_PREFIX}local/blinky`

/** A flat listing the way readDirectory(…, recursive) returns it. */
let listing: FileSystemItem[]
const contents = new Map<string, string>()
const renames: [string, string][] = []

const file = (rel: string): FileSystemItem => ({
  name: rel.split('/').pop()!,
  path: `${ROOT}/${rel}`,
  isDirectory: false,
  size: 1,
  lastModified: 0
})
const folder = (rel: string): FileSystemItem => ({
  name: rel.split('/').pop()!,
  path: `${ROOT}/${rel}`,
  isDirectory: true,
  lastModified: 0
})

const fs = fileSystem as unknown as Record<string, unknown>
fs.readDirectory = async (): Promise<FileSystemItem[]> => listing
fs.readFile = async (p: string): Promise<string> => {
  if (!contents.has(p)) throw new Error(`no such file: ${p}`)
  return contents.get(p)!
}
fs.renameFile = async (from: string, to: string): Promise<void> => {
  renames.push([from, to])
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  listing = [
    file('README.md'),
    file('blinky.ino'),
    folder('src'),
    file('src/util.h'),
    file('src/util10.h'),
    file('src/util2.h')
  ]
  contents.clear()
  contents.set(`${ROOT}/README.md`, '# Blinky')
  contents.set(`${ROOT}/blinky.ino`, 'void setup() {}')
  contents.set(`${ROOT}/src/util.h`, '// util')
  renames.length = 0
})

test('openFolder builds the tree, folders first, and opens the sketch', async () => {
  await openFolder(ROOT)
  const ws = store.getState().file.workspace
  assert.ok(ws)
  assert.equal(ws.path, ROOT)
  assert.equal(ws.name, 'blinky')
  assert.deepEqual(
    ws.root.map((i) => i.name),
    ['src', 'blinky.ino', 'README.md']
  )
  const src = ws.root[0]
  assert.equal(src.type, 'folder')
  assert.deepEqual(
    src.children!.map((i) => i.name),
    ['util.h', 'util2.h', 'util10.h'],
    'natural order: util2 before util10'
  )
  for (const child of src.children!) assert.equal(child.parentId, src.id)
  for (const top of ws.root) assert.equal(top.parentId, 'root')

  const open = selectOpenFiles(store.getState())
  assert.deepEqual(
    open.map((f) => f.name),
    ['blinky.ino'],
    'the .ino is opened, nothing else'
  )
  assert.equal(open[0].content, 'void setup() {}')
  assert.equal(store.getState().editor.docsTab, 'readme')
  await tick()
  assert.equal(store.getState().file.readmeContent, '# Blinky')
})

test('refreshWorkspace keeps the ids of everything that is still there', async () => {
  await openFolder(ROOT)
  const before = store.getState().file.workspace!
  const idsBefore = new Map<string, string>()
  const walk = (items: typeof before.root): void => {
    for (const i of items) {
      idsBefore.set(i.path!, i.id)
      if (i.children) walk(i.children)
    }
  }
  walk(before.root)

  listing = [...listing, file('src/new.h'), file('notes.txt')]
  await refreshWorkspace(before)

  const after = store.getState().file.workspace!
  const seen = new Map<string, string>()
  const walk2 = (items: typeof after.root): void => {
    for (const i of items) {
      seen.set(i.path!, i.id)
      if (i.children) walk2(i.children)
    }
  }
  walk2(after.root)
  for (const [p, id] of idsBefore) assert.equal(seen.get(p), id, `${p} keeps its id`)
  assert.ok(seen.has(`${ROOT}/src/new.h`))
  assert.ok(seen.has(`${ROOT}/notes.txt`))
  assert.equal(seen.size, idsBefore.size + 2)
  // the open tab still refers to a live tree item
  const tab = selectOpenFiles(store.getState())[0]
  assert.equal(seen.get(tab.path), tab.id)
})

test('renameItem renames on disk and moves the open tab with it', async () => {
  await openFolder(ROOT)
  const ws = store.getState().file.workspace!
  const util = ws.root[0].children!.find((i) => i.name === 'util.h')!
  await openFileItem(util)
  assert.ok(selectOpenFiles(store.getState()).some((f) => f.path === util.path))

  await renameItem(util, 'helpers.h')
  assert.deepEqual(renames, [[`${ROOT}/src/util.h`, `${ROOT}/src/helpers.h`]])
  const tab = selectOpenFiles(store.getState()).find((f) => f.id === util.id)!
  assert.equal(tab.path, `${ROOT}/src/helpers.h`)
  assert.equal(tab.name, 'helpers.h')
  // the sketch tab is untouched
  const ino = selectOpenFiles(store.getState()).find((f) => f.name === 'blinky.ino')!
  assert.equal(ino.path, `${ROOT}/blinky.ino`)
})
