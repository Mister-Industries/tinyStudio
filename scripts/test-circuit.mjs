#!/usr/bin/env node
/**
 * test-circuit.mjs — zero-extra-dependency test runner for the Circuit v2 core.
 *
 * Bundles each src/renderer/src/circuit/__tests__/*.test.ts with esbuild
 * (already a transitive dependency via vite) into a temp dir, then runs them
 * with Node's built-in test runner (node:test).
 *
 *   npm run test:circuit
 *
 * Why not vitest? Nothing against it — adopt it whenever it lands in the repo;
 * these test files are plain node:test + assert and will port in minutes.
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const testDir = resolve(__dirname, '..', 'src', 'renderer', 'src', 'circuit', '__tests__')
const files = readdirSync(testDir).filter((f) => f.endsWith('.test.ts'))
if (files.length === 0) {
  console.error('No test files found in', testDir)
  process.exit(1)
}

const out = mkdtempSync(join(tmpdir(), 'circuit-tests-'))
try {
  await build({
    entryPoints: files.map((f) => join(testDir, f)),
    outdir: out,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    sourcemap: 'inline',
    external: ['node:*'],
    outExtension: { '.js': '.mjs' },
    logLevel: 'error'
  })
  const compiled = readdirSync(out)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => join(out, f))
  const res = spawnSync(process.execPath, ['--test', ...compiled], { stdio: 'inherit' })
  process.exit(res.status ?? 1)
} finally {
  rmSync(out, { recursive: true, force: true })
}
