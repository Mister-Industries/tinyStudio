#!/usr/bin/env node
/**
 * make-pack-index.mjs — wrap a scripts/fritzing-import.mjs output directory
 * into a tinyStudio parts pack (pack.json + parts/*.json) plus a repo-level
 * index.json, ready to publish as the raw contents of a GitHub repo. See
 * docs/tinyparts-pack-setup.md for the full walkthrough.
 *
 * fritzing-import.mjs already writes flat per-part JSON + its own index.json
 * manifest ({ parts: [{ type, file, ... }] }) — this script just re-shapes
 * that manifest into circuit/parts/packs.ts's pack.json format and copies
 * the part files alongside it, merging into (or creating) the repo's
 * top-level index.json so multiple packs can coexist.
 *
 * Usage:
 *   node scripts/make-pack-index.mjs \
 *     --parts src/renderer/src/assets/parts \   # fritzing-import.mjs output (has index.json)
 *     --out   ../tinyparts \                    # the tinyparts repo checkout
 *     --id    tinystudio-core \
 *     --name  "tinyStudio Core Parts" \
 *     --version 1.0.0 \
 *     --description "Curated Fritzing-derived parts for breadboard + schematic"
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function parseArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    const next = () => argv[++i]
    if (t === '--parts') a.parts = next()
    else if (t === '--out') a.out = next()
    else if (t === '--id') a.id = next()
    else if (t === '--name') a.name = next()
    else if (t === '--version') a.version = next()
    else if (t === '--description') a.description = next()
    else if (t === '--help' || t === '-h') a.help = true
  }
  return a
}

const args = parseArgs(process.argv.slice(2))
if (args.help || !args.parts || !args.out || !args.id || !args.name || !args.version) {
  console.log(`Usage: node scripts/make-pack-index.mjs --parts <dir> --out <dir> --id <id> --name "<name>" --version <semver> [--description "..."]

  --parts   output directory of a prior fritzing-import.mjs run (must contain index.json)
  --out     the tinyparts repo checkout to write/update (index.json + packs/<id>/)
  --id      pack id, e.g. tinystudio-core
  --name    display name, e.g. "tinyStudio Core Parts"
  --version semver, e.g. 1.0.0
`)
  process.exit(args.help ? 0 : 1)
}

const manifestPath = join(args.parts, 'index.json')
if (!existsSync(manifestPath)) {
  console.error(`No index.json in ${args.parts} — run scripts/fritzing-import.mjs first.`)
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const packDir = join(args.out, 'packs', args.id)
mkdirSync(join(packDir, 'parts'), { recursive: true })

const parts = []
for (const p of manifest.parts) {
  cpSync(join(args.parts, p.file), join(packDir, 'parts', p.file))
  parts.push({ type: p.type, file: `parts/${p.file}` })
}

const pack = {
  schema: 1,
  id: args.id,
  name: args.name,
  version: args.version,
  ...(args.description ? { description: args.description } : {}),
  parts
}
writeFileSync(join(packDir, 'pack.json'), JSON.stringify(pack, null, 2))

const indexPath = join(args.out, 'index.json')
const index = existsSync(indexPath)
  ? JSON.parse(readFileSync(indexPath, 'utf8'))
  : { schema: 1, packs: [] }
const entry = {
  id: args.id,
  name: args.name,
  version: args.version,
  ...(args.description ? { description: args.description } : {}),
  url: `packs/${args.id}/pack.json`
}
const i = index.packs.findIndex((p) => p.id === args.id)
if (i >= 0) index.packs[i] = entry
else index.packs.push(entry)
writeFileSync(indexPath, JSON.stringify(index, null, 2))

console.log(`Wrote ${packDir}/pack.json (${parts.length} parts)`)
console.log(`Updated ${indexPath} (${index.packs.length} pack${index.packs.length === 1 ? '' : 's'} listed)`)
