/**
 * Tests for parts/tinypartsSync: the launch-time update check against the
 * tinyparts repo. GitHub is stubbed with a tree built from the real bundled
 * snapshot, so "nothing changed" really is byte-for-byte what ships.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PART_MANIFEST, ensureParts, getPart } from '../../lib/partsLibrary'
import { SNAPSHOT, readBundled } from '../parts/bundled'
import { getCachedPack } from '../parts/partsCache'
import { syncPack } from '../parts/tinypartsSync'

const REPO = 'Mister-Industries/tinyparts'
const COMMIT = 'c0ffee'.padEnd(40, '0')

function bundledTree(id: string): Map<string, string> {
  const pack = SNAPSHOT.packs.find((p) => p.id === id)!
  return new Map(Object.entries(pack.files).map(([rel, sha]) => [`packs/${id}/${rel}`, sha]))
}

const downloads: string[] = []
function stubRaw(files: Record<string, string>): void {
  downloads.length = 0
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string) => {
    downloads.push(url)
    const path = url.replace(`https://raw.githubusercontent.com/${REPO}/${COMMIT}/`, '')
    const text = files[decodeURIComponent(path)]
    if (text === undefined) return { ok: false, status: 404 } as Response
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(text).buffer
    } as unknown as Response
  }) as typeof fetch
}

test('GitHub matching the bundled snapshot downloads nothing and caches nothing', async () => {
  stubRaw({})
  const r = await syncPack('tinyboards', REPO, 'main', COMMIT, bundledTree('tinyboards'))
  assert.deepEqual(r, { changed: false, downloaded: 0, errors: [] })
  assert.equal(downloads.length, 0)
  assert.equal(await getCachedPack('tinyboards'), undefined)
})

test('a pushed art edit downloads just that file, and the app serves it', async () => {
  await ensureParts(['tinycore'])
  const before = getPart('tinycore')!.views.breadboard!.pins['GND']
  const path = 'packs/tinyboards/parts/tinycore/breadboard.svg'
  const art = (await readBundled(path)).replace(
    /(<circle id="pin-GND"[^>]*?cx=")([\d.]+)/,
    (_m, head: string, x: string) => `${head}${(parseFloat(x) + 5.4).toFixed(2)}`
  )
  const tree = bundledTree('tinyboards')
  tree.set(path, 'e'.repeat(40))
  stubRaw({ [path]: art })

  const r = await syncPack('tinyboards', REPO, 'main', COMMIT, tree)
  assert.equal(r.changed, true)
  assert.equal(r.downloaded, 1, 'only the changed file is fetched')
  assert.deepEqual(r.errors, [])
  const rec = await getCachedPack('tinyboards')
  assert.deepEqual(rec?.origin, { kind: 'github', repo: REPO, ref: 'main', commit: COMMIT })

  await ensureParts(['tinycore'])
  assert.equal(PART_MANIFEST.find((m) => m.type === 'tinycore')?.layer, 'remote')
  assert.deepEqual(getPart('tinycore')!.views.breadboard!.pins['GND'], [before[0] + 7.2, before[1]])
  // untouched boards still resolve (served from the cache copy of bundled files)
  await ensureParts(['tinyglow'])
  assert.ok(getPart('tinyglow'))

  // the same tree again: nothing to do
  stubRaw({})
  const again = await syncPack('tinyboards', REPO, 'main', COMMIT, tree)
  assert.deepEqual(again, { changed: false, downloaded: 0, errors: [] })

  // the edit is reverted on GitHub: the cached copy goes, bundled serves again
  const back = await syncPack('tinyboards', REPO, 'main', COMMIT, bundledTree('tinyboards'))
  assert.equal(back.changed, true)
  assert.equal(await getCachedPack('tinyboards'), undefined)
  assert.equal(PART_MANIFEST.find((m) => m.type === 'tinycore')?.layer, 'bundled')
  await ensureParts(['tinycore'])
  assert.deepEqual(getPart('tinycore')!.views.breadboard!.pins['GND'], before)
})

test('a pack that is not on GitHub (yet) is left alone', async () => {
  stubRaw({})
  const r = await syncPack('tinyboards', REPO, 'main', COMMIT, new Map())
  assert.deepEqual(r, { changed: false, downloaded: 0, errors: [] })
})
