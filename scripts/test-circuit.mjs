#!/usr/bin/env node
/**
 * test-circuit.mjs — zero-extra-dependency test runner for the Circuit v2 core.
 *
 * Bundles every src/renderer/src/**\/__tests__/*.test.ts with esbuild (already
 * a transitive dependency via vite) into a temp dir, then runs them with
 * Node's built-in test runner (node:test).
 *
 *   npm run test:circuit
 *
 * Why not vitest? Nothing against it — adopt it whenever it lands in the repo;
 * these test files are plain node:test + assert and will port in minutes.
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcRoot = resolve(__dirname, '..', 'src', 'renderer', 'src')

// Every `__tests__/*.test.ts` under the renderer, not just the circuit's — so a
// new suite (lib/__tests__, components/__tests__) is picked up by dropping the
// file in, with no change here. `outbase` below keeps the directory structure
// in the temp build, so two suites may share a basename.
const files = readdirSync(srcRoot, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.test.ts') && basename(e.parentPath ?? e.path) === '__tests__')
  .map((e) => join(e.parentPath ?? e.path, e.name))
  .sort()
if (files.length === 0) {
  console.error('No *.test.ts files found under', srcRoot)
  process.exit(1)
}

/**
 * Vite's `?raw` suffix, which esbuild knows nothing about: the built-in
 * tinyBoards import their breadboard SVGs that way (see partsLibrary.ts).
 * Resolve the suffix off the path and hand esbuild the file as text.
 */
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

const out = mkdtempSync(join(tmpdir(), 'circuit-tests-'))
try {
  await build({
    entryPoints: files,
    outdir: out,
    outbase: srcRoot,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    sourcemap: 'inline',
    external: ['node:*'],
    outExtension: { '.js': '.mjs' },
    logLevel: 'error',
    plugins: [rawImports]
  })
  const compiled = readdirSync(out, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.mjs'))
    .map((e) => join(e.parentPath ?? e.path, e.name))
  const res = spawnSync(process.execPath, ['--test', ...compiled], { stdio: 'inherit' })
  process.exit(res.status ?? 1)
} finally {
  rmSync(out, { recursive: true, force: true })
}
