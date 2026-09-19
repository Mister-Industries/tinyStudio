/**
 * readSavedTheme reads the theme choice and moves one saved by a pre-0.4 build
 * (under the electron-vite template's key) to the current key.
 */
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { LEGACY_THEME_KEY, STORAGE_KEYS } from '../storageKeys'
// readSavedTheme touches localStorage only when called, after the stub below exists.
import { readSavedTheme } from '../ThemeProvider'

const backing = new Map<string, string>()
let throwOnRead = false
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string): string | null => {
      if (throwOnRead) throw new Error('SecurityError')
      return backing.get(k) ?? null
    },
    setItem: (k: string, v: string): void => {
      backing.set(k, String(v))
    },
    removeItem: (k: string): void => {
      backing.delete(k)
    }
  }
})

const KEY = STORAGE_KEYS.theme

beforeEach(() => {
  backing.clear()
  throwOnRead = false
})

test('nothing saved yields null', () => {
  assert.equal(readSavedTheme(KEY), null)
})

test('a theme saved by an earlier version moves to the current key', () => {
  backing.set(LEGACY_THEME_KEY, 'dark')
  assert.equal(readSavedTheme(KEY), 'dark')
  assert.equal(backing.get(KEY), 'dark')
  assert.equal(backing.has(LEGACY_THEME_KEY), false)
})

test('the current key wins over the legacy one', () => {
  backing.set(KEY, 'light')
  backing.set(LEGACY_THEME_KEY, 'dark')
  assert.equal(readSavedTheme(KEY), 'light')
  assert.equal(backing.has(LEGACY_THEME_KEY), false, 'the stale legacy value is cleared')
})

test('an unknown value is ignored and left alone', () => {
  backing.set(LEGACY_THEME_KEY, 'blue')
  assert.equal(readSavedTheme(KEY), null)
  assert.equal(backing.has(KEY), false)
})

test('storage that throws (private mode) reads as nothing saved', () => {
  throwOnRead = true
  assert.equal(readSavedTheme(KEY), null)
})
