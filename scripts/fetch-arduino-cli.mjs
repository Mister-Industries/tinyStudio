// scripts/fetch-arduino-cli.mjs
//
// Downloads the official arduino-cli binary for each platform tinyStudio ships
// and drops it under vendor/arduino-cli/<platform>/, which electron-builder then
// copies into the packaged app's resources (see electron-builder.yml). Without
// this the packaged app starts but fails its health check with
// "Arduino CLI is not available", because the compiler front-end isn't present.
//
// Idempotent: skips any platform whose binary already exists. Runs automatically
// before `npm run build` via the "prebuild" hook, and can be run directly:
//
//   node scripts/fetch-arduino-cli.mjs               # all platforms
//   node scripts/fetch-arduino-cli.mjs windows-x64   # just one (or several)
//
// Extraction uses bsdtar, which on Windows 10+/macOS handles both .zip and
// .tar.gz. On Windows we call System32\tar.exe explicitly so we don't
// accidentally pick up Git Bash's GNU tar (which can't read .zip and mis-parses
// drive-letter paths). On Linux, GNU tar can't read .zip, so building the
// Windows artifact there would need `unzip` — but Windows installers are built
// on Windows, where this works out of the box.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, copyFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Pin to a known-good release so builds are reproducible. Bump deliberately.
const VERSION = '1.5.1'
const BASE = `https://downloads.arduino.cc/arduino-cli`

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const vendorRoot = join(repoRoot, 'vendor', 'arduino-cli')

// On Windows, prefer the OS-bundled bsdtar (zip-capable) over whatever `tar` the
// shell PATH resolves to (Git Bash ships GNU tar, which can't read .zip).
function tarExe() {
  if (process.platform === 'win32') {
    const sys = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    if (existsSync(sys)) return sys
  }
  return 'tar'
}

// platform dir (matches electron-builder.yml `from`) -> release asset + binary name.
const TARGETS = {
  'windows-x64': { asset: `arduino-cli_${VERSION}_Windows_64bit.zip`, bin: 'arduino-cli.exe' },
  'macos-x64': { asset: `arduino-cli_${VERSION}_macOS_64bit.tar.gz`, bin: 'arduino-cli' },
  'macos-arm64': { asset: `arduino-cli_${VERSION}_macOS_ARM64.tar.gz`, bin: 'arduino-cli' },
  'linux-x64': { asset: `arduino-cli_${VERSION}_Linux_64bit.tar.gz`, bin: 'arduino-cli' },
  'linux-arm64': { asset: `arduino-cli_${VERSION}_Linux_ARM64.tar.gz`, bin: 'arduino-cli' }
}

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const { writeFileSync } = await import('node:fs')
  writeFileSync(dest, buf)
}

async function fetchOne(platform) {
  const target = TARGETS[platform]
  if (!target) throw new Error(`Unknown platform "${platform}". Valid: ${Object.keys(TARGETS).join(', ')}`)

  const outDir = join(vendorRoot, platform)
  const outBin = join(outDir, target.bin)
  if (existsSync(outBin)) {
    console.log(`✓ ${platform}: already present (${target.bin})`)
    return
  }

  mkdirSync(outDir, { recursive: true })
  const tmp = mkdtempSync(join(tmpdir(), 'arduino-cli-'))
  try {
    const archive = join(tmp, target.asset)
    console.log(`↓ ${platform}: downloading ${target.asset} ...`)
    await download(`${BASE}/${target.asset}`, archive)

    console.log(`  extracting ...`)
    // Run with cwd=tmp and a relative archive name so the path carries no
    // drive-letter colon (which GNU tar would misread as a remote host).
    execFileSync(tarExe(), ['-xf', target.asset], { cwd: tmp, stdio: 'inherit' })

    // The archive holds arduino-cli[.exe] at its root.
    const extracted = readdirSync(tmp).find((f) => f === target.bin)
    if (!extracted) throw new Error(`${target.bin} not found inside ${target.asset}`)

    copyFileSync(join(tmp, extracted), outBin)
    if (!platform.startsWith('windows')) {
      try {
        chmodSync(outBin, 0o755)
      } catch {
        /* best effort on non-posix hosts */
      }
    }
    console.log(`✓ ${platform}: ${outBin}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// Map the host machine to its TARGETS key (for `current`, used by the dev hook).
function hostPlatform() {
  const arm = process.arch === 'arm64'
  if (process.platform === 'win32') return 'windows-x64'
  if (process.platform === 'darwin') return arm ? 'macos-arm64' : 'macos-x64'
  if (process.platform === 'linux') return arm ? 'linux-arm64' : 'linux-x64'
  throw new Error(`Unsupported host platform: ${process.platform}/${process.arch}`)
}

async function main() {
  // `current` (or `--current`) resolves to just this machine's platform — handy
  // for development, where you only need to run the app locally. With no args we
  // fetch every platform (what packaging needs; see electron-builder.yml).
  const requested = process.argv
    .slice(2)
    .map((a) => (a === 'current' || a === '--current' ? hostPlatform() : a))
  const platforms = requested.length ? requested : Object.keys(TARGETS)
  console.log(`Fetching arduino-cli v${VERSION} for: ${platforms.join(', ')}`)
  for (const p of platforms) {
    await fetchOne(p)
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error('\nfetch-arduino-cli failed:', err.message)
  process.exit(1)
})
