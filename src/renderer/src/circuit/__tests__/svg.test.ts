/** Tests for parts/svg — id namespacing (B6) and helpers. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { escapeXml, namespaceSvgIds, stripSvgSize, svgNs } from '../parts/svg'

test('namespaceSvgIds prefixes defined ids and their references', () => {
  const svg =
    '<svg><defs><linearGradient id="g"><stop/></linearGradient></defs>' +
    '<rect fill="url(#g)"/><use href="#g"/><use xlink:href="#g"/></svg>'
  const out = namespaceSvgIds(svg, 'pR1')
  assert.ok(out.includes('id="pR1-g"'))
  assert.ok(out.includes('url(#pR1-g)'))
  assert.ok(out.includes('href="#pR1-g"'))
  assert.ok(out.includes('xlink:href="#pR1-g"'))
  assert.ok(!out.includes('id="g"'))
})

test('namespaceSvgIds leaves external references and unknown ids alone', () => {
  const svg = '<svg><rect fill="url(#other)"/><use href="https://x/#frag"/><g id="mine"/></svg>'
  const out = namespaceSvgIds(svg, 'ns')
  assert.ok(out.includes('url(#other)')) // not defined here — untouched
  assert.ok(out.includes('href="https://x/#frag"'))
  assert.ok(out.includes('id="ns-mine"'))
})

test('two parts sharing an id stop colliding after namespacing (B6)', () => {
  const a = namespaceSvgIds('<svg><g id="body" fill="url(#body)"/></svg>', svgNs('R1'))
  const b = namespaceSvgIds('<svg><g id="body" fill="url(#body)"/></svg>', svgNs('LED1'))
  assert.ok(a.includes('pR1-body'))
  assert.ok(b.includes('pLED1-body'))
  assert.ok(!a.includes('id="body"') && !b.includes('id="body"'))
})

test('svgNs sanitizes weird part ids', () => {
  assert.equal(svgNs('R1'), 'pR1')
  assert.equal(svgNs('led 2/a'), 'pled_2_a')
})

test('stripSvgSize removes root width/height only', () => {
  const out = stripSvgSize('<svg width="10" height="20" viewBox="0 0 10 20"><rect width="5"/></svg>')
  assert.ok(!/^<svg[^>]*width="10"/.test(out))
  assert.ok(out.includes('<rect width="5"/>'))
  assert.ok(out.includes('viewBox="0 0 10 20"'))
})

test('escapeXml escapes the five specials', () => {
  assert.equal(escapeXml(`<a href="x">R&D's</a>`), '&lt;a href=&quot;x&quot;&gt;R&amp;D&apos;s&lt;/a&gt;')
})
