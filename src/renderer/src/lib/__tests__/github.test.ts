/**
 * Tests for the GitHub sync layer.
 *
 * These pin down the three failures that were silent rather than loud, which is
 * what made them expensive:
 *
 *  1. **Files vanishing.** The old fetch gated on an extension allowlist, so a
 *     file like `diagram.svg` was never downloaded *and never recorded*. Nothing
 *     errored; the project just quietly lost pieces of itself, and any copy made
 *     from it inherited the loss. The manifest now lists everything in the
 *     folder whether or not its bytes were pulled.
 *  2. **Subfolder projects flattening.** Examples open a folder *inside* a repo.
 *     With no path on the link, push wrote every file to the repo root and pull
 *     compared repo-relative keys against workspace-relative ones, so a freshly
 *     linked project reported every file as changed.
 *  3. **Unknown types being guessed as text.** Decoding an unknown binary as
 *     UTF-8 corrupts it. Anything not known to be text is carried as base64,
 *     which round-trips losslessly.
 */

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  changedPaths,
  clearRepoCache,
  deletedPaths,
  fetchBlobs,
  fetchRepoProject,
  isTextPath,
  toRepoPath,
  toWorkspaceRel
} from '../github'

const FOLDER = 'demo/Blink Example'

/** A realistic example folder, plus a repo-root file that must stay out of it. */
const TREE = [
  { path: 'README.md', size: 1200, sha: 'a1' },
  { path: `${FOLDER}/README.md`, size: 900, sha: 'b1' },
  { path: `${FOLDER}/diagram.json`, size: 3400, sha: 'b2' },
  { path: `${FOLDER}/diagram.svg`, size: 14000, sha: 'b3' },
  { path: `${FOLDER}/visual.js`, size: 2100, sha: 'b4' },
  { path: `${FOLDER}/index.html`, size: 5000, sha: 'b5' },
  { path: `${FOLDER}/sketch/sketch.ino`, size: 800, sha: 'b6' },
  { path: `${FOLDER}/photo.png`, size: 240000, sha: 'b7' },
  { path: `${FOLDER}/firmware.uf2`, size: 180000, sha: 'b8' },
  { path: `${FOLDER}/enormous.md`, size: 2_000_000, sha: 'b9' }
]

const realFetch = globalThis.fetch

/** Serve the tree/meta/blob endpoints from TREE so the suite never hits the network. */
function stubGitHub(): void {
  clearRepoCache()
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const u = String(url)
    if (u.includes('/git/trees/')) {
      return new Response(
        JSON.stringify({ truncated: false, tree: TREE.map((t) => ({ ...t, type: 'blob' })) }),
        { status: 200 }
      )
    }
    if (u.startsWith('https://api.github.com/repos/') && !u.includes('/contents/')) {
      return new Response(
        JSON.stringify({
          full_name: 'X/Y',
          default_branch: 'main',
          private: false,
          permissions: { admin: false, push: true, pull: true }
        }),
        { status: 200 }
      )
    }
    if (u.startsWith('https://raw.githubusercontent.com/')) {
      return new Response('contents of ' + decodeURIComponent(u.split('/main/')[1] ?? ''), {
        status: 200
      })
    }
    throw new Error('unexpected fetch: ' + u)
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
  clearRepoCache()
})

test('the manifest records every file in the folder, fetched or not', async () => {
  stubGitHub()
  const p = await fetchRepoProject('X', 'Y', FOLDER)
  const byRel = Object.fromEntries(p.manifest.map((m) => [m.rel, m]))

  assert.equal(p.manifest.length, 9, 'nine files live in the folder')

  // The regression that started all this: these were invisible before.
  assert.equal(byRel['diagram.svg'].skipped, false)
  assert.equal(byRel['index.html'].skipped, false)

  // Binaries are listed so a copy can reproduce them, but not downloaded now.
  assert.equal(byRel['photo.png'].binary, true)
  assert.equal(byRel['photo.png'].skipped, true)
  assert.equal(byRel['photo.png'].skipReason, 'binary')

  // Oversized text is skipped but still recorded, with a reason to show a user.
  assert.equal(byRel['enormous.md'].skipReason, 'too-large')

  // Nested paths keep their subpath relative to the folder.
  assert.equal(byRel['sketch/sketch.ino'].repoPath, `${FOLDER}/sketch/sketch.ino`)
})

test('a subfolder project does not absorb the rest of the repo', async () => {
  stubGitHub()
  const p = await fetchRepoProject('X', 'Y', FOLDER)
  assert.ok(
    p.manifest.every((m) => m.repoPath.startsWith(FOLDER + '/')),
    'nothing outside the folder is included'
  )
  assert.equal(Object.keys(p.files).length, 6, 'six text files under the size cap were fetched')
})

test('deferred bytes can be pulled later, with the right encoding', async () => {
  stubGitHub()
  const p = await fetchRepoProject('X', 'Y', FOLDER)
  const blobs = await fetchBlobs(
    { owner: 'X', repo: 'Y', branch: 'main' },
    p.manifest.filter((m) => m.skipped)
  )
  assert.equal(blobs.length, 3)
  assert.equal(blobs.find((b) => b.rel === 'photo.png')?.encoding, 'base64')
  assert.equal(blobs.find((b) => b.rel === 'enormous.md')?.encoding, 'utf-8')
})

test('paths map into and back out of a repo subfolder', () => {
  const link = { path: FOLDER }
  assert.equal(toRepoPath(link, 'sketch/sketch.ino'), `${FOLDER}/sketch/sketch.ino`)
  assert.equal(toWorkspaceRel(link, `${FOLDER}/sketch/sketch.ino`), 'sketch/sketch.ino')
  // Anything outside the folder is not this workspace's business.
  assert.equal(toWorkspaceRel(link, 'README.md'), null)
  assert.equal(toWorkspaceRel(link, 'demo/Other Example/x.ino'), null)
  assert.equal(toWorkspaceRel(link, FOLDER), null)
  // A repo-root link is a no-op in both directions.
  assert.equal(toRepoPath({ path: '' }, 'a.ino'), 'a.ino')
  assert.equal(toWorkspaceRel({ path: '' }, 'a.ino'), 'a.ino')
})

test('a round-tripped pull baseline reports no changes', () => {
  const link = { path: FOLDER }
  // Pull keys the baseline workspace-relative; collectWorkspaceFiles does too.
  // When those two disagreed, every file read as modified the moment you linked.
  const pulled = ['README.md', 'sketch/sketch.ino'].map((r) =>
    toWorkspaceRel(link, toRepoPath(link, r))
  )
  assert.deepEqual(pulled, ['README.md', 'sketch/sketch.ino'])
})

test('diffing finds edits, additions and deletions', () => {
  const base = { 'a.ino': '1', 'b.js': '2', 'gone.md': '3' }
  const current = { 'a.ino': '1', 'b.js': 'CHANGED', 'new.md': '4' }
  assert.deepEqual(changedPaths(current, base), ['b.js', 'new.md'])
  assert.deepEqual(deletedPaths(current, base), ['gone.md'])
})

test('unknown file types are treated as binary, never guessed as text', () => {
  for (const f of ['diagram.svg', 'index.html', 'sketch.ino', 'LICENSE', 'Makefile', 'data.csv']) {
    assert.equal(isTextPath(f), true, `${f} should be text`)
  }
  for (const f of ['logo.png', 'firmware.uf2', 'lib.a', 'font.woff2', 'archive.zip']) {
    assert.equal(isTextPath(f), false, `${f} should be binary`)
  }
})
