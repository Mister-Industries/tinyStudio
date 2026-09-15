/**
 * Saving the account announces it. Browser sign-in finishes in App.tsx, outside
 * every sign-in surface, so without the event the header and the GitHub panel
 * kept showing "signed out" until a reload.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GITHUB_ACCOUNT_EVENT, loadAccount, saveAccount, type GitHubAccount } from '../github'

// The stubs go in after the import, so github.ts initializes the way it does
// under the other node tests: without a window.
const backing = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string): string | null => backing.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      backing.set(k, String(v))
    },
    removeItem: (k: string): void => {
      backing.delete(k)
    }
  }
})
const page = new EventTarget()
Object.defineProperty(globalThis, 'window', { configurable: true, value: page })

test('signing in or out fires the account event with the new account in place', () => {
  const seen: Array<GitHubAccount | null> = []
  page.addEventListener(GITHUB_ACCOUNT_EVENT, () => seen.push(loadAccount()))

  const account: GitHubAccount = {
    login: 'octocat',
    name: 'The Octocat',
    avatarUrl: 'https://avatars.githubusercontent.com/u/583231',
    token: 'test-token'
  }
  saveAccount(account)
  saveAccount(null)

  assert.equal(seen.length, 2)
  assert.equal(seen[0]?.avatarUrl, account.avatarUrl)
  assert.equal(seen[1], null)
})
