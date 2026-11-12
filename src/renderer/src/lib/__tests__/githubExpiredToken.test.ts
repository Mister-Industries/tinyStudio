/**
 * Tests for a saved GitHub sign-in that GitHub no longer accepts (401): public
 * repos must still open, anonymously, and the dead sign-in must be dropped
 * rather than failing every request while the app still shows it signed in.
 */

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { clearRepoCache, ghRepoMeta, loadAccount, saveAccount } from '../github'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  saveAccount(null)
  clearRepoCache()
})

test('a rejected token: the read retries anonymously and the sign-in is dropped', async () => {
  const seen: (string | undefined)[] = []
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
    seen.push(auth)
    if (auth) return new Response('{"message":"Bad credentials"}', { status: 401 })
    return new Response(
      JSON.stringify({ full_name: 'Mister-Industries/examples', default_branch: 'main' }),
      { status: 200 }
    )
  }) as typeof fetch
  saveAccount({ login: 'geoff', name: 'Geoff', avatarUrl: '', token: 'dead' })

  const meta = await ghRepoMeta('Mister-Industries', 'examples', 'dead')
  assert.equal(meta.branch, 'main')
  assert.deepEqual(seen, ['Bearer dead', undefined])
  assert.equal(loadAccount(), null)
})

test('a 401 for some other token leaves the current sign-in alone', async () => {
  globalThis.fetch = (async () => new Response('{}', { status: 401 })) as typeof fetch
  saveAccount({ login: 'geoff', name: 'Geoff', avatarUrl: '', token: 'good' })
  await ghRepoMeta('someone', 'private', 'other').catch(() => {})
  assert.equal(loadAccount()?.token, 'good')
})
