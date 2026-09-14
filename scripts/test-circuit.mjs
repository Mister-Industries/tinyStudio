#!/usr/bin/env node
/**
 * test-circuit.mjs — zero-extra-dependency test runner for the Circuit v2 core.
 *
 * Bundles every src/**\/__tests__/*.test.ts with esbuild (already a
 * transitive dependency via vite) into a temp dir, then runs them with Node's
 * built-in test runner (node:test).
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
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcRoot = resolve(__dirname, '..', 'src')

// Every `__tests__/*.test.ts` under src — renderer and main alike — so a new
// suite (lib/__tests__, main/__tests__) is picked up by dropping the file in,
// with no change here. Main-process tests must not import `electron`; keep the
// logic under test in plain modules. `outbase` below keeps the directory
// structure in the temp build, so two suites may share a basename.
const files = readdirSync(srcRoot, { recursive: true, withFileTypes: true })
  .filter(
    (e) =>
      e.isFile() && e.name.endsWith('.test.ts') && basename(e.parentPath ?? e.path) === '__tests__'
  )
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

/** Vite's `?inline` suffix: the Studio AI guide screenshots, as base64 data URLs. */
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }
const inlineImports = {
  name: 'inline-imports',
  setup(b) {
    b.onResolve({ filter: /\?inline$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.slice(0, -7)),
      namespace: 'inline'
    }))
    b.onLoad({ filter: /.*/, namespace: 'inline' }, (args) => ({
      contents: `data:${MIME[extname(args.path)]};base64,${readFileSync(args.path).toString('base64')}`,
      loader: 'text'
    }))
  }
}

/**
 * Main-process modules import `electron`. Tests never have one, so the import
 * resolves to a stub whose `app.getPath` answers from environment variables the
 * test sets (TINYSTUDIO_TEST_USERDATA, TINYSTUDIO_TEST_DOCUMENTS) and whose
 * other members are inert.
 */
const electronStub = {
  name: 'electron-stub',
  setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'electron-stub' }))
    b.onLoad({ filter: /.*/, namespace: 'electron-stub' }, () => ({
      contents: `
        export const app = {
          getPath: (name) =>
            name === 'userData'
              ? process.env.TINYSTUDIO_TEST_USERDATA ?? '/tmp/tinystudio-test-userdata'
              : process.env.TINYSTUDIO_TEST_DOCUMENTS ?? '/tmp/tinystudio-test-documents',
          isPackaged: false,
          getAppPath: () => process.cwd()
        }
        export const shell = { openExternal: async () => {}, openPath: async () => '', showItemInFolder: () => {} }
        export const ipcMain = { handle: () => {}, on: () => {} }
        export const dialog = {}
        export class BrowserWindow { static fromWebContents() { return null } }
        export const safeStorage = { isEncryptionAvailable: () => false }
        export const contextBridge = { exposeInMainWorld: () => {} }
        export const ipcRenderer = {}
      `,
      loader: 'js'
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
    // The renderer's `@renderer/*` import alias (tsconfig.web.json paths).
    alias: { '@renderer': join(srcRoot, 'renderer', 'src') },
    outExtension: { '.js': '.mjs' },
    logLevel: 'error',
    plugins: [rawImports, inlineImports, electronStub]
  })
  const compiled = readdirSync(out, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.mjs'))
    .map((e) => join(e.parentPath ?? e.path, e.name))
  const res = spawnSync(process.execPath, ['--test', ...compiled], { stdio: 'inherit' })
  process.exit(res.status ?? 1)
} finally {
  rmSync(out, { recursive: true, force: true })
}
