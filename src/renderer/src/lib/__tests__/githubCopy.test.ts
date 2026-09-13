/**
 * Tests for "make it mine" — copying a read-only project into a repo the user owns.
 *
 * The failure this guards against is a *quiet* one. The working tree only holds
 * the files the editor needed to open, so a copy built from it alone silently
 * drops images, diagram.svg and anything else that was deferred — and the user
 * doesn't find out until much later, looking at a repo that's missing pieces.
 * A copy must reproduce the whole source folder, not the part that happened to
 * be in memory.
 */

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  clearRepoCache,
  copyProjectToNewRepo,
  sanitizeRepoName,
  type RepoFileEntry
} from '../github'
import type { WorkspaceSource } from '../../redux/fileSlice'

const realFetch = globalThis.fetch

interface Put {
  path: string
  content: string
  branch: string
}

/** Stub GitHub and record every file written to the new repo. */
function stubGitHub(opts: { failOn?: string[] } = {}): Put[] {
  clearRepoCache()
  const puts: Put[] = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith('/user/repos') && init?.method === 'POST') {
      return new Response(JSON.stringify({ full_name: 'geoff/my-blink', default_branch: 'main' }), {
        status: 201
      })
    }
    if (u.includes('/contents/')) {
      // The sha lookup on a fresh repo: nothing is there yet.
      if (!init?.method || init.method === 'GET') return new Response('', { status: 404 })
      if (init.method === 'PUT') {
        const path = decodeURIComponent(u.split('/contents/')[1])
        if (opts.failOn?.some((f) => path.endsWith(f))) {
          return new Response(JSON.stringify({ message: 'nope' }), { status: 422 })
        }
        const body = JSON.parse(String(init.body)) as { content: string; branch: string }
        puts.push({ path, content: body.content, branch: body.branch })
        return new Response(JSON.stringify({}), { status: 201 })
      }
    }
    if (u.startsWith('https://raw.githubusercontent.com/')) {
      const path = decodeURIComponent(u.split('/main/')[1] ?? '')
      // A byte sequence that is NOT valid UTF-8, standing in for a real binary.
      if (path.endsWith('.png')) {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01]))
      }
      return new Response('deferred text of ' + path)
    }
    throw new Error('unexpected fetch: ' + u)
  }) as typeof fetch
  return puts
}

afterEach(() => {
  globalThis.fetch = realFetch
  clearRepoCache()
})

const entry = (over: Partial<RepoFileEntry>): RepoFileEntry => ({
  rel: 'x',
  repoPath: 'demo/Blink Example/x',
  size: 10,
  binary: false,
  skipped: false,
  sha: 'deadbeef',
  ...over
})

const SOURCE: WorkspaceSource = {
  owner: 'Mister-Industries',
  repo: 'tinyStudio',
  branch: 'main',
  path: 'demo/Blink Example',
  truncated: false,
  canPush: false,
  manifest: [
    entry({ rel: 'sketch.ino', repoPath: 'demo/Blink Example/sketch.ino' }),
    entry({
      rel: 'photo.png',
      repoPath: 'demo/Blink Example/photo.png',
      binary: true,
      skipped: true,
      skipReason: 'binary'
    }),
    entry({
      rel: 'enormous.md',
      repoPath: 'demo/Blink Example/enormous.md',
      skipped: true,
      skipReason: 'too-large'
    })
  ]
}

const b64 = (s: string): string => Buffer.from(s, 'utf-8').toString('base64')

test('the copy includes files the editor never downloaded', async () => {
  const puts = stubGitHub()
  const result = await copyProjectToNewRepo({
    name: 'my-blink',
    token: 't',
    files: { 'sketch.ino': 'void setup(){}' },
    source: SOURCE
  })

  const paths = puts.map((p) => p.path).sort()
  assert.deepEqual(paths, ['enormous.md', 'photo.png', 'sketch.ino'])
  assert.equal(result.copied, 3)
  assert.deepEqual(result.failed, [])
})

test('binaries survive the round trip byte-for-byte', async () => {
  const puts = stubGitHub()
  await copyProjectToNewRepo({ name: 'my-blink', token: 't', files: {}, source: SOURCE })

  const png = puts.find((p) => p.path === 'photo.png')!
  // Decoding as UTF-8 anywhere in the chain would have mangled 0xFF 0xFE.
  assert.deepEqual(
    [...Buffer.from(png.content, 'base64')],
    [0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01]
  )
})

test('the working tree wins over the source — edits are what get copied', async () => {
  const puts = stubGitHub()
  await copyProjectToNewRepo({
    name: 'my-blink',
    token: 't',
    files: { 'sketch.ino': 'MY EDIT' },
    source: SOURCE
  })
  const ino = puts.find((p) => p.path === 'sketch.ino')!
  assert.equal(Buffer.from(ino.content, 'base64').toString('utf-8'), 'MY EDIT')
  // and the deferred fetch must not have overwritten it
  assert.notEqual(ino.content, b64('deferred text of demo/Blink Example/sketch.ino'))
})

test('the copy is rooted at the new repo top level, not the source subfolder', async () => {
  const puts = stubGitHub()
  const { link } = await copyProjectToNewRepo({
    name: 'my-blink',
    token: 't',
    files: { 'sketch/sketch.ino': 'x' },
    source: SOURCE
  })
  assert.equal(link.path, '', 'a copy is a project in its own right')
  assert.equal(link.remote, 'geoff/my-blink')
  assert.ok(
    puts.every((p) => !p.path.startsWith('demo/')),
    'nothing lands under the original folder name'
  )
})

test('a fresh copy has nothing left to push', async () => {
  stubGitHub()
  const files = { 'sketch.ino': 'void setup(){}', 'README.md': '# hi' }
  const { link } = await copyProjectToNewRepo({ name: 'my-blink', token: 't', files })
  // The baseline is the text working tree, which is exactly what the next diff
  // reads back — so the change list starts empty instead of "everything".
  assert.deepEqual(link.base, files)
})

test('files that fail to copy are reported, not silently dropped', async () => {
  stubGitHub({ failOn: ['photo.png'] })
  const result = await copyProjectToNewRepo({
    name: 'my-blink',
    token: 't',
    files: { 'sketch.ino': 'x' },
    source: SOURCE
  })
  assert.deepEqual(result.failed, ['photo.png'])
  assert.equal(result.copied, 2)
})

test('repo names are sanitized up front, not silently by GitHub', () => {
  assert.equal(sanitizeRepoName('Blink Example'), 'Blink-Example')
  assert.equal(sanitizeRepoName('  my/weird:name!  '), 'my-weird-name')
  assert.equal(sanitizeRepoName('--leading-and-trailing--'), 'leading-and-trailing')
  assert.equal(sanitizeRepoName('already-fine_1.0'), 'already-fine_1.0')
})
