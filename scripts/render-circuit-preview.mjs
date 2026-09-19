#!/usr/bin/env node
/**
 * render-circuit-preview.mjs: render a circuit document to a standalone SVG,
 * headlessly, without launching the app.
 *
 *   node scripts/render-circuit-preview.mjs [--view sch|bb] [--out file.svg] [doc.json]
 *
 * Why: the schematic's look (symbol weights, fonts, symbol scale, label
 * placement) is the kind of thing you can only judge by looking at it, and
 * booting Electron for every tweak is slow. This bundles the real rendering
 * path: parts registry → partsAdapter geometry → views/exportImage, the same
 * one the in-app PNG/SVG export uses, so what comes out is what the app draws.
 *
 * With no document argument it renders a built-in sampler: one of every part in
 * the library, laid out on a grid, which is the fastest way to spot a symbol
 * that is the wrong size or inked at the wrong weight.
 *
 * Design-system CSS variables are substituted with their light-theme values
 * (the app inlines them at export time via resolveCssVars, which needs a DOM).
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const src = join(root, 'src', 'renderer', 'src')

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}
const view = flag('view', 'sch')
const out = resolve(flag('out', join(root, `circuit-preview-${view}.svg`)))
const docPath = argv.find((a) => a.endsWith('.json'))

/** Vite's `?raw` suffix: same shim the circuit test runner uses. */
const rawImports = {
  name: 'raw-imports',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.slice(0, -4)),
      namespace: 'raw'
    }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({
      contents: readFileSync(args.path, 'utf8'),
      loader: 'text'
    }))
  }
}

const entry = `
import { writeFileSync, readFileSync } from 'node:fs'
import { emptyDoc, parseCircuitFile, GRID_BB } from ${JSON.stringify(join(src, 'circuit/core/model'))}
import { PART_MANIFEST, ensureParts, getPart, registerPart } from ${JSON.stringify(join(src, 'lib/partsLibrary'))}
import { BREADBOARDS, generateBreadboard } from ${JSON.stringify(join(src, 'circuit/parts/breadboard'))}
import { SIM_SOURCES, generateSimSource } from ${JSON.stringify(join(src, 'circuit/parts/simParts'))}
import { SIM_PROBES, generateSimProbe } from ${JSON.stringify(join(src, 'circuit/parts/simProbes'))}
import { composeSceneSvg } from ${JSON.stringify(join(src, 'circuit/views/exportImage'))}
import { visualFor } from ${JSON.stringify(join(src, 'circuit/views/partsAdapter'))}

const VIEW = ${JSON.stringify(view)}
const OUT = ${JSON.stringify(out)}
const DOC_PATH = ${JSON.stringify(docPath ?? '')}

for (const s of BREADBOARDS) registerPart(generateBreadboard(s).def)
for (const s of SIM_SOURCES) registerPart(generateSimSource(s))
for (const s of SIM_PROBES) registerPart(generateSimProbe(s))

let doc
if (DOC_PATH) {
  doc = parseCircuitFile(readFileSync(DOC_PATH, 'utf8')).doc
  await ensureParts(doc.parts.map((p) => p.type))
} else {
  // sampler: every part in the library on a grid, biggest row height per row
  const types = PART_MANIFEST.map((m) => m.type).filter((t) => !t.startsWith('breadboard-'))
  await ensureParts(types)
  doc = emptyDoc()
  // shelf packing on measured symbol sizes; a fixed cell grid buries the
  // big symbols (a 10-pin display is 20x a diode) under their neighbours
  const COLS = 6
  const GAP = GRID_BB * 6
  const cells = types
    .filter((t) => getPart(t) && visualFor(t, VIEW))
    .map((t) => ({ type: t, vis: visualFor(t, VIEW) }))
  const colW = Math.max(...cells.map((c) => c.vis.v.w)) + GAP
  let x = GRID_BB * 4
  let y = GRID_BB * 4
  let rowH = 0
  let col = 0
  for (const c of cells) {
    if (col === COLS) {
      col = 0
      x = GRID_BB * 4
      y += rowH + GAP
      rowH = 0
    }
    doc.parts.push({
      id: c.type,
      type: c.type,
      [VIEW]: {
        x: Math.round(x / GRID_BB) * GRID_BB,
        y: Math.round(y / GRID_BB) * GRID_BB
      }
    })
    rowH = Math.max(rowH, c.vis.v.h)
    x += colW
    col++
  }
}

const svg = composeSceneSvg(doc, VIEW === 'sch' ? '#ffffff' : '#f5f7f9', VIEW)
if (!svg) {
  console.error('nothing to render in the', VIEW, 'view')
  process.exit(1)
}

// The app inlines design-system variables through getComputedStyle; there is
// no DOM here, so substitute the light-theme values.
const VARS = {
  '--text-strong': '#181a1e',
  '--text-body': '#24272c',
  '--text-muted': '#79818c',
  '--text-faint': '#a3abb5',
  '--border-strong': '#181a1e',
  '--border-default': '#cfd5dc',
  '--surface-card': '#ffffff',
  '--bg-sunken': '#edf0f3',
  '--brand': '#f3cb00',
  '--yellow': '#f3cb00',
  '--cyan': '#22b8cf',
  '--pink': '#f06595',
  '--font-sans': "'Plus Jakarta Sans', system-ui, sans-serif",
  '--font-mono': "'Fira Code', ui-monospace, monospace"
}
const resolved = svg.replace(/var\\((--[A-Za-z0-9_-]+)\\)/g, (all, name) => VARS[name] ?? all)
writeFileSync(OUT, resolved)
console.log('wrote', OUT, '(' + doc.parts.length + ' parts,', VIEW + ')')
`

const tmp = mkdtempSync(join(tmpdir(), 'circuit-preview-'))
try {
  const entryFile = join(tmp, 'entry.ts')
  writeFileSync(entryFile, entry)
  const bundle = join(tmp, 'entry.mjs')
  await build({
    entryPoints: [entryFile],
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: ['node:*'],
    logLevel: 'error',
    plugins: [rawImports],
    absWorkingDir: root
  })
  const res = spawnSync(process.execPath, [bundle], { stdio: 'inherit' })
  process.exit(res.status ?? 1)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
