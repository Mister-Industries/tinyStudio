/** Tests for parts/svg — id namespacing (B6) and helpers. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { escapeXml, namespaceSvgIds, prepareSvgForEmbed, stripSvgSize, svgNs } from '../parts/svg'

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

test('prepareSvgForEmbed strips prolog/doctype and root x/y/width/height (Fritzing exports)', () => {
  const fritzing =
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n' +
    '<svg version="1.2" baseProfile="tiny" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" ' +
    'width="41.2px" height="9.32px" viewBox="0 0 42.917 9.71"><g id="g"/></svg>'
  const out = prepareSvgForEmbed(fritzing)
  assert.ok(!out.includes('<?xml'))
  assert.ok(!out.includes('DOCTYPE'))
  const root = /<svg\b[^>]*>/.exec(out)![0]
  assert.ok(!/\s[xy]\s*=/.test(root), 'root x/y removed')
  assert.ok(!/\s(width|height)\s*=/.test(root), 'root size removed')
  assert.ok(root.includes('viewBox="0 0 42.917 9.71"'), 'viewBox kept')
  // composer can now inject placement without duplicate attributes
  const placed = out.replace('<svg', '<svg x="10" y="20" width="41.2" height="9.32"')
  const attrs = /<svg\b[^>]*>/.exec(placed)![0].match(/\s(x|y|width|height)\s*=/g)!
  assert.equal(attrs.length, 4)
})

test('prepareSvgForEmbed keeps inner-element geometry attributes', () => {
  const out = prepareSvgForEmbed('<svg width="10" viewBox="0 0 10 10"><rect x="1" y="2" width="3" height="4"/></svg>')
  assert.ok(out.includes('<rect x="1" y="2" width="3" height="4"/>'))
})

test('namespaceSvgIds rewrites #id selectors inside style blocks', () => {
  const svg = '<svg><style>.a{fill:red}#body{fill:blue}#other{}</style><g id="body"/></svg>'
  const out = namespaceSvgIds(svg, 'pR1')
  assert.ok(out.includes('#pR1-body{fill:blue}'))
  assert.ok(out.includes('#other{}')) // not defined as an id here — untouched
  assert.ok(out.includes('id="pR1-body"'))
})
