/**
 * Tests for parts/svgArt + parts/folderPart — reading pins out of hand-edited
 * SVG files, surviving what Illustrator does to them, keeping every part's
 * gradients and classes to itself, and turning a part folder into a PartDef.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  artPrefix,
  decodeIllustratorId,
  movePinInArt,
  namespaceSvg,
  pinNameFromId,
  prepareArt,
  scanPins
} from '../parts/svgArt'
import {
  buildFolderPart,
  folderPartMeta,
  loadPack,
  parsePartJson,
  type PartJson,
  type ReadText
} from '../parts/folderPart'

const svg = (body: string, root = 'viewBox="0 0 100 100"'): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}</svg>`

const pinsOf = (s: string, w?: number, h?: number): Record<string, [number, number]> =>
  Object.fromEntries(scanPins(s, w, h).pins.map((p) => [p.name, p.at]))

// ── pin discovery ────────────────────────────────────────────────────────────

test('a pin is the centre of the shape named pin-<NAME>, scaled into the part box', () => {
  // 72 units/in art in a 1in × 0.5in box → 96/72 px per unit
  const s = svg(
    '<rect x="0" y="0" width="72" height="36" fill="#333"/>' +
      '<circle id="pin-VCC" cx="7.2" cy="7.2" r="2"/>' +
      '<rect id="pin-GND" x="60" y="30" width="4" height="4"/>',
    'width="1in" height="0.5in" viewBox="0 0 72 36"'
  )
  const pins = pinsOf(s)
  assert.deepEqual(pins.VCC, [9.6, 9.6])
  assert.deepEqual(pins.GND, [82.67, 42.67])
  // the box from part.json beats whatever the root claims
  assert.deepEqual(pinsOf(s, 144, 72).VCC, [14.4, 14.4])
})

test('ancestor and own transforms are applied', () => {
  const pins = pinsOf(
    svg(
      '<g transform="translate(10 0)"><g transform="scale(2)">' +
        '<rect id="pin-A" x="1" y="1" width="2" height="2"/></g></g>' +
        '<circle id="pin-R" cx="10" cy="0" r="1" transform="rotate(90)"/>' +
        '<g transform="matrix(1 0 0 1 50 50)"><line id="pin-L" x1="0" y1="0" x2="10" y2="0"/></g>'
    )
  )
  assert.deepEqual(pins.A, [14, 4])
  assert.deepEqual(pins.R, [0, 10])
  assert.deepEqual(pins.L, [55, 50])
})

test('paths (relative commands, arcs) and named groups resolve to their centre', () => {
  const pins = pinsOf(
    svg(
      '<path id="pin-P" d="M5 10a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z"/>' +
        '<path id="pin-Q" d="m20 20h10v10h-10z"/>' +
        '<g id="pin-G"><rect x="40" y="0" width="4" height="4"/><rect x="46" y="0" width="4" height="4"/></g>'
    )
  )
  assert.deepEqual(pins.P, [10, 10])
  assert.deepEqual(pins.Q, [25, 25])
  assert.deepEqual(pins.G, [45, 2])
})

test('art is fitted into a box of a different aspect the way the canvas draws it', () => {
  // 10×10 art in a 20×10 box: uniform scale 1, centred with a 5px margin
  assert.deepEqual(
    pinsOf(svg('<circle id="pin-C" cx="5" cy="5" r="1"/>', 'viewBox="0 0 10 10"'), 20, 10).C,
    [10, 5]
  )
})

test('ids Illustrator mangled still name the right pin; duplicates are reported', () => {
  assert.equal(decodeIllustratorId('pin-3V3_x2E_2'), 'pin-3V3.2')
  assert.equal(pinNameFromId('pin-3V3_x2E_2'), '3V3.2')
  assert.equal(pinNameFromId('pin-GND_1_'), 'GND')
  assert.equal(pinNameFromId('pin_x3A_TX'), 'TX')
  assert.equal(pinNameFromId('pin-GND_00000094586231542387468840000009823571904523165_'), 'GND')
  assert.equal(pinNameFromId('connector0pin'), null)
  assert.equal(pinNameFromId('pin_header_outline'), null)

  const scan = scanPins(
    svg(
      '<circle id="pin-GND" cx="1" cy="1" r="1"/><circle id="pin-GND_1_" cx="9" cy="9" r="1"/><g id="pin-X"/>'
    )
  )
  assert.deepEqual(scan.duplicates, ['GND'])
  assert.deepEqual(scan.empty, ['X'])
  assert.deepEqual(scan.pins.find((p) => p.name === 'GND')!.at, [1, 1])
})

test('shapes inside <defs>, <clipPath> etc. are never pins', () => {
  const pins = pinsOf(
    svg(
      '<defs><circle id="pin-D" cx="1" cy="1" r="1"/></defs><clipPath id="c"><rect id="pin-K" width="1" height="1"/></clipPath>'
    )
  )
  assert.deepEqual(Object.keys(pins), [])
})

test('a legacy Illustrator file (prolog, DOCTYPE subset, comments, CDATA) parses', () => {
  const file = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 28.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [
  <!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">
]>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" viewBox="0 0 136.8 136.8" style="enable-background:new 0 0 136.8 136.8;" xml:space="preserve">
<style type="text/css"><![CDATA[
  .st0{fill:url(#SVGID_1_);}
]]></style>
<g id="breadboard">
  <circle id="pin-SCK" class="st0" cx="39.6" cy="127.8" r="2.6"/>
</g>
</svg>`
  // tinyBoards: 1.9in box, 136.8-unit viewBox
  assert.deepEqual(pinsOf(file, 182.4, 182.4).SCK, [52.8, 170.4])
})

// ── moving pins in the art ───────────────────────────────────────────────────

test('movePinInArt shifts a circle pad by cx/cy and the pin follows, in box px', () => {
  // 100-unit viewBox in a 200 px box: 1 px = 0.5 units
  const s = svg(
    '<circle id="pin-GND" cx="10" cy="20" r="2"/><rect id="pin-A0" x="40" y="40" width="4" height="4"/>'
  )
  const moved = movePinInArt(s, 'GND', 9.6, -4.8, 200, 200)
  assert.ok(moved)
  assert.deepEqual(moved!.at, [29.6, 35.2])
  assert.match(moved!.svg, /<circle id="pin-GND" cx="14.8" cy="17.6" r="2"\/>/)
  assert.deepEqual(pinsOf(moved!.svg, 200, 200)['A0'], [84, 84], 'other pins untouched')
})

test('movePinInArt moves rects by x/y and paths by a leading translate', () => {
  const s = svg(
    '<rect id="pin-A" x="10" y="10" width="4" height="4"/>' +
      '<path id="pin-B" d="M50 50 h4 v4 h-4 z" transform="scale(2)"/>'
  )
  const a = movePinInArt(s, 'A', 1, 2, 100, 100)!
  assert.match(a.svg, /<rect id="pin-A" x="11" y="12"/)
  assert.deepEqual(a.at, [13, 14])
  const b = movePinInArt(s, 'B', 3, 0, 100, 100)!
  assert.match(b.svg, /transform="translate\(3 0\) scale\(2\)"/)
  assert.deepEqual(b.at, [107, 104])
})

test('movePinInArt maps the delta through ancestor transforms', () => {
  const s = svg(
    '<g transform="translate(10 10) scale(2)"><circle id="pin-X" cx="5" cy="5" r="1"/></g>'
  )
  assert.deepEqual(pinsOf(s)['X'], [20, 20])
  const m = movePinInArt(s, 'X', 4, 6, 100, 100)!
  // 4 root units under scale(2) is 2 local units
  assert.match(m.svg, /cx="7" cy="8"/)
  assert.deepEqual(m.at, [24, 26])
})

test('movePinInArt returns null for an unknown pin and leaves the file alone', () => {
  const s = svg('<circle id="pin-GND" cx="10" cy="20" r="2"/>')
  assert.equal(movePinInArt(s, 'NOPE', 1, 1, 100, 100), null)
})

// ── preparing + namespacing ──────────────────────────────────────────────────

test('prepareArt drops the prolog and root size but keeps <style> CDATA', () => {
  const out = prepareArt(
    '<?xml version="1.0"?><!-- hi --><!DOCTYPE svg [<!ENTITY a "b">]><svg width="2in" height="1in"><style><![CDATA[.a{fill:red}]]></style></svg>'
  )
  assert.ok(out.startsWith('<svg'), out)
  assert.ok(!/width=|height=/.test(out.slice(0, out.indexOf('>'))), out)
  assert.match(out, /viewBox="0 0 192 96"/)
  assert.match(out, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(out, /<!\[CDATA\[\.a\{fill:red\}\]\]>/)
})

test('namespacing keeps two parts from painting each other, and only touches what it must', () => {
  const art = svg(
    '<style>.st0{fill:url(#SVGID_1_)} .st1 , g.st0:hover{stroke:#000}</style>' +
      '<defs><linearGradient id="SVGID_1_"/><path id="shape"/></defs>' +
      '<use xlink:href="#shape"/><rect class="st0 other" style="fill:url(\'#SVGID_1_\')"/>' +
      '<circle id="pin-GND"/><line id="connector0leg"/><rect id="band_1"/>'
  )
  const a = namespaceSvg(art, artPrefix('tinycore'))
  const b = namespaceSvg(art, artPrefix('tinyglow'))
  assert.notEqual(a, b)
  assert.match(a, /id="p-tinycore-SVGID_1_"/)
  assert.match(a, /\.p-tinycore-st0\{fill:url\(#p-tinycore-SVGID_1_\)\}/)
  assert.match(a, /\.p-tinycore-st1 , g\.p-tinycore-st0:hover/)
  assert.match(a, /xlink:href="#p-tinycore-shape"/)
  assert.match(a, /class="p-tinycore-st0 other"/)
  assert.match(a, /fill:url\('#p-tinycore-SVGID_1_'\)/)
  // looked up by name elsewhere — must survive untouched
  assert.match(a, /id="pin-GND"/)
  assert.match(a, /id="connector0leg"/)
  assert.match(a, /id="band_1"/)
  // idempotent
  assert.equal(namespaceSvg(a, artPrefix('tinycore')), a)
})

// ── folder parts ─────────────────────────────────────────────────────────────

function memFiles(files: Record<string, string>): ReadText {
  return async (p) => {
    if (!(p in files)) throw new Error(`ENOENT ${p}`)
    return files[p]
  }
}

const BOARD_ART = svg(
  '<defs><linearGradient id="g"/></defs><rect width="72" height="72" fill="url(#g)"/>' +
    '<circle id="pin-A" cx="7.2" cy="7.2" r="2"/><circle id="pin-B" cx="14.4" cy="7.2" r="2"/>' +
    '<circle id="pin-EXTRA" cx="21.6" cy="7.2" r="2"/>',
  'width="1in" height="1in" viewBox="0 0 72 72"'
)

test('buildFolderPart reads pins from the art in part.json order and reports mismatches', async () => {
  const json: PartJson = {
    type: 'demo',
    label: 'Demo',
    family: 'Custom',
    icon: 'breadboard.svg',
    buses: [['A', 'B']],
    views: {
      breadboard: {
        svg: 'breadboard.svg',
        width: '1in',
        height: '1in',
        pins: ['B', 'A', 'MISSING']
      }
    }
  }
  const def = await buildFolderPart(
    json,
    memFiles({ 'packs/x/parts/demo/breadboard.svg': BOARD_ART }),
    {
      layer: 'dev',
      pack: 'x',
      dir: 'packs/x/parts/demo'
    }
  )
  const v = def.views.breadboard!
  assert.equal(v.w, 96)
  assert.deepEqual(Object.keys(v.pins), ['B', 'A', 'EXTRA'])
  assert.deepEqual(v.pins.A, [9.6, 9.6])
  assert.match(v.svg, /url\(#p-demo-breadboard-g\)/)
  assert.equal(def.icon, v.svg)
  assert.deepEqual(def.buses, [['A', 'B']])
  assert.equal(def.source?.raw?.breadboard, BOARD_ART)
  assert.equal(def.source?.pinsFromSvg?.breadboard, true)
  const w = def.source?.warnings?.join('\n') ?? ''
  assert.match(w, /"MISSING" is listed in part\.json/)
  assert.match(w, /not listed in part\.json: EXTRA/)
})

test('fixed pin positions in part.json win over the art', async () => {
  const json: PartJson = {
    type: 'fixed',
    label: 'Fixed',
    views: {
      breadboard: { svg: 'bb.svg', width: 50, height: 20, pins: { '1': [1.234, 2], '2': [40, 2] } }
    }
  }
  const def = await buildFolderPart(json, memFiles({ 'd/bb.svg': BOARD_ART }), {
    layer: 'bundled',
    dir: 'd'
  })
  assert.deepEqual(def.views.breadboard!.pins, { '1': [1.23, 2], '2': [40, 2] })
  assert.equal(def.source?.pinsFromSvg?.breadboard, false)
})

test('an icon and a view that are separate files keep separate class namespaces', async () => {
  // both Illustrator exports define .st0 — on one page, the icon's must not repaint the board
  const json: PartJson = {
    type: 'board',
    label: 'Board',
    icon: 'icon.svg',
    views: { breadboard: { svg: 'breadboard.svg', width: 10, height: 10, pins: { A: [0, 0] } } }
  }
  const icon = svg('<style>.st0{opacity:.1}</style><rect class="st0"/>')
  const def = await buildFolderPart(
    json,
    memFiles({
      'd/icon.svg': icon,
      'd/breadboard.svg': svg('<style>.st0{fill:#182424}</style><rect class="st0"/>')
    }),
    { layer: 'bundled', dir: 'd' }
  )
  assert.match(def.views.breadboard!.svg, /\.p-board-breadboard-st0\{fill:#182424\}/)
  assert.match(def.icon!, /\.p-board-icon-st0\{opacity:\.1\}/)
  assert.equal(folderPartMeta(json, icon).icon, def.icon, 'palette tile matches the loaded icon')
})

test('part.json must point at files, not carry inline markup', () => {
  assert.throws(
    () =>
      parsePartJson(
        JSON.stringify({ type: 't', label: 'T', views: { breadboard: { svg: '<svg/>' } } }),
        'x'
      ),
    /inline markup/
  )
  assert.throws(() => parsePartJson('{', 'broken.json'), /broken\.json: not valid JSON/)
})

test('loadPack serves folder parts lazily and single-file parts preloaded, in pack order', async () => {
  const legacy = {
    type: 'old',
    label: 'Old',
    family: 'Custom',
    views: { breadboard: { svg: '<svg/>', w: 10, h: 10, pins: { '1': [0, 0] } } }
  }
  const files = memFiles({
    'packs/p/pack.json': JSON.stringify({
      schema: 1,
      id: 'p',
      name: 'P',
      version: '1',
      parts: [
        { type: 'old', file: 'parts/old.json' },
        { type: 'demo', dir: 'parts/demo' },
        { type: 'broken', dir: 'parts/broken' }
      ]
    }),
    'packs/p/parts/old.json': JSON.stringify(legacy),
    'packs/p/parts/demo/part.json': JSON.stringify({
      type: 'demo',
      label: 'Demo',
      views: { breadboard: { svg: 'breadboard.svg' } }
    }),
    'packs/p/parts/demo/breadboard.svg': BOARD_ART
  })
  const { providers, errors } = await loadPack('packs/p', files, 'remote')
  assert.deepEqual(
    providers.map((p) => p.meta.type),
    ['old', 'demo']
  )
  assert.equal(errors.length, 1)
  assert.match(errors[0], /parts\/broken\/part\.json/)
  assert.ok(providers[0].def, 'single-file part is preloaded')
  assert.equal(providers[1].def, undefined, 'folder part loads on demand')
  assert.ok(
    providers[1].meta.icon?.includes('p-demo-breadboard-g'),
    'palette icon falls back to the namespaced breadboard art'
  )
  const demo = await providers[1].load()
  assert.equal(Object.keys(demo.views.breadboard!.pins).length, 3)
})
