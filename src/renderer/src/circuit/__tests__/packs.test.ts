/** Tests for parts/packs — index/manifest fetch+validate, install, settings.
 * Network (fetch) and localStorage are stubbed; registerPart/getPart are the
 * real in-memory registry (no DOM needed), so installPack is exercised
 * end-to-end against it. */

import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { getPart } from '../../lib/partsLibrary'
import {
  DEFAULT_INDEX_URL,
  fetchIndex,
  fetchManifest,
  getIndexUrls,
  getInstalledPacks,
  installPack,
  setIndexUrls,
  type PackManifest
} from '../parts/packs'

// ── in-memory localStorage stub (Node has no browser globals) ──────────────

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v)
  }
  removeItem(k: string): void {
    this.map.delete(k)
  }
  clear(): void {
    this.map.clear()
  }
}
;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage()

beforeEach(() => {
  ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage.clear()
})

// ── fetch stub ───────────────────────────────────────────────────────────────

function stubFetch(routes: Record<string, unknown | (() => unknown) | { status: number }>): void {
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
    url: string
  ): Promise<Response> => {
    const hit = routes[url]
    if (hit === undefined) return { ok: false, status: 404, json: async () => ({}) } as Response
    if (typeof hit === 'object' && hit !== null && 'status' in hit && !('json' in hit)) {
      return { ok: false, status: (hit as { status: number }).status, json: async () => ({}) } as Response
    }
    const body = typeof hit === 'function' ? (hit as () => unknown)() : hit
    return { ok: true, status: 200, json: async () => body } as Response
  }) as typeof fetch
}

// ── fetchIndex / fetchManifest ───────────────────────────────────────────────

test('fetchIndex resolves each pack.url relative to the index url', async () => {
  stubFetch({
    'https://example.com/sub/index.json': {
      schema: 1,
      packs: [{ id: 'core', name: 'Core', version: '1.0.0', url: 'pack.json' }]
    }
  })
  const idx = await fetchIndex('https://example.com/sub/index.json')
  assert.equal(idx.packs.length, 1)
  assert.equal(idx.packs[0].url, 'https://example.com/sub/pack.json')
})

test('fetchIndex rejects a response that is not { packs: [...] }', async () => {
  stubFetch({ 'https://example.com/bad.json': { oops: true } })
  await assert.rejects(() => fetchIndex('https://example.com/bad.json'), /not a valid pack index/)
})

test('fetchIndex surfaces a readable error on HTTP failure (unpublished repo)', async () => {
  stubFetch({ [DEFAULT_INDEX_URL]: { status: 404 } })
  await assert.rejects(() => fetchIndex(DEFAULT_INDEX_URL), /HTTP 404/)
})

test('fetchManifest validates { id, parts: [...] } shape', async () => {
  stubFetch({
    'https://example.com/pack.json': {
      schema: 1,
      id: 'core',
      name: 'Core',
      version: '1.0.0',
      parts: [{ type: 'resistor', file: 'parts/resistor.json' }]
    },
    'https://example.com/bad.json': { name: 'no id or parts' }
  })
  const man = await fetchManifest('https://example.com/pack.json')
  assert.equal(man.id, 'core')
  await assert.rejects(() => fetchManifest('https://example.com/bad.json'), /not a valid pack manifest/)
})

// ── installPack ──────────────────────────────────────────────────────────────

const RESISTOR_DEF = {
  type: 'pack-test-resistor',
  label: 'Resistor',
  family: 'Passive',
  views: { breadboard: { svg: '<svg/>', w: 10, h: 10, pins: { '1': [0, 5], '2': [10, 5] } } }
}

test('installPack registers every valid part via saveUserPart, continues past one bad part', async () => {
  const manifest: PackManifest = {
    schema: 1,
    id: 'core',
    name: 'Core',
    version: '2.0.0',
    parts: [
      { type: 'pack-test-resistor', file: 'parts/resistor.json' },
      { type: 'pack-test-missing', file: 'parts/missing.json' }, // 404
      { type: 'pack-test-malformed', file: 'parts/malformed.json' } // not a PartDef
    ]
  }
  stubFetch({
    'https://example.com/parts/resistor.json': RESISTOR_DEF,
    'https://example.com/parts/malformed.json': { not: 'a part' }
    // parts/missing.json intentionally absent -> 404
  })
  const progress: [number, number][] = []
  const res = await installPack(manifest, 'https://example.com/pack.json', (done, total) =>
    progress.push([done, total])
  )
  assert.deepEqual(res.installed, ['pack-test-resistor'])
  assert.equal(res.failed.length, 2)
  assert.ok(res.failed.some((f) => f.type === 'pack-test-missing' && /HTTP 404/.test(f.error)))
  assert.ok(res.failed.some((f) => f.type === 'pack-test-malformed'))
  assert.equal(progress.length, 3)
  assert.deepEqual(progress[2], [3, 3])

  // the successfully-installed part is live in the registry
  assert.ok(getPart('pack-test-resistor'))

  // a pack with at least one success is marked installed at its version
  assert.equal(getInstalledPacks().core, '2.0.0')
})

test('installPack does not mark a pack installed when every part fails', async () => {
  const manifest: PackManifest = {
    schema: 1,
    id: 'all-bad',
    name: 'All Bad',
    version: '9.9.9',
    parts: [{ type: 'x', file: 'x.json' }]
  }
  stubFetch({}) // everything 404s
  const res = await installPack(manifest, 'https://example.com/pack.json')
  assert.equal(res.installed.length, 0)
  assert.equal(getInstalledPacks()['all-bad'], undefined)
})

// ── settings (index URL list) ───────────────────────────────────────────────

test('getIndexUrls defaults to the tinyparts index; setIndexUrls persists a custom list', () => {
  assert.deepEqual(getIndexUrls(), [DEFAULT_INDEX_URL])
  setIndexUrls(['https://example.com/a.json', 'https://example.com/b.json'])
  assert.deepEqual(getIndexUrls(), ['https://example.com/a.json', 'https://example.com/b.json'])
})
