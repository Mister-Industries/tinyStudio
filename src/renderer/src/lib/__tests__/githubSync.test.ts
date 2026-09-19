/**
 * Push and Pull against a fake GitHub: one commit per push with deletions,
 * refusing to overwrite changes made on GitHub, pulls that keep local edits,
 * and linking a clone to the commit it has checked out.
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { RepoLink } from '../github'
import {
  conflictingPaths,
  defaultPushMessage,
  gitBlobSha,
  linkForClone,
  pullDecision,
  pullFiles,
  PushConflictError,
  pushFiles
} from '../githubSync'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const link = (base: Record<string, string>, extra: Partial<RepoLink> = {}): RepoLink => ({
  remote: 'octo/blink',
  branch: 'main',
  path: '',
  base,
  ...extra
})

interface Call {
  method: string
  url: string
  body?: Record<string, unknown>
}

/** Serve one branch at `head` with `files` (repo path -> text). */
function fakeGitHub(
  remote: { head: string; tree: string; files: Record<string, string> },
  opts: { refUpdateStatus?: number; missingCommits?: boolean } = {}
): Call[] {
  const calls: Call[] = []
  const api = 'https://api.github.com/repos/octo/blink'
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ method, url, body })
    const json = (x: unknown, status = 200): Response => new Response(JSON.stringify(x), { status })

    if (url === `${api}/git/ref/heads/main`) return json({ object: { sha: remote.head } })
    if (url === `${api}/git/commits/${remote.head}`) return json({ tree: { sha: remote.tree } })
    if (url.startsWith(`${api}/git/commits/`) && method === 'GET' && opts.missingCommits) {
      return json({ message: 'No commit found for SHA' }, 422)
    }
    if (url === `${api}/git/trees/${remote.tree}?recursive=1`) {
      const tree = await Promise.all(
        Object.entries(remote.files).map(async ([path, text]) => ({
          path,
          mode: '100644',
          type: 'blob',
          sha: await gitBlobSha(text),
          size: text.length
        }))
      )
      return json({ truncated: false, tree })
    }
    if (url.startsWith(`https://raw.githubusercontent.com/octo/blink/${remote.head}/`)) {
      const path = decodeURIComponent(url.split(`/${remote.head}/`)[1])
      return new Response(remote.files[path])
    }
    if (method === 'POST' && url === `${api}/git/trees`) return json({ sha: 'new-tree' }, 201)
    if (method === 'POST' && url === `${api}/git/commits`) return json({ sha: 'new-commit' }, 201)
    if (method === 'PATCH' && url === `${api}/git/refs/heads/main`) {
      return opts.refUpdateStatus
        ? json({ message: 'Update is not a fast forward' }, opts.refUpdateStatus)
        : json({ object: { sha: body?.sha } })
    }
    throw new Error(`unexpected ${method} ${url}`)
  }) as typeof fetch
  return calls
}

const writes = (calls: Call[]): Call[] => calls.filter((c) => c.method !== 'GET')

test('blob ids match git hash-object', async () => {
  assert.equal(await gitBlobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
  assert.equal(await gitBlobSha('hello'), 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0')
  assert.equal(await gitBlobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a')
  assert.equal(
    await gitBlobSha('void setup() {}\r\nvoid loop() {}\r\n'),
    'ec5791848cfafe37e6481bdf5b32925233c7bb11'
  )
  assert.equal(await gitBlobSha('héllo ✓\n'), '922546d2b370fcdb20dec9db061f2960c3a118cd')
})

test('a push makes one commit with edits, additions and deletions', async () => {
  const synced = { 'blink.ino': 'v1', 'notes.md': 'same', 'gone.md': 'bye' }
  const calls = fakeGitHub({ head: 'head-1', tree: 'tree-1', files: synced })
  const current = { 'blink.ino': 'v2', 'notes.md': 'same', 'new.md': 'hello' }

  const r = await pushFiles(link(synced), current, 'token', 'Blink faster')

  const w = writes(calls)
  assert.deepEqual(
    w.map((c) => `${c.method} ${c.url.replace('https://api.github.com/repos/octo/blink', '')}`),
    ['POST /git/trees', 'POST /git/commits', 'PATCH /git/refs/heads/main']
  )
  assert.equal(w[0].body?.base_tree, 'tree-1')
  assert.deepEqual(w[0].body?.tree, [
    { path: 'blink.ino', mode: '100644', type: 'blob', content: 'v2' },
    { path: 'new.md', mode: '100644', type: 'blob', content: 'hello' },
    { path: 'gone.md', mode: '100644', type: 'blob', sha: null }
  ])
  assert.deepEqual(w[1].body, { message: 'Blink faster', tree: 'new-tree', parents: ['head-1'] })
  assert.deepEqual(w[2].body, { sha: 'new-commit', force: false })

  assert.equal(r.pushed, 3)
  assert.equal(r.link.commit, 'new-commit')
  assert.deepEqual(r.link.base, current)
  assert.equal(r.link.baseSha?.['blink.ino'], await gitBlobSha('v2'))
  assert.equal(r.link.baseSha?.['gone.md'], undefined)
})

test('a subfolder project pushes into its folder with a default message', async () => {
  const folder = 'examples/blink'
  const synced = { 'blink.ino': 'v1' }
  const calls = fakeGitHub({ head: 'h', tree: 't', files: { [`${folder}/blink.ino`]: 'v1' } })

  await pushFiles(link(synced, { path: folder }), { 'blink.ino': 'v2' }, 'token')

  const [tree, commit] = writes(calls)
  assert.deepEqual(tree.body?.tree, [
    { path: `${folder}/blink.ino`, mode: '100644', type: 'blob', content: 'v2' }
  ])
  assert.equal(commit.body?.message, 'Update blink.ino')
})

test('a push stops, writing nothing, when GitHub changed a file it would overwrite', async () => {
  const synced = { 'blink.ino': 'v1', 'notes.md': 'same' }
  const calls = fakeGitHub({
    head: 'h',
    tree: 't',
    files: { 'blink.ino': 'their v2', 'notes.md': 'same' }
  })

  await assert.rejects(
    pushFiles(link(synced), { 'blink.ino': 'my v2', 'notes.md': 'same' }, 'token'),
    (e: unknown) => e instanceof PushConflictError && e.paths.join() === 'blink.ino'
  )
  assert.equal(writes(calls).length, 0)
})

test('the same change already on GitHub is not a conflict and is not sent again', async () => {
  const calls = fakeGitHub({ head: 'h', tree: 't', files: { 'blink.ino': 'v2' } })

  const r = await pushFiles(link({ 'blink.ino': 'v1' }), { 'blink.ino': 'v2' }, 'token')

  assert.equal(writes(calls).length, 0)
  assert.equal(r.pushed, 0)
  assert.deepEqual(r.link.base, { 'blink.ino': 'v2' })
  assert.equal(r.link.commit, 'h')
})

test('a branch that moves during the push asks to push again', async () => {
  fakeGitHub({ head: 'h', tree: 't', files: { 'blink.ino': 'v1' } }, { refUpdateStatus: 422 })
  await assert.rejects(
    pushFiles(link({ 'blink.ino': 'v1' }), { 'blink.ino': 'v2' }, 'token'),
    /changed on GitHub while pushing\. Push again/
  )
})

test('conflicts are files GitHub changed to something other than ours', () => {
  const ids = {
    remote: { a: 'r', b: 's', c: undefined, d: 'o' },
    synced: { a: 'r', b: 's1', c: 'c1', d: 'd1' },
    ours: { a: 'o', b: 'o', c: 'o', d: 'o' }
  }
  assert.deepEqual(conflictingPaths(['a', 'b', 'c', 'd'], ids), ['b', 'c'])
})

test('the default message names one or two files, and counts more', () => {
  assert.equal(defaultPushMessage(['sketch/blink.ino'], []), 'Update blink.ino')
  assert.equal(defaultPushMessage([], ['old.md']), 'Delete old.md')
  assert.equal(defaultPushMessage(['a.ino', 'b.js'], []), 'Update a.ino and b.js')
  assert.equal(defaultPushMessage(['a', 'b', 'c'], []), 'Update 3 files')
  assert.equal(defaultPushMessage(['a', 'b'], ['c']), 'Update 2 files, delete 1')
  assert.equal(defaultPushMessage([], ['a', 'b']), 'Delete 2 files')
})

test('pull decisions keep local edits and take GitHub’s', () => {
  assert.equal(pullDecision('x', 'x', 'y', false), 'take')
  assert.equal(pullDecision('mine', 'x', 'x', false), 'ours')
  assert.equal(pullDecision('mine', 'x', 'theirs', false), 'conflict')
  assert.equal(pullDecision('same', 'x', 'same', false), 'same')
  assert.equal(pullDecision(undefined, undefined, 'new', false), 'take')
  assert.equal(pullDecision(undefined, 'x', 'x', false), 'ours')
  assert.equal(pullDecision('mine', undefined, 'theirs', true), 'take')
})

test('a pull takes GitHub’s changes, keeps local edits GitHub also changed, and removes deleted files', async () => {
  const synced = { 'a.ino': 'a1', 'b.js': 'b1', 'c.md': 'c1', 'd.md': 'd1', 'e.md': 'e1' }
  fakeGitHub({
    head: 'h3',
    tree: 't3',
    files: { 'a.ino': 'a2', 'b.js': 'b2', 'c.md': 'c1', 'e.md': 'e1', 'new.md': 'n1' }
  })
  const current = { 'a.ino': 'a1', 'b.js': 'b-mine', 'c.md': 'c-mine', 'd.md': 'd1', 'e.md': 'e1' }

  const r = await pullFiles(link(synced), current)

  assert.deepEqual(r.writes, { 'a.ino': 'a2', 'new.md': 'n1' })
  assert.deepEqual(r.kept, ['b.js'])
  assert.deepEqual(r.removes, ['d.md'])
  assert.deepEqual(r.link.base, {
    'a.ino': 'a2',
    'b.js': 'b2',
    'c.md': 'c1',
    'e.md': 'e1',
    'new.md': 'n1'
  })
  assert.equal(r.link.commit, 'h3')
})

test('a clone links to the commit it has checked out, text files only', async () => {
  fakeGitHub({ head: 'abc123', tree: 'tree', files: { 'blink.ino': 'x', 'logo.png': 'binary' } })

  const r = await linkForClone({ owner: 'octo', repo: 'blink', branch: 'main', head: 'abc123' })

  assert.ok('link' in r)
  assert.deepEqual(r.link.base, { 'blink.ino': 'x' })
  assert.equal(r.link.baseSha?.['blink.ino'], await gitBlobSha('x'))
  assert.equal(r.link.commit, 'abc123')
  assert.deepEqual(r.link.clone, { head: 'abc123' })
})

test('a clone whose commit is not on GitHub is not linked', async () => {
  fakeGitHub({ head: 'on-github', tree: 't', files: {} }, { missingCommits: true })

  const r = await linkForClone({ owner: 'octo', repo: 'blink', branch: 'main', head: 'local-only' })

  assert.ok('problem' in r)
  assert.equal(r.problem, 'not-on-github')
})
