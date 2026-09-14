#!/usr/bin/env node
/**
 * sync-tinyparts.mjs — copy the BUNDLED tinyparts packs into the app.
 *
 *   npm run parts:sync                     from ../tinyparts (the working tree)
 *   npm run parts:sync -- --repo <dir>     from another checkout
 *
 * Every pack whose index.json row says `"bundled": true` is copied to
 * src/renderer/src/assets/tinyparts/packs/<id>/ — just pack.json, each part's
 * part.json, and the art files those reference (stray .ai files, READMEs and
 * the like stay behind) — and snapshot.gen.ts is regenerated to index them.
 *
 * Each copied file is recorded with its git blob sha. At launch the app asks
 * GitHub for the current tree and only downloads files whose sha differs, so
 * a released build that already matches GitHub downloads nothing.
 *
 * Run this before cutting a release, after pushing tinyparts. You don't need it
 * while editing art: `npm run dev` can read your tinyparts checkout directly
 * (Parts Packs → Developer). See docs/parts-and-art.md.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, 'src', 'renderer', 'src', 'assets', 'tinyparts')

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('*/')[0]
      .replace(/^[\s\S]*?\/\*\*/, '')
  )
  process.exit(0)
}
const repo = resolve(ROOT, flag('repo') ?? '../tinyparts')
if (!existsSync(join(repo, 'index.json'))) {
  console.error(`No tinyparts checkout at ${repo} (expected index.json). Pass --repo <dir>.`)
  process.exit(1)
}

const git = (...args) => {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

/** GitHub stores text with LF endings; hash what GitHub will hash. */
const TEXT = /\.(json|svg|md|txt)$/i
function blob(path) {
  let buf = readFileSync(path)
  if (TEXT.test(path)) buf = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
  const sha = createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
  return { buf, sha }
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').trimStart())
const posix = (...parts) =>
  parts
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/(^|\/)\.\//g, '$1')

/** pack.json + part.json + the files each part references (pack-relative). */
function packFiles(packDir) {
  const pack = readJson(join(packDir, 'pack.json'))
  const files = new Set(['pack.json'])
  for (const ref of pack.parts ?? []) {
    if (ref.file) files.add(posix(ref.file))
    if (!ref.dir) continue
    const partPath = posix(ref.dir, 'part.json')
    files.add(partPath)
    const part = readJson(join(packDir, partPath))
    for (const kind of ['breadboard', 'schematic']) {
      const svg = part.views?.[kind]?.svg
      if (svg) files.add(posix(ref.dir, svg))
    }
    if (part.icon) files.add(posix(ref.dir, part.icon))
  }
  return { pack, files: [...files] }
}

/** The file the palette draws first (eagerly imported). */
function isEager(rel, packDir) {
  if (rel === 'pack.json' || rel.endsWith('/part.json')) return true
  const dir = rel.slice(0, rel.lastIndexOf('/'))
  const partPath = join(packDir, dir, 'part.json')
  if (!existsSync(partPath)) return false
  const part = readJson(partPath)
  const icon = part.icon ?? part.views?.breadboard?.svg ?? part.views?.schematic?.svg
  return icon && posix(dir, icon) === rel
}

// ── which packs, from where ──────────────────────────────────────────────────

const index = readJson(join(repo, 'index.json'))
const bundled = index.packs.filter((p) => p.bundled)
if (!bundled.length) {
  console.error('index.json lists no packs with "bundled": true — nothing to sync.')
  process.exit(1)
}

const remoteUrl = git('remote', 'get-url', 'origin') ?? ''
const gh = /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(remoteUrl)
const repoName = gh ? `${gh[1]}/${gh[2]}` : 'Mister-Industries/tinyparts'
const commit = git('rev-parse', 'HEAD') ?? ''
const dirty = git('status', '--porcelain', '--', ...bundled.map((p) => `packs/${p.id}`)) ?? ''
const unpushed = git('rev-list', '--count', '@{u}..HEAD')

// ── copy ─────────────────────────────────────────────────────────────────────

rmSync(join(OUT, 'packs'), { recursive: true, force: true })
const snapshotPacks = []
const eager = []
const lazy = []
let bytes = 0

for (const row of bundled) {
  const packDir = join(repo, 'packs', row.id)
  const { pack, files } = packFiles(packDir)
  const shas = {}
  for (const rel of files.sort()) {
    const src = join(packDir, rel)
    if (!existsSync(src)) {
      console.error(`✖ packs/${row.id}/${rel} is referenced but missing — run npm run parts:check`)
      process.exit(1)
    }
    const { buf, sha } = blob(src)
    const dest = join(OUT, 'packs', row.id, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, buf)
    bytes += buf.length
    shas[rel] = sha
    ;(isEager(rel, packDir) ? eager : lazy).push(posix('packs', row.id, rel))
  }
  snapshotPacks.push({ id: pack.id, files: shas })
  console.log(
    `  ${pack.id.padEnd(12)} ${String(pack.parts.length).padStart(3)} parts  ${String(files.length).padStart(4)} files`
  )
}

// ── snapshot.gen.ts ──────────────────────────────────────────────────────────

const q = (s) => JSON.stringify(s)
const lines = [
  '// GENERATED by scripts/sync-tinyparts.mjs — do not edit.',
  `// A copy of the bundled packs from github.com/${repoName}.`,
  '// To change a part, edit it in tinyparts and run `npm run parts:sync`.',
  '/* eslint-disable */',
  '',
  ...eager.map((p, i) => `import f${i} from ${q(`./${p}?raw`)}`),
  '',
  'export interface SnapshotPack {',
  '  id: string',
  '  /** pack-relative path → git blob sha */',
  '  files: Record<string, string>',
  '}',
  '',
  'export interface TinypartsSnapshot {',
  '  /** GitHub owner/repo the packs came from */',
  '  repo: string',
  '  /** tinyparts HEAD when synced */',
  '  commit: string',
  '  /** true if the checkout had uncommitted changes in these packs */',
  '  dirty: boolean',
  '  packs: SnapshotPack[]',
  '}',
  '',
  `export const SNAPSHOT: TinypartsSnapshot = ${JSON.stringify(
    { repo: repoName, commit, dirty: !!dirty, packs: snapshotPacks },
    null,
    2
  )}`,
  '',
  '/** repo-relative path → file text (part.json, pack.json and palette icons) */',
  'export const EAGER: Record<string, string> = {',
  ...eager.map((p, i) => `  ${q(p)}: f${i},`),
  '}',
  '',
  '/** repo-relative path → lazy loader for everything else */',
  'export const LAZY: Record<string, () => Promise<string>> = {',
  ...lazy.map((p) => `  ${q(p)}: () => import(${q(`./${p}?raw`)}).then((m) => m.default),`),
  '}',
  ''
]
writeFileSync(join(OUT, 'snapshot.gen.ts'), lines.join('\n'))
writeFileSync(
  join(OUT, 'README.md'),
  `# Bundled tinyparts snapshot — don't edit here

Everything in this folder is copied from the [tinyparts](https://github.com/${repoName})
repo by \`npm run parts:sync\` and will be overwritten the next time it runs.

To change a part's art or pins, edit it in your tinyparts checkout
(\`packs/<pack>/parts/<type>/\`), then run \`npm run parts:sync\` here.
See [docs/parts-and-art.md](../../../../../docs/parts-and-art.md).
`
)

console.log(
  `\nsynced ${snapshotPacks.length} pack(s), ${eager.length + lazy.length} files (${(bytes / 1024).toFixed(0)} KB) from ${repoName}@${commit.slice(0, 7) || '?'}`
)
if (dirty)
  console.warn(
    `\n⚠ tinyparts has UNCOMMITTED changes in these packs — they're in the snapshot, but not on GitHub yet.\n` +
      `  Commit and push tinyparts, or installed apps will "update" back to what GitHub has.\n` +
      dirty
        .split('\n')
        .slice(0, 8)
        .map((l) => `    ${l}`)
        .join('\n')
  )
else if (unpushed && unpushed !== '0')
  console.warn(`\n⚠ tinyparts has ${unpushed} unpushed commit(s) — push before releasing.`)
