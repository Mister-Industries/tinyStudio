#!/usr/bin/env node
/**
 * parts-tool.mjs — maintenance commands for a tinyparts checkout.
 * The author-facing guide is docs/parts-and-art.md.
 *
 *   npm run parts:check                       validate every pack (art, pins, listings)
 *   npm run parts:check -- --fix              …and repair pack.json / index.json listings
 *   npm run parts:new -- my-sensor --pack core [--label "My Sensor"]
 *                                             scaffold a new folder part
 *   node scripts/parts-tool.mjs explode --pack sparkfun-led
 *                                             turn a pack's single-file JSON parts into
 *                                             editable folders (part.json + .svg files)
 *   node scripts/parts-tool.mjs explode --from src/.../parts --pack core --new "Core"
 *                                             …or build a new pack from a folder of PartDef JSON
 *
 * Common flags: --repo <dir>  the tinyparts checkout (default ../tinyparts)
 *
 * `check` reuses the app's own loaders (circuit/parts/folderPart.ts), bundled
 * on the fly with esbuild, so "check passes" means "the app will load it".
 */
import { build } from 'esbuild'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SRC = join(ROOT, 'src', 'renderer', 'src')

// ── args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t.startsWith('--')) {
      const key = t.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) a[key] = true
      else a[key] = argv[++i]
    } else a._.push(t)
  }
  return a
}

const args = parseArgs(process.argv.slice(2))
const command = args._[0]
const repo = resolve(ROOT, typeof args.repo === 'string' ? args.repo : '../tinyparts')

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').trimStart())

/**
 * JSON as a person would write it: arrays of plain values on one line, wrapped
 * at `width`. Same as formatJson in circuit/parts/folderPart.ts — keep in step.
 */
function formatJson(value, width = 100) {
  const text = JSON.stringify(value, null, 2)
  return (
    text.replace(/^( *)(.*)\[\n((?:\1 {2}[^[\]{}\n]*\n)+)\1\]/gm, (_m, indent, head, body) => {
      const items = body
        .split('\n')
        .filter(Boolean)
        .map((l) => l.trim().replace(/,$/, ''))
      const oneLine = `${indent}${head}[${items.join(', ')}]`
      if (oneLine.length <= width) return oneLine
      const lines = []
      let cur = ''
      for (const item of items) {
        if (cur && indent.length + 2 + cur.length + item.length + 2 > width) {
          lines.push(`${indent}  ${cur.trimEnd()}`)
          cur = ''
        }
        cur += `${item}, `
      }
      lines.push(`${indent}  ${cur.replace(/, $/, '')}`)
      return `${indent}${head}[\n${lines.join('\n')}\n${indent}]`
    }) + '\n'
  )
}

const writeJson = (p, v) => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, formatJson(v))
}
const writeText = (p, s) => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, s.endsWith('\n') ? s : s + '\n')
}
const isDir = (p) => existsSync(p) && statSync(p).isDirectory()

function usage(code = 0) {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('*/')[0]
      .replace(/^[\s\S]*?\/\*\*/, '')
  )
  process.exit(code)
}

if (!command || args.help || args.h) usage(command ? 0 : 1)
if (!isDir(repo) && command !== 'help') {
  console.error(`tinyparts checkout not found at ${repo} (pass --repo <dir>)`)
  process.exit(1)
}

// ── index.json bookkeeping ───────────────────────────────────────────────────

/** Add or refresh a pack's row in the repo index (other rows untouched). */
function upsertIndexEntry(pack) {
  const indexPath = join(repo, 'index.json')
  const index = existsSync(indexPath) ? readJson(indexPath) : { schema: 1, groups: [], packs: [] }
  const row = {
    id: pack.id,
    name: pack.name,
    version: pack.version,
    ...(pack.group ? { group: pack.group } : {}),
    ...(pack.icon ? { icon: pack.icon } : {}),
    ...(pack.bundled ? { bundled: true } : {}),
    count: pack.parts.length,
    files: pack.parts.length,
    ...(pack.description ? { description: pack.description } : {}),
    url: `packs/${pack.id}/pack.json`
  }
  const at = index.packs.findIndex((p) => p.id === pack.id)
  if (at >= 0) index.packs[at] = { ...index.packs[at], ...row }
  else if (pack.bundled) index.packs.unshift(row)
  else index.packs.push(row)
  if (pack.group && Array.isArray(index.groups) && !index.groups.includes(pack.group))
    pack.bundled ? index.groups.unshift(pack.group) : index.groups.push(pack.group)
  writeJson(indexPath, index)
}

// ── explode: single-file PartDef JSON → folder part ──────────────────────────

const VIEWS = ['breadboard', 'schematic']

/** Split one PartDef into part.json + real .svg files. */
function explodeDef(def, iconSvg) {
  const files = {}
  const views = {}
  for (const kind of VIEWS) {
    const v = def.views?.[kind]
    if (!v?.svg) continue
    files[`${kind}.svg`] = v.svg
    views[kind] = {
      svg: `${kind}.svg`,
      width: v.w,
      height: v.h,
      pins: v.pins,
      ...(v.legs?.length ? { legs: v.legs } : {})
    }
  }
  const { type, label, family, icon: ownIcon, ...rest } = def
  delete rest.views
  const icon = iconSvg ?? ownIcon
  let iconRef
  if (icon && icon !== def.views?.breadboard?.svg) {
    if (icon === def.views?.schematic?.svg) iconRef = 'schematic.svg'
    else {
      files['icon.svg'] = icon
      iconRef = 'icon.svg'
    }
  }
  const partJson = { type, label, family, ...rest, ...(iconRef ? { icon: iconRef } : {}), views }
  return { partJson, files }
}

function writeFolderPart(packDir, def, iconSvg) {
  const { partJson, files } = explodeDef(def, iconSvg)
  const dir = join(packDir, 'parts', def.type)
  writeJson(join(dir, 'part.json'), partJson)
  for (const [name, text] of Object.entries(files)) writeText(join(dir, name), text)
  return `parts/${def.type}`
}

function explode() {
  const packId = args.pack
  if (typeof packId !== 'string') {
    console.error('explode needs --pack <id>')
    process.exit(1)
  }
  const packDir = join(repo, 'packs', packId)

  if (typeof args.from === 'string') {
    // a folder of PartDef JSON (+ optional index.json manifest with icons) → a new pack
    const from = resolve(ROOT, args.from)
    const manifest = existsSync(join(from, 'index.json'))
      ? readJson(join(from, 'index.json'))
      : null
    const entries = manifest?.parts?.length
      ? manifest.parts.filter((m) => m.file)
      : readdirSync(from)
          .filter((f) => f.endsWith('.json') && f !== 'index.json' && !f.startsWith('_'))
          .map((file) => ({ file }))
    const parts = []
    for (const m of entries) {
      const def = readJson(join(from, m.file))
      parts.push({ type: def.type, dir: writeFolderPart(packDir, def, m.icon) })
    }
    const existing = existsSync(join(packDir, 'pack.json'))
      ? readJson(join(packDir, 'pack.json'))
      : {}
    const pack = {
      schema: 1,
      id: packId,
      name: typeof args.new === 'string' ? args.new : existing.name || packId,
      version: typeof args.version === 'string' ? args.version : existing.version || '1.0.0',
      ...(typeof args.group === 'string'
        ? { group: args.group }
        : existing.group
          ? { group: existing.group }
          : {}),
      ...(typeof args.icon === 'string'
        ? { icon: args.icon }
        : existing.icon
          ? { icon: existing.icon }
          : {}),
      ...(args.bundled || existing.bundled ? { bundled: true } : {}),
      ...(typeof args.description === 'string'
        ? { description: args.description }
        : existing.description
          ? { description: existing.description }
          : {}),
      parts
    }
    writeJson(join(packDir, 'pack.json'), pack)
    upsertIndexEntry(pack)
    console.log(`explode: wrote ${parts.length} folder parts to packs/${packId}`)
    return
  }

  // in place: a tinyparts pack whose parts are single JSON files
  const packPath = join(packDir, 'pack.json')
  if (!existsSync(packPath)) {
    console.error(`no pack at ${packPath}`)
    process.exit(1)
  }
  const pack = readJson(packPath)
  const only = typeof args.only === 'string' ? new Set(args.only.split(',')) : null
  let n = 0
  pack.parts = pack.parts.map((ref) => {
    if (!ref.file || (only && !only.has(ref.type))) return ref
    const jsonPath = join(packDir, ref.file)
    const def = readJson(jsonPath)
    const dir = writeFolderPart(packDir, def)
    rmSync(jsonPath)
    n++
    return { ...ref, file: undefined, dir }
  })
  pack.parts = pack.parts.map(({ file, ...r }) => (file ? { ...r, file } : r))
  writeJson(packPath, pack)
  console.log(`explode: ${n} part(s) in packs/${pack.id} are now folders`)
}

// ── new: scaffold a folder part ──────────────────────────────────────────────

function scaffold() {
  const type = args._[1]
  const packId = args.pack
  if (!type || typeof packId !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(type)) {
    console.error(
      'usage: parts-tool.mjs new <type> --pack <id> [--label "Name"] [--family "Sensor"]\n' +
        '  <type> is lower-case letters, digits and dashes (it becomes the folder name)'
    )
    process.exit(1)
  }
  const packDir = join(repo, 'packs', packId)
  const packPath = join(packDir, 'pack.json')
  if (!existsSync(packPath)) {
    console.error(`no pack at ${packPath}`)
    process.exit(1)
  }
  const dir = join(packDir, 'parts', type)
  if (existsSync(dir)) {
    console.error(`${dir} already exists`)
    process.exit(1)
  }
  const label = typeof args.label === 'string' ? args.label : type
  writeJson(join(dir, 'part.json'), {
    type,
    label,
    family: typeof args.family === 'string' ? args.family : 'Custom',
    views: { breadboard: { svg: 'breadboard.svg', width: '0.8in', height: '0.4in' } }
  })
  // 0.8in × 0.4in at 72 units/in, two pads on the 0.1in grid
  writeText(
    join(dir, 'breadboard.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="0.8in" height="0.4in" viewBox="0 0 57.6 28.8">
  <!-- Replace this with your art. Every shape whose id is "pin-<NAME>" is a pin:
       rename these, add more, move them — the app reads positions from the file. -->
  <rect x="0.5" y="0.5" width="56.6" height="20" rx="3" fill="#383a40" stroke="#4a4d54"/>
  <text x="28.8" y="13.5" font-family="sans-serif" font-size="7" fill="#ffffff" text-anchor="middle">${label}</text>
  <circle id="pin-1" cx="21.6" cy="25.2" r="2.4" fill="#c9a03c"/>
  <circle id="pin-2" cx="36" cy="25.2" r="2.4" fill="#c9a03c"/>
</svg>`
  )
  const pack = readJson(packPath)
  pack.parts.push({ type, dir: `parts/${type}` })
  writeJson(packPath, pack)
  if (existsSync(join(repo, 'index.json'))) {
    const index = readJson(join(repo, 'index.json'))
    if (index.packs.some((p) => p.id === pack.id)) upsertIndexEntry(pack)
  }
  console.log(
    `new: packs/${packId}/parts/${type}/  (part.json + breadboard.svg) — added to pack.json`
  )
}

// ── check ────────────────────────────────────────────────────────────────────

async function loadLoaders() {
  const out = await build({
    stdin: {
      contents: `export * from ${JSON.stringify(join(SRC, 'circuit/parts/folderPart.ts'))}
export * from ${JSON.stringify(join(SRC, 'circuit/parts/svgArt.ts'))}`,
      resolveDir: SRC,
      loader: 'ts'
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'error'
  })
  const tmp = mkdtempSync(join(tmpdir(), 'parts-tool-'))
  const file = join(tmp, 'loaders.mjs')
  writeFileSync(file, out.outputFiles[0].text)
  try {
    return await import(pathToFileURL(file).href)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function check() {
  const lib = await loadLoaders()
  const fix = !!args.fix
  const packsRoot = join(repo, 'packs')
  const ids =
    typeof args.pack === 'string'
      ? [args.pack]
      : readdirSync(packsRoot).filter((d) => isDir(join(packsRoot, d)))
  const index = existsSync(join(repo, 'index.json')) ? readJson(join(repo, 'index.json')) : null
  let errors = 0
  let warnings = 0
  let checked = 0
  const err = (m) => {
    errors++
    console.log(`  ✖ ${m}`)
  }
  const warn = (m) => {
    warnings++
    console.log(`  ⚠ ${m}`)
  }

  for (const id of ids) {
    const packDir = join(packsRoot, id)
    const packPath = join(packDir, 'pack.json')
    if (!existsSync(packPath)) {
      console.log(`packs/${id}`)
      err('no pack.json')
      continue
    }
    let pack
    try {
      pack = lib.parsePackJson(readFileSync(packPath, 'utf8'), `packs/${id}/pack.json`)
    } catch (e) {
      console.log(`packs/${id}`)
      err(e.message)
      continue
    }
    const folderRefs = pack.parts.filter((r) => r.dir)
    // single-file packs are generated by the Fritzing pipeline; only their listing is checked
    // unless --legacy asks for every JSON to be parsed too
    const onDisk = isDir(join(packDir, 'parts'))
      ? readdirSync(join(packDir, 'parts')).filter((d) => isDir(join(packDir, 'parts', d)))
      : []
    if (!folderRefs.length && !onDisk.length && !args.legacy) continue
    console.log(`packs/${id}  (${pack.parts.length} parts)`)
    if (index && !index.packs.some((p) => p.id === id)) {
      if (fix) upsertIndexEntry(pack)
      else err('not listed in index.json (run with --fix)')
    }

    const listed = new Set(folderRefs.map((r) => lib.joinPath(r.dir)))
    const unlisted = onDisk.filter(
      (d) => !listed.has(`parts/${d}`) && existsSync(join(packDir, 'parts', d, 'part.json'))
    )
    let changed = false
    for (const d of unlisted) {
      if (fix) {
        const json = readJson(join(packDir, 'parts', d, 'part.json'))
        pack.parts.push({ type: json.type || d, dir: `parts/${d}` })
        changed = true
        console.log(`  + listed parts/${d} in pack.json`)
      } else err(`parts/${d} has a part.json but pack.json doesn't list it (run with --fix)`)
    }
    for (const ref of folderRefs) {
      if (!existsSync(join(packDir, ref.dir, 'part.json'))) {
        if (fix) {
          pack.parts = pack.parts.filter((r) => r !== ref)
          changed = true
          console.log(`  - removed ${ref.dir} from pack.json (folder is gone)`)
        } else err(`${ref.dir}/part.json is missing (run with --fix to unlist it)`)
      }
    }
    if (changed) {
      writeJson(packPath, pack)
      if (index?.packs.some((p) => p.id === id)) upsertIndexEntry(pack)
    }
    // --fix also normalises formatting of hand-edited JSON (never its content)
    if (fix) {
      for (const p of [packPath, ...folderRefs.map((r) => join(packDir, r.dir, 'part.json'))]) {
        if (!existsSync(p)) continue
        const text = readFileSync(p, 'utf8')
        try {
          const pretty = formatJson(JSON.parse(text.trimStart()))
          if (pretty !== text.replace(/\r\n/g, '\n')) writeFileSync(p, pretty)
        } catch {
          /* invalid JSON is reported below */
        }
      }
    }

    const read = async (rel) => readFileSync(join(packDir, rel), 'utf8')
    const seen = new Set()
    for (const ref of pack.parts) {
      if (seen.has(ref.type)) err(`type "${ref.type}" is listed twice`)
      seen.add(ref.type)
      if (ref.file && !args.legacy) continue
      checked++
      try {
        if (ref.file) {
          const def = JSON.parse(await read(ref.file))
          if (!lib.isPartDef(def)) err(`${ref.file} is not a valid part definition`)
          continue
        }
        const where = `${lib.joinPath(ref.dir)}/part.json`
        const json = lib.parsePartJson(await read(where), where)
        if (json.type !== ref.type)
          err(`${where}: type "${json.type}" but pack.json lists "${ref.type}"`)
        if (ref.dir.split('/').pop() !== json.type)
          warn(`${where}: folder name differs from type "${json.type}"`)
        const def = await lib.buildFolderPart(json, read, {
          layer: 'dev',
          pack: id,
          dir: lib.joinPath(ref.dir)
        })
        for (const w of def.source.warnings) warn(`${json.type} — ${w}`)
        const names = new Set(Object.keys((def.views.breadboard ?? def.views.schematic).pins))
        for (const bus of json.buses ?? [])
          for (const p of bus)
            if (!names.has(p)) err(`${json.type} — bus references unknown pin "${p}"`)
        if (def.views.breadboard && def.views.schematic) {
          const bb = Object.keys(def.views.breadboard.pins).sort().join()
          const sch = Object.keys(def.views.schematic.pins).sort().join()
          if (bb !== sch) warn(`${json.type} — breadboard and schematic pin names differ`)
        }
      } catch (e) {
        err(e.message)
      }
    }
  }
  console.log(
    `\n${checked} part(s) checked — ${errors} error(s), ${warnings} warning(s)${errors && !fix ? '\n(some listing problems can be repaired with --fix)' : ''}`
  )
  process.exit(errors ? 1 : 0)
}

// ── dispatch ─────────────────────────────────────────────────────────────────

if (command === 'explode') explode()
else if (command === 'new') scaffold()
else if (command === 'check') await check()
else usage(1)
