/** Tests for lib/unsavedDrafts: the crash-recovery copy of an edited file. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clearDraft, readDraft, recoverableDraft, saveDraft } from '../unsavedDrafts'

const memory = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k)
  }
}

test('a saved draft reads back, and clears', () => {
  const s = memory()
  saveDraft('/p/circuit.json', '{"a":1}', s)
  assert.equal(readDraft('/p/circuit.json', s)?.content, '{"a":1}')
  clearDraft('/p/circuit.json', s)
  assert.equal(readDraft('/p/circuit.json', s), null)
})

test('a draft is offered only when it differs from the file on disk', () => {
  const s = memory()
  saveDraft('/p/circuit.json', 'edited', s)
  assert.equal(recoverableDraft('/p/circuit.json', 'edited', s), null)
  assert.equal(recoverableDraft('/p/circuit.json', 'on disk', s)?.content, 'edited')
  assert.equal(recoverableDraft('/q/circuit.json', 'on disk', s), null)
})

test('broken storage never throws', () => {
  const bad = {
    getItem: (): string => {
      throw new Error('denied')
    },
    setItem: (): void => {
      throw new Error('full')
    },
    removeItem: (): void => {
      throw new Error('denied')
    }
  }
  saveDraft('/p', 'x', bad)
  clearDraft('/p', bad)
  assert.equal(readDraft('/p', bad), null)
  const s = memory()
  s.setItem('tinystudio.draft./p', 'not json')
  assert.equal(readDraft('/p', s), null)
})
