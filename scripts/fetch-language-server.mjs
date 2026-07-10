// scripts/fetch-language-server.mjs
//
// Downloads the Arduino Language Server + clangd binaries for each platform
// tinyStudio ships and drops them under vendor/language-server/<platform>/.
// These power the editor's code intelligence (completion, hover, live
// diagnostics) via tinyService's /lsp WebSocket bridge. Entirely optional:
// when the binaries are missing the app runs exactly as before, minus LSP.
//
// Uses the same artifact hosting the Arduino IDE uses:
//   https://downloads.arduino.cc/arduino-language-server/nightly/arduino-language-server_<SUFFIX>
//   https://downloads.arduino.cc/tools/clangd_<VERSION>_<SUFFIX>.tar.bz2
//
// Idempotent: skips any platform whose binaries already exist.
//
//   node scripts/fetch-language-server.mjs               # all platforms
//   node scripts/fetch-language-server.mjs current       # just this machine

import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// clangd version published on downloads.arduino.cc/tools (same one the
// Arduino IDE 2.x bundles). Bump deliberately.
const CLANGD_VERSION = '14.0.0'
const LS_BASE = 'https://downloads.arduino.cc/arduino-language-server'
const TOOLS_BASE = 'https://downloads.arduino.cc/tools'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const vendorRoot = join(repoRoot, 'vendor', 'language-server')

function tarExe() {
  if (process.platform === 'win32') {
    const sys = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    if (existsSync(sys)) return sys
  }
  return 'tar'
}

// platform dir -> download suffixes + binary names.
const TARGETS = {
  'windows-x64': { suffix: 'Windows_64bit', archive: 'zip', exe: '.exe' },
  'macos-x64': { suffix: 'macOS_64bit', archive: 'tar.gz', exe: '' },
  'macos-arm64': { suffix: 'macOS_ARM64', archive: 'tar.gz', exe: '' },
  'linux-x64': { suffix: 'Linux_64bit', archive: 'tar.gz', exe: '' },
  'linux-arm64': { suffix: 'Linux_ARM64', archive: 'tar.gz', exe: '' }
}

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`)
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

/** Recursively find a file by name in a directory tree. */
function findFile(root, name) {
  for (const entry of readdirSync(root)) {
    const p = join(root, entry)
    if (statSync(p).isDirectory()) {
      const found = findFile(p, name)
      if (found) return found
    } else if (entry === name) {
      return p
    }
  }
  return null
}

async function fetchOne(platform) {
  const target = TARGETS[platform]
  if (!target) {
    throw new Error(`Unknown platform "${platform}". Valid: ${Object.keys(TARGETS).join(', ')}`)
  }

  const outDir = join(vendorRoot, platform)
  const lsBin = `arduino-language-server${target.exe}`
  const clangdBin = `clangd${target.exe}`
  const outLs = join(outDir, lsBin)
  const outClangd = join(outDir, clangdBin)
  if (existsSync(outLs) && existsSync(outClangd)) {
    console.log(`✓ ${platform}: already present`)
    return
  }
  mkdirSync(outDir, { recursive: true })

  const tmp = mkdtempSync(join(tmpdir(), 'arduino-ls-'))
  try {
    // ── arduino-language-server (nightly channel, like fresh IDE builds) ──
    if (!existsSync(outLs)) {
      const asset = `arduino-language-server_${target.suffix}.${target.archive}`
      console.log(`↓ ${platform}: downloading ${asset} ...`)
      await download(`${LS_BASE}/nightly/${asset}`, join(tmp, asset))
      execFileSync(tarExe(), ['-xf', asset], { cwd: tmp, stdio: 'inherit' })
      const extracted = findFile(tmp, lsBin)
      if (!extracted) throw new Error(`${lsBin} not found inside ${asset}`)
      copyFileSync(extracted, outLs)
      if (!platform.startsWith('windows')) chmodSafe(outLs)
      console.log(`✓ ${platform}: ${outLs}`)
    }

    // ── clangd (bzip2 tarball; bsdtar reads .tar.bz2 natively) ──
    if (!existsSync(outClangd)) {
      const asset = `clangd_${CLANGD_VERSION}_${target.suffix}.tar.bz2`
      console.log(`↓ ${platform}: downloading ${asset} ...`)
      await download(`${TOOLS_BASE}/${asset}`, join(tmp, asset))
      execFileSync(tarExe(), ['-xf', asset], { cwd: tmp, stdio: 'inherit' })
      const extracted = findFile(tmp, clangdBin)
      if (!extracted) throw new Error(`${clangdBin} not found inside ${asset}`)
      copyFileSync(extracted, outClangd)
      if (!platform.startsWith('windows')) chmodSafe(outClangd)
      console.log(`✓ ${platform}: ${outClangd}`)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function chmodSafe(p) {
  try {
    chmodSync(p, 0o755)
  } catch {
    /* best effort on non-posix hosts */
  }
}

function hostPlatform() {
  const arm = process.arch === 'arm64'
  if (process.platform === 'win32') return 'windows-x64'
  if (process.platform === 'darwin') return arm ? 'macos-arm64' : 'macos-x64'
  if (process.platform === 'linux') return arm ? 'linux-arm64' : 'linux-x64'
  throw new Error(`Unsupported host platform: ${process.platform}/${process.arch}`)
}

async function main() {
  const requested = process.argv
    .slice(2)
    .map((a) => (a === 'current' || a === '--current' ? hostPlatform() : a))
  const platforms = requested.length ? requested : Object.keys(TARGETS)
  console.log(`Fetching arduino-language-server (nightly) + clangd ${CLANGD_VERSION} for: ${platforms.join(', ')}`)
  for (const p of platforms) {
    await fetchOne(p)
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error('\nfetch-language-server failed:', err.message)
  process.exit(1)
})
