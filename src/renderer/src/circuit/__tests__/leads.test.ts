/**
 * Leads: a Fritzing part's bendable legs become drawn leads that end on their
 * pins (views/partsAdapter `withLeads`), and files from before that keep their
 * parts in the same holes (`leadMigration`, doc.meta.leads).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GRID_BB, LEADS_VERSION, emptyDoc, parseCircuitFile, serializeDoc } from '../core/model'
import { pinWorld } from '../core/geometry'
import * as cmd from '../core/commands'
import { ensureParts, getPart, viewFor } from '../../lib/partsLibrary'
import { leadMigration, pinWorldOf, visualFor, withLeads } from '../views/partsAdapter'

const LEADED = [
  'led-generic-5mm',
  'led-generic-3mm',
  'capacitor-electrolytic-medium',
  'capacitor-ceramic-100mil',
  'thermistor-300mil',
  'ldr-photocell-300mil-v5'
]
const UNCHANGED = [
  'resistor',
  'diode-1n4001-300mil',
  'transistor-signal-npn-to92-ebc',
  'voltage-regulator-7805'
]
const onGrid = (n: number): boolean => Math.abs(n / GRID_BB - Math.round(n / GRID_BB)) < 1e-3

test('an LED or capacitor pin is at the end of its lead, not on the body', async () => {
  await ensureParts(LEADED)
  for (const t of LEADED) {
    const raw = viewFor(getPart(t)!, 'breadboard')!
    const v = withLeads(raw)
    assert.notEqual(v, raw, `${t} kept its pins on the body`)
    for (const pin of Object.keys(raw.pins)) {
      // one whole grid square further down the lead, so pins stay on the grid
      const dy = v.pins[pin][1] - raw.pins[pin][1]
      assert.ok(onGrid(dy) && dy > 0, `${t} ${pin} moved ${dy}`)
      // and the box holds the tip
      assert.ok(v.pins[pin][1] <= v.h, `${t} ${pin} tip outside its box`)
    }
    // the clipped Fritzing leg is gone, a lead is drawn in its place
    assert.doesNotMatch(v.svg, /id="connector\d+leg"/, `${t} still draws the cut-off leg`)
    // the art keeps its scale: the viewBox grew with the box
    const vb = /viewBox="([^"]+)"/.exec(v.svg)![1].split(' ').map(Number)
    assert.ok(Math.abs(v.w / vb[2] - v.h / vb[3]) < 0.01 * (v.w / vb[2]), `${t} art rescaled`)
  }
})

test('parts whose pins are already at their lead ends are left alone', async () => {
  await ensureParts(UNCHANGED)
  for (const t of UNCHANGED) {
    const raw = viewFor(getPart(t)!, 'breadboard')!
    assert.equal(withLeads(raw), raw, `${t} changed`)
  }
})

test('an older circuit keeps every leaded part in the same holes, at any rotation', async () => {
  await ensureParts(LEADED)
  const doc = emptyDoc()
  delete doc.meta!.leads
  doc.parts = LEADED.flatMap((type, i) =>
    ([0, 90, 180, 270] as const).map((rotate, r) => ({
      id: `P${i}_${r}`,
      type,
      bb: { x: 96 + 48 * i, y: 96 + 96 * r, ...(rotate ? { rotate } : {}) }
    }))
  )
  // where each pin was, by the old geometry
  const was = new Map<string, { x: number; y: number }>()
  for (const p of doc.parts) {
    const raw = viewFor(getPart(p.type)!, 'breadboard')!
    for (const [pin, local] of Object.entries(raw.pins))
      was.set(`${p.id}:${pin}`, pinWorld(local, p.bb!, raw.w, raw.h))
  }
  const { moves, complete } = leadMigration(doc)
  assert.ok(complete)
  assert.equal(moves.length, doc.parts.length)
  const after = cmd.migrateLeads(moves, LEADS_VERSION).apply(doc)
  assert.equal(after.meta?.leads, LEADS_VERSION)
  for (const p of after.parts)
    for (const pin of Object.keys(visualFor(p.type, 'bb')!.v.pins)) {
      const a = was.get(`${p.id}:${pin}`)!
      const b = pinWorldOf(p, pin)!
      assert.ok(
        Math.hypot(a.x - b.x, a.y - b.y) < 0.02,
        `${p.id} ${pin} moved from ${JSON.stringify(a)} to ${JSON.stringify(b)}`
      )
    }
  // a current circuit has nothing to do
  assert.equal(leadMigration(after).moves.length, 0)
})

test('new circuits are current; files from before leads are not', () => {
  assert.equal(emptyDoc().meta?.leads, LEADS_VERSION)
  const fresh = parseCircuitFile(serializeDoc(emptyDoc())).doc
  assert.equal(fresh.meta?.leads, LEADS_VERSION)
  const old = parseCircuitFile(
    JSON.stringify({ format: 'tinystudio-circuit', version: 2, parts: [], wires: [] })
  ).doc
  assert.equal(old.meta?.leads, undefined, 'a file with no meta must still be migrated')
  const oldMeta = parseCircuitFile(
    JSON.stringify({
      format: 'tinystudio-circuit',
      version: 2,
      meta: { author: 'g' },
      parts: [],
      wires: []
    })
  ).doc
  assert.equal(oldMeta.meta?.leads, undefined)
})
