/** Tests for the .fzpz import plumbing: the zip reader (built against real
 * deflate streams from node:zlib) and the pure SVG unit/transform math.
 * The DOM-dependent .fzp conversion itself is renderer-only (DOMParser). */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { unzip } from '../parts/zip'
import { applyMat, matMul, minifySvg, parseTransform, toPx } from '../parts/svgUnits'

// ── zip builder (stored + deflated entries, real central directory) ──────────

function crc32(buf: Uint8Array): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function buildZip(files: { name: string; data: Uint8Array; store?: boolean }[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const enc = new TextEncoder()

  const u16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff]
  const u32 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]

  for (const f of files) {
    const name = enc.encode(f.name)
    const method = f.store ? 0 : 8
    const comp = f.store ? f.data : new Uint8Array(deflateRawSync(f.data))
    const crc = crc32(f.data)
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(comp.length), ...u32(f.data.length), ...u16(name.length), ...u16(0)
    ])
    chunks.push(local, name, comp)
    central.push(
      new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0),
        ...u32(crc), ...u32(comp.length), ...u32(f.data.length), ...u16(name.length), ...u16(0),
        ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)
      ]),
      name
    )
    offset += local.length + name.length + comp.length
  }
  const cenStart = offset
  let cenLen = 0
  for (const c of central) cenLen += c.length
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(cenLen), ...u32(cenStart), ...u16(0)
  ])
  const total = offset + cenLen + eocd.length
  const out = new Uint8Array(total)
  let p = 0
  for (const c of [...chunks, ...central, eocd]) {
    out.set(c, p)
    p += c.length
  }
  return out
}

// ── zip reader ───────────────────────────────────────────────────────────────

test('unzip round-trips stored and deflated entries', async () => {
  const enc = new TextEncoder()
  const fzp = enc.encode('<module moduleId="x"><title>LED</title></module>')
  const svg = enc.encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>')
  const zip = buildZip([
    { name: 'part.led.fzp', data: fzp },
    { name: 'svg.breadboard.led.svg', data: svg, store: true }
  ])
  const entries = await unzip(zip)
  assert.equal(entries.length, 2)
  const dec = new TextDecoder()
  assert.equal(dec.decode(entries.find((e) => e.name === 'part.led.fzp')!.data), dec.decode(fzp))
  assert.equal(
    dec.decode(entries.find((e) => e.name === 'svg.breadboard.led.svg')!.data),
    dec.decode(svg)
  )
})

test('unzip skips directory entries and rejects non-zip data', async () => {
  const zip = buildZip([{ name: 'a/', data: new Uint8Array(0), store: true }])
  assert.equal((await unzip(zip)).length, 0)
  await assert.rejects(() => unzip(new TextEncoder().encode('not a zip at all — plain text')))
})

test('unzip survives a trailing comment after the EOCD', async () => {
  const base = buildZip([{ name: 'x.txt', data: new TextEncoder().encode('hi'), store: true }])
  // append junk as if a comment followed (scan must still find the EOCD)
  const padded = new Uint8Array(base.length + 9)
  padded.set(base, 0)
  // fix the comment length field so the record stays valid
  padded[base.length - 2] = 9
  const entries = await unzip(padded)
  assert.equal(entries.length, 1)
})

// ── svg units + transforms ───────────────────────────────────────────────────

test('toPx converts SVG units at 96 DPI', () => {
  assert.equal(toPx('96px'), 96)
  assert.equal(toPx('1in'), 96)
  assert.ok(Math.abs(toPx('25.4mm')! - 96) < 1e-9)
  assert.ok(Math.abs(toPx('72pt')! - 96) < 1e-9)
  assert.equal(toPx('42'), 42)
  assert.equal(toPx('bogus'), null)
  assert.equal(toPx(null), null)
})

test('parseTransform composes left-to-right like the SVG spec', () => {
  // translate then scale: p' = T(10,20) · S(2) · p
  const m = parseTransform('translate(10 20) scale(2)')
  const p = applyMat(m, 3, 4)
  assert.deepEqual(p, { x: 16, y: 28 })
})

test('rotate about a point maps the pivot to itself', () => {
  const m = parseTransform('rotate(90 5 5)')
  const pivot = applyMat(m, 5, 5)
  assert.ok(Math.abs(pivot.x - 5) < 1e-9 && Math.abs(pivot.y - 5) < 1e-9)
  const p = applyMat(m, 6, 5) // one unit right of pivot → one unit below (SVG y-down CW)
  assert.ok(Math.abs(p.x - 5) < 1e-9 && Math.abs(p.y - 6) < 1e-9)
})

test('matMul is associative with applyMat', () => {
  const a = parseTransform('translate(1 2)')
  const b = parseTransform('scale(3)')
  const p1 = applyMat(matMul(a, b), 4, 5)
  const p2 = applyMat(a, applyMat(b, 4, 5).x, applyMat(b, 4, 5).y)
  assert.deepEqual(p1, p2)
})

test('minifySvg strips prolog/doctype/comments and inter-tag whitespace', () => {
  const out = minifySvg(
    '<?xml version="1.0"?>\n<!DOCTYPE svg>\n<!-- hi -->\n<svg>\n  <g>\n  </g>\n</svg>'
  )
  assert.equal(out, '<svg><g></g></svg>')
})
