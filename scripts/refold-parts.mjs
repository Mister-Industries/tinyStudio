#!/usr/bin/env node
/**
 * refold-parts.mjs — re-pass over an already-published tinyparts repo.
 *
 * Two jobs, both of which used to mean a fritzing-parts checkout and a full
 * re-import:
 *
 *  1. RE-FOLD. Re-derive which parts get a palette tile using the current rule
 *     in `lib/fold-variants.mjs` (one tile per pack + family + base title)
 *     instead of whatever rule the packs were built with. This is what removes
 *     the sixteen identical "Inductors" squares from SparkFun · Passives.
 *
 *  2. BUNDLE THE CORE (`--bundle`). Copy every `core-*` pack into the app's own
 *     parts directory so the Core bin ships with tinyStudio instead of being
 *     ten things you have to install. The packs are then dropped from the
 *     tinyparts index and their ids recorded in `packMigration.json`, so an
 *     existing install discards the copies it downloaded and uses the bundled
 *     ones.
 *
 * The part JSONs are already converted (pins in px @ 96 DPI, artwork inlined),
 * so this needs no Fritzing source — it only rewrites presentation metadata:
 * `label`, `variantOf`, `variants`, `order`.
 *
 * Folding is per-pack, so packs are independent and can be done a few at a
 * time. That matters in practice: the library is 125 MB and these repos are
 * often on a network or virtualised filesystem, where one pass over everything
 * runs for minutes. `--packs` exists so the work can be split up and resumed.
 *
 * Usage
 * -----
 *   node scripts/refold-parts.mjs --repo ../tinyparts --packs core-basic,arduino
 *   node scripts/refold-parts.mjs --repo ../tinyparts --all
 *   node scripts/refold-parts.mjs --repo ../tinyparts --finish --bundle
 *
 *   --repo <dir>     tinyparts checkout                        (required)
 *   --packs <ids>    comma list of pack ids to re-fold
 *   --all            every pack (one long run)
 *   --bundle         core-* parts are written to the app, not the pack
 *   --finish         rewrite index.json + packMigration.json, drop core packs
 *   --version <v>    version stamped on rewritten packs   (default: minor bump)
 *   --dry            report only, write nothing
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packIcons } from './lib/bin-icons.mjs'
import { BIN_TO_PACK } from './lib/bin-map.mjs'
import { disambiguateLabels, foldVariants } from './lib/fold-variants.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, '..')
const APP_PARTS_DIR = join(REPO, 'src/renderer/src/assets/parts')
const MIGRATION_FILE = join(REPO, 'src/renderer/src/assets/packMigration.json')

/** Sparse but monotonic: the palette only ever compares `order`, so a core
 * section can own a block of the sequence without the packs being re-numbered
 * as one list. Keeps Basic ahead of Misc while letting packs run separately. */
const SECTION_STRIDE = 10000

// ── CLI ─────────────────────────────────────────────────────────────────────

const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const t = process.argv[i]
  if (t === '--repo') args.repo = process.argv[++i]
  else if (t === '--packs') args.packs = process.argv[++i].split(',').map((s) => s.trim())
  else if (t === '--version') args.version = process.argv[++i]
  else if (t === '--bins') args.bins = process.argv[++i]
  else if (t === '--all') args.all = true
  else if (t === '--reset-bundle') args.resetBundle = true
  else if (t === '--bundle') args.bundle = true
  else if (t === '--finish') args.finish = true
  else if (t === '--dry') args.dry = true
  else if (t === '--help' || t === '-h') args.help = true
  else console.warn(`Unknown arg: ${t}`)
}
if (args.help || !args.repo) {
  console.log(
    'Usage: node scripts/refold-parts.mjs --repo <tinyparts>\n' +
      '         [--packs a,b,c | --all] [--bundle] [--finish] [--dry]'
  )
  process.exit(args.help ? 0 : 1)
}

const repoDir = resolve(process.cwd(), args.repo)
const packsDir = join(repoDir, 'packs')
const indexFile = join(repoDir, 'index.json')
if (!existsSync(packsDir) || !existsSync(indexFile)) {
  console.error(`${repoDir} doesn't look like a tinyparts checkout (no packs/ + index.json)`)
  process.exit(1)
}

const index = JSON.parse(readFileSync(indexFile, 'utf8'))

function bumpMinor(v) {
  const [maj = '1', min = '0'] = String(v || '1.0.0').split('.')
  return `${maj}.${Number(min) + 1}.0`
}
const version = args.version || bumpMinor(index.packs[0]?.version)

/** Core sections, in the order the index lists them — that's the sequence the
 * bundled Core bin reads top to bottom. */
const CORE_PACKS = index.packs.map((p) => p.id).filter((id) => id.startsWith('core-'))
const coreRank = new Map(CORE_PACKS.map((id, i) => [id, i]))

const onDisk = readdirSync(packsDir).filter((d) => existsSync(join(packsDir, d, 'parts')))
const targets = args.all ? onDisk : (args.packs ?? []).filter((id) => onDisk.includes(id))

// ── shared writers ──────────────────────────────────────────────────────────

let written = 0
let skipped = 0

/**
 * Write only when the bytes actually change. Most of the library is untouched
 * by a re-fold, and a blind rewrite of 1776 files on a mounted filesystem takes
 * minutes — comparing first is much cheaper. `prev` lets the caller pass the
 * text it already read, so the file isn't read twice.
 */
function write(path, data, prev) {
  const next = JSON.stringify(data, null, 2) + '\n'
  const before = prev ?? (existsSync(path) ? readFileSync(path, 'utf8') : null)
  if (before === next) {
    skipped++
    return
  }
  writeFileSync(path, next)
  written++
}

const familySlug = (s) =>
  String(s || 'misc')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'misc'

/** The manifest row the palette reads — PartMeta minus the runtime `source`. */
function metaOf(def, file) {
  const views = Object.keys(def.views)
  const first = def.views[views[0]]
  return {
    type: def.type,
    label: def.label,
    family: def.family || 'Misc',
    familySlug: familySlug(def.family),
    views,
    pins: Object.keys(first?.pins || {}).length,
    icon: def.icon || first?.svg,
    file,
    ...(def.tags?.length ? { tags: def.tags } : {}),
    ...(def.properties && Object.keys(def.properties).length ? { properties: def.properties } : {}),
    ...(def.variants ? { variants: def.variants } : {}),
    ...(def.variantOf ? { variantOf: def.variantOf } : {}),
    ...(def.order != null ? { order: def.order } : {})
  }
}

// ── re-fold, one pack at a time ─────────────────────────────────────────────

/** Rows destined for the bundled manifest, accumulated across runs. */
const bundleManifestPath = join(APP_PARTS_DIR, 'index.json')

// `--reset-bundle` clears the app's parts directory before the first pack run,
// so the bundled Core bin is exactly what the core packs contain today rather
// than that plus whatever the app happened to ship before.
if (args.resetBundle && !args.dry) {
  if (!existsSync(APP_PARTS_DIR)) mkdirSync(APP_PARTS_DIR, { recursive: true })
  let n = 0
  for (const fn of readdirSync(APP_PARTS_DIR)) {
    rmSync(join(APP_PARTS_DIR, fn), { recursive: true, force: true })
    n++
  }
  console.log(`--reset-bundle: cleared ${n} files from src/renderer/src/assets/parts\n`)
}

function loadBundledManifest() {
  if (!existsSync(bundleManifestPath)) return new Map()
  const prev = JSON.parse(readFileSync(bundleManifestPath, 'utf8'))
  return new Map((prev.parts ?? []).map((m) => [m.type, m]))
}

for (const packId of targets) {
  const partsDir = join(packsDir, packId, 'parts')
  const entries = []
  for (const fn of readdirSync(partsDir).sort()) {
    if (!fn.endsWith('.json')) continue
    const raw = readFileSync(join(partsDir, fn), 'utf8')
    const def = JSON.parse(raw)
    if (!def?.type || !def?.views) continue
    entries.push({ packId, fn, raw, def, prevOrder: def.order ?? Number.MAX_SAFE_INTEGER })
  }
  if (!entries.length) continue

  // "was a primary last time" stands in for "Fritzing curated this into a bin"
  // — the signal the original import already resolved, and re-deriving it would
  // mean re-reading fritzing-parts.
  const wasPrimary = new Set(entries.filter((e) => !e.def.variantOf).map((e) => e.def.type))
  const before = wasPrimary.size

  const fold = foldVariants(entries, { inBin: (def) => wasPrimary.has(def.type) })
  const relabelled = disambiguateLabels(entries)

  // keep the sequence the pack already has, just dense again after the fold
  entries.sort(
    (a, b) =>
      a.prevOrder - b.prevOrder ||
      (a.def.family || '').localeCompare(b.def.family || '') ||
      a.def.label.localeCompare(b.def.label) ||
      a.def.type.localeCompare(b.def.type)
  )
  const base = args.bundle && coreRank.has(packId) ? coreRank.get(packId) * SECTION_STRIDE : 0
  entries.forEach((e, i) => {
    e.def.order = base + i
  })

  const clashes = []
  const seen = new Map()
  for (const e of entries) {
    if (e.def.variantOf) continue
    const k = e.def.label.toLowerCase()
    if (seen.has(k)) clashes.push(e.def.label)
    seen.set(k, true)
  }

  console.log(
    `${packId.padEnd(30)} ${String(before).padStart(4)} → ${String(fold.tiles).padStart(4)} tiles ` +
      `(${fold.variants} folded into ${fold.groups}, ${relabelled} relabelled)` +
      (clashes.length ? `  ⚠ ${clashes.length} duplicate labels` : '')
  )
  for (const c of clashes) console.log(`    CLASH ${c}`)

  if (args.dry) continue

  const toApp = args.bundle && coreRank.has(packId)
  if (toApp) {
    const manifest = loadBundledManifest()
    for (const e of entries) {
      delete e.def.pack
      const fn = `${e.def.type}.json`
      write(join(APP_PARTS_DIR, fn), e.def)
      manifest.set(e.def.type, metaOf(e.def, fn))
    }
    const parts = [...manifest.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    writeFileSync(
      bundleManifestPath,
      JSON.stringify({ version: 1, generated: new Date().toISOString(), parts }, null, 2) + '\n'
    )
  } else {
    for (const e of entries) write(join(partsDir, e.fn), e.def, e.raw)

    const manifestPath = join(packsDir, packId, 'pack.json')
    const pack = JSON.parse(readFileSync(manifestPath, 'utf8'))
    pack.version = version
    pack.parts = entries
      .slice()
      .sort((a, b) => a.def.order - b.def.order)
      .map((e) => ({ type: e.def.type, file: `parts/${e.fn}` }))
    write(manifestPath, pack)
  }

  const row = index.packs.find((p) => p.id === packId)
  if (row && !toApp) {
    row.version = version
    row.count = entries.filter((e) => !e.def.variantOf).length
    row.files = entries.length
  }
}

if (targets.length) console.log(`\nfiles: ${written} written, ${skipped} unchanged`)

// ── finish: index, migration, retire the core packs ─────────────────────────

if (args.finish && !args.dry) {
  // Tab artwork. Fritzing drew a mark for most of these bins and it's sitting
  // unused in bins/more; a monogram is what you fall back to, not what you
  // choose. Stamped onto both index.json (the installer's rows and, after an
  // install, the palette tab) and pack.json (so a pack installed from a direct
  // URL still gets its icon).
  if (args.bins) {
    const icons = packIcons(resolve(process.cwd(), args.bins), BIN_TO_PACK)
    let n = 0
    for (const row of index.packs) {
      const icon = icons[row.id]
      if (!icon) continue
      row.icon = icon
      n++
      const manifestPath = join(packsDir, row.id, 'pack.json')
      if (!existsSync(manifestPath)) continue
      const pack = JSON.parse(readFileSync(manifestPath, 'utf8'))
      pack.icon = icon
      writeFileSync(manifestPath, JSON.stringify(pack, null, 2) + '\n')
    }
    console.log(`bin icons: ${n} of ${index.packs.length} packs (the rest keep their monogram)`)
  }

  if (args.bundle) {
    // orphans: parts the app shipped before that no core pack provides now
    const manifest = loadBundledManifest()
    let orphans = 0
    for (const fn of readdirSync(APP_PARTS_DIR)) {
      if (fn === 'index.json') continue
      if (manifest.has(fn.replace(/\.json$/, ''))) continue
      rmSync(join(APP_PARTS_DIR, fn))
      orphans++
    }
    console.log(`bundled manifest: ${manifest.size} parts (${orphans} stale files removed)`)

    for (const id of CORE_PACKS) rmSync(join(packsDir, id), { recursive: true, force: true })
    index.packs = index.packs.filter((p) => !CORE_PACKS.includes(p.id))
    index.groups = (index.groups || []).filter((g) => g !== 'Core')

    const migration = existsSync(MIGRATION_FILE)
      ? JSON.parse(readFileSync(MIGRATION_FILE, 'utf8'))
      : { schema: 1, legacyPackIds: [], packs: {} }
    migration.version = version
    // an existing install downloaded these; the bundled copies supersede them
    migration.bundledPackIds = CORE_PACKS
    for (const id of CORE_PACKS) delete migration.packs?.[id]
    writeFileSync(MIGRATION_FILE, JSON.stringify(migration, null, 2) + '\n')
    console.log(`retired ${CORE_PACKS.length} core packs → assets/packMigration.json`)
  }

  writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n')
  console.log(`index.json: ${index.packs.length} packs at v${version}`)
} else if (!args.dry && targets.length) {
  writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n')
}

if (!targets.length && !args.finish && !args.resetBundle) {
  console.log('nothing to do — pass --packs <ids>, --all, or --finish')
}
