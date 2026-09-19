/** Tests for parts/packs: index/manifest fetch+validate, install into the
 * parts cache (served as the registry's remote layer), settings. Network
 * (fetch) and localStorage are stubbed; the cache falls back to memory under
 * node, and the registry is the real one. */

import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { PART_MANIFEST, getPart, loadPart } from '../../lib/partsLibrary'
import {
  DEFAULT_INDEX_URL,
  fetchIndex,
  fetchManifest,
  getIndexUrls,
  getInstalledPacks,
  githubOrigin,
  installPack,
  setIndexUrls,
  uninstallPack,
  type PackManifest
} from '../parts/packs'
import { getCachedPack } from '../parts/partsCache'

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

type Route = unknown | { status: number }

function stubFetch(routes: Record<string, Route>): void {
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
    url: string
  ): Promise<Response> => {
    const hit = routes[url]
    const fail = (status: number): Response =>
      ({ ok: false, status, json: async () => ({}), text: async () => '' }) as unknown as Response
    if (hit === undefined) return fail(404)
    if (typeof hit === 'object' && hit !== null && 'status' in hit)
      return fail((hit as { status: number }).status)
    const text = typeof hit === 'string' ? hit : JSON.stringify(hit)
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(text),
      text: async () => text,
      arrayBuffer: async () => new TextEncoder().encode(text).buffer
    } as unknown as Response
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
  await assert.rejects(
    () => fetchManifest('https://example.com/bad.json'),
    /not a valid pack manifest/
  )
})

test('githubOrigin recognises a tinyparts-shaped raw URL and nothing else', () => {
  assert.deepEqual(
    githubOrigin('https://raw.githubusercontent.com/me/tinyparts/dev/packs/leds/pack.json', 'leds'),
    { kind: 'github', repo: 'me/tinyparts', ref: 'dev', commit: '' }
  )
  assert.equal(
    githubOrigin('https://raw.githubusercontent.com/me/r/main/other/pack.json', 'leds'),
    null
  )
  assert.equal(githubOrigin('https://example.com/packs/leds/pack.json', 'leds'), null)
})

// ── installPack ──────────────────────────────────────────────────────────────

const RESISTOR_DEF = {
  type: 'pack-test-resistor',
  label: 'Resistor',
  family: 'Passive',
  views: { breadboard: { svg: '<svg/>', w: 10, h: 10, pins: { '1': [0, 5], '2': [10, 5] } } }
}

const FOLDER_ART =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><circle id="pin-A" cx="5" cy="5" r="1"/><circle id="pin-B" cx="15" cy="5" r="1"/></svg>'

test('installPack caches every valid part (single-file and folder), continues past bad ones', async () => {
  const manifest: PackManifest = {
    schema: 1,
    id: 'pack-test',
    name: 'Pack Test',
    version: '2.0.0',
    parts: [
      { type: 'pack-test-resistor', file: 'parts/resistor.json' },
      { type: 'pack-test-folder', dir: 'parts/pack-test-folder' },
      { type: 'pack-test-missing', file: 'parts/missing.json' }, // 404
      { type: 'pack-test-malformed', file: 'parts/malformed.json' } // not a PartDef
    ]
  }
  stubFetch({
    'https://example.com/parts/resistor.json': RESISTOR_DEF,
    'https://example.com/parts/pack-test-folder/part.json': {
      type: 'pack-test-folder',
      label: 'Folder Part',
      family: 'Passive',
      views: { breadboard: { svg: 'breadboard.svg', width: 20, height: 10 } }
    },
    'https://example.com/parts/pack-test-folder/breadboard.svg': FOLDER_ART,
    'https://example.com/parts/malformed.json': { not: 'a part' }
  })
  const progress: [number, number][] = []
  const res = await installPack(manifest, 'https://example.com/pack.json', (done, total) =>
    progress.push([done, total])
  )
  assert.deepEqual(res.installed, ['pack-test-resistor', 'pack-test-folder'])
  assert.equal(res.failed.length, 2)
  assert.ok(res.failed.some((f) => f.type === 'pack-test-missing' && /HTTP 404/.test(f.error)))
  assert.ok(res.failed.some((f) => f.type === 'pack-test-malformed'))
  assert.deepEqual(progress[3], [4, 4])

  // live in the registry, from the remote layer
  assert.ok(getPart('pack-test-resistor'), 'single-file parts are ready immediately')
  const folder = await loadPart('pack-test-folder')
  assert.deepEqual(folder?.views.breadboard?.pins, { A: [5, 5], B: [15, 5] })
  assert.equal(PART_MANIFEST.find((m) => m.type === 'pack-test-folder')?.layer, 'remote')

  // stored with blob shas, and the stored manifest lists only what landed
  const rec = await getCachedPack('pack-test')
  assert.ok(rec)
  assert.match(rec!.files['parts/pack-test-folder/breadboard.svg'], /^[0-9a-f]{40}$/)
  assert.deepEqual(rec!.origin, { kind: 'url', url: 'https://example.com/pack.json' })
  assert.equal(getInstalledPacks()['pack-test'], '2.0.0')

  await uninstallPack('pack-test')
  assert.equal(getPart('pack-test-resistor'), undefined)
  assert.equal(await getCachedPack('pack-test'), undefined)
  assert.equal(getInstalledPacks()['pack-test'], undefined)
})

test('installPack does not store or mark a pack when every part fails', async () => {
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
  assert.equal(await getCachedPack('all-bad'), undefined)
})

// ── settings (index URL list) ───────────────────────────────────────────────

test('getIndexUrls defaults to the tinyparts index; setIndexUrls persists a custom list', () => {
  assert.deepEqual(getIndexUrls(), [DEFAULT_INDEX_URL])
  setIndexUrls(['https://example.com/a.json', 'https://example.com/b.json'])
  assert.deepEqual(getIndexUrls(), ['https://example.com/a.json', 'https://example.com/b.json'])
})
