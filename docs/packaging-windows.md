# Packaging tinyStudio as a Self-Contained Windows Installer

This guide explains how to build tinyStudio into a single installable `.exe`
that runs on any Windows 10/11 (x64) machine **with no developer tooling
installed** — no Node, no Electron, no Arduino IDE. The end user double-clicks an
installer, gets a Start-menu/desktop shortcut, and the app just works.

It is written specifically for this repo's actual setup (electron-vite +
electron-builder + the bundled `@mister-industries/tinyservice` WebSocket
service that wraps `arduino-cli`). Read the **Gotchas** section before your first
build — there are two things in this repo that will silently break a naive
`npm run build:win`.

---

## 1. How the app is structured (what has to ship)

tinyStudio is an Electron app with three moving parts that must all be inside the
installer for the packaged app to be fully functional:

| Part | What it is | Where it lives | How it's bundled |
|------|-----------|----------------|------------------|
| **Renderer** | React UI (Monaco, Blockly, p5 visual, circuit editor) | `src/renderer` → built to `out/renderer` | Inside `app.asar` |
| **Main process** | Electron entry; spawns the service, owns windows | `src/main` → built to `out/main` | Inside `app.asar` |
| **TinyService** | Local Node WebSocket server that shells out to `arduino-cli` for compile/upload | `@mister-industries/tinyservice` (symlinked from `../tinyService`) | Inside `app.asar` (see Gotcha A) |
| **arduino-cli** | The official Arduino command-line compiler/uploader binary | Downloaded per-platform, placed under `node_modules/.../binaries` | `extraResources` → `resources/arduino-cli/win32-x64/arduino-cli.exe` |
| **Board cores** | ESP32 / tinyCore / AVR toolchains | **Not bundled** — fetched on first compile | See section 5 |

Key runtime facts that shaped this guide:

- **Serial I/O uses the Web Serial API** (`navigator.serial`) in the renderer —
  there is **no native `serialport` module**, so there is nothing to recompile
  with `node-gyp`. This is why `electron-builder.yml` sets `npmRebuild: false`.
  Keep it that way; it makes the build portable and fast.
- **The main process is CommonJS** but TinyService is ESM, so it's loaded via a
  dynamic `import()` at runtime ([ServiceManager.ts](../src/main/ServiceManager.ts)).
  This works in the packaged app as long as the package's files actually make it
  into the asar (Gotcha A).
- **`arduino-cli` is spawned as a child process**
  ([arduino-cli.service.js](../node_modules/@mister-industries/tinyservice/dist/services/arduino-cli.service.js))
  using the path that `ServiceManager.resolveArduinoCliPath()` computes. In a
  packaged build that path is
  `process.resourcesPath/arduino-cli/win32-x64/arduino-cli.exe`, so the binary
  **must** be present there and **must** be outside the asar (it is an
  executable — it can't run from inside an archive). `extraResources` handles
  that for us.

---

## 2. Prerequisites (on the build machine only)

These are needed to *produce* the installer. The *end user* needs none of them.

- **Node.js 18+ and npm** (use the version the team builds with).
- **The sibling `tinyService` repo** checked out next to this one, because
  `package.json` references it as `file:../tinyService/packages/...`. Layout:
  ```
  GitHub/
    tinyStudio/      ← this repo
    tinyService/     ← required sibling
  ```
- **A `.npmrc`** if you reinstall from the GitHub Package Registry instead of the
  local symlink (see [INTEGRATION_GUIDE.md](../INTEGRATION_GUIDE.md)). With the
  current `file:` dependency you don't need it.
- Building a Windows installer is **easiest on Windows**. electron-builder can
  cross-build for Windows from macOS/Linux but needs Wine for the NSIS step;
  building on Windows avoids that entirely. This guide assumes you build on
  Windows.

Install dependencies:

```powershell
npm install
```

---

## 3. Get the `arduino-cli` binary into place (now automated)

The packaged app ships `arduino-cli` as an `extraResource`. Without it the app
starts but fails its health check with *"Arduino CLI is not available."*

This is now handled by [scripts/fetch-arduino-cli.mjs](../scripts/fetch-arduino-cli.mjs),
which downloads the pinned arduino-cli release (currently **v1.5.1**) for every
platform and drops the binaries under `vendor/arduino-cli/<platform>/`.
`electron-builder.yml` copies them from there into the app's resources. The
`vendor/` folder is git-ignored — binaries are fetched, not committed.

It runs **automatically** before every build via the `prebuild` npm hook, and is
idempotent (skips platforms already present). You can also run it directly:

```powershell
npm run fetch:arduino-cli            # all platforms
node scripts/fetch-arduino-cli.mjs windows-x64   # just one
```

Verify it landed:

```powershell
& "vendor/arduino-cli/windows-x64/arduino-cli.exe" version
```

> **Note on extraction.** The script uses the OS-bundled `tar` (bsdtar on
> Windows 10+/macOS) to unpack both `.zip` and `.tar.gz`. On Windows it calls
> `System32\tar.exe` explicitly so it doesn't pick up Git Bash's GNU tar (which
> can't read `.zip`). Bump the pinned version by editing `VERSION` at the top of
> the script.

---

## 4. Build the installer

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"   # skip code signing (see Gotcha F)
npm run build:win
```

The produced installer is **unsigned** unless you set up a certificate
(section 7). Setting `CSC_IDENTITY_AUTO_DISCOVERY=false` keeps the build from
trying to auto-discover a signing identity.

What this does (`package.json` → `build:win`):

1. `npm run typecheck` — fails the build on TS errors in main + renderer.
2. `electron-vite build` — bundles main, preload, and renderer into `out/`.
3. `electron-builder --win` — packs `out/` + `node_modules` into `app.asar`,
   copies `arduino-cli.exe` into `resources/arduino-cli/win32-x64/` (from
   `extraResources`), bundles the matching Electron runtime, and produces an
   **NSIS installer**.

### Output

The installer is written to `dist/`:

```
dist/tinystudio-0.1.0-setup.exe        ← give this to users
dist/win-unpacked/                      ← the raw app folder (for debugging)
```

`tinystudio-0.1.0-setup.exe` is the self-contained artifact. It bundles the
Chromium + Node runtime, your app, TinyService, and `arduino-cli.exe`. The user
needs nothing else installed.

### Installer behavior (from `electron-builder.yml`)

- NSIS installer named `tinystudio-<version>-setup.exe`.
- Always creates a desktop shortcut (`createDesktopShortcut: always`).
- Start-menu shortcut named **tinyStudio**.
- Executable inside install dir: `tinystudio.exe`.

### Quick sanity check before building (optional but recommended)

```powershell
npm run build:unpack   # builds to dist/win-unpacked without making an installer
```

Run `dist/win-unpacked/tinystudio.exe` and confirm a project compiles. This is
much faster to iterate on than producing the full NSIS installer each time.

---

## 5. Board cores: the one thing that needs the internet (first run only)

The bundled `arduino-cli.exe` is the *compiler front-end*, but the actual
toolchains (ESP32, tinyCore, AVR/Uno) are **not** in the installer. TinyService
installs them on demand the first time the user compiles for a board, via
`arduino-cli core install`
([arduino-cli.service.js](../node_modules/@mister-industries/tinyservice/dist/services/arduino-cli.service.js)):

- Adds the tinyCore board-manager URL,
- runs `core update-index`,
- installs `esp32:esp32` and `tinyCore:esp32`.

These download to the user's default arduino-cli data dir
(`%LOCALAPPDATA%\Arduino15`). Implications:

- **The first compile for a given board family requires an internet connection**
  and can take a few minutes (the ESP32 toolchain is hundreds of MB). Subsequent
  compiles are offline and fast.
- This is expected behavior, not a packaging bug. Communicate it to users, or
  see the offline option below.

### Optional: fully offline / zero-first-run-download install

If you need the app to work on an air-gapped machine, pre-seed the cores and
ship them:

1. On a build machine, install the cores once with the **bundled** CLI so the
   versions match:
   ```powershell
   $cli = "node_modules/@mister-industries/tinyservice/binaries/windows-x64/arduino-cli.exe"
   & $cli config add board_manager.additional_urls https://raw.githubusercontent.com/Mister-Industries/arduino-board-index/refs/heads/main/package_tiny_core_index.json
   & $cli core update-index
   & $cli core install esp32:esp32
   & $cli core install tinyCore:esp32
   & $cli core install arduino:avr
   ```
2. Add the resulting data directory to the installer as an extra resource (in
   `electron-builder.yml`):
   ```yaml
   extraResources:
     - from: prebuilt/Arduino15      # the populated %LOCALAPPDATA%\Arduino15
       to: arduino-data
   ```
3. Point arduino-cli at it by passing `--config-dir`/`--data-dir` (or the
   `ARDUINO_DIRECTORIES_DATA` env var) when spawning. This requires a small
   change in the service/`ServiceManager` to set that env var to
   `process.resourcesPath/arduino-data` in packaged builds. Without that change,
   arduino-cli falls back to `%LOCALAPPDATA%\Arduino15` and the online flow above
   applies.

> For most distributions, the default online-first-run flow is fine and keeps the
> installer ~150 MB instead of ~1 GB. Only do the offline bundle if you have a
> hard offline requirement.

---

## 6. Gotchas specific to this repo

**A. The `file:` symlinked dependencies must end up in the asar.**
`@mister-industries/tinyservice` and `@mister-industries/shared` are symlinks to
`../tinyService`. electron-builder follows them and copies the real files into
`app.asar`, but only the files the package actually declares/ships. Confirm
`tinyService/packages/service` is **built** (its `dist/` exists) before packaging
— the app imports `dist/...`, not `src/...`. If you see *"Cannot find module
@mister-industries/tinyservice"* in the packaged app, the package's `dist` wasn't
present at pack time. Run its build first:
```powershell
pushd ../tinyService/packages/service; npm install; npm run build; popd
```

**B. `arduino-cli.exe` must exist at the `extraResources` source path** before
building — see section 3. electron-builder will happily build an installer
*without* it and the failure only shows up at runtime as a failed health check.

**C. Don't enable `npmRebuild`.** There are no native modules (serial is Web
Serial). Turning on rebuild only invites `node-gyp`/toolchain failures.

**D. The auto-updater URL is a placeholder.** `electron-builder.yml` has
`publish.url: https://example.com/auto-updates` and `electron-updater` is a
dependency. Auto-update will not work until you point it at a real release feed
(e.g. GitHub Releases or an S3 bucket). For a manual-distribution installer you
can ignore this — just hand users the `-setup.exe`. If you don't want update
checks at all, leave it as-is; it fails silently.

**E. Port 3000 must be free.** TinyService binds `localhost:3000`. If something
else on the user's machine uses it, the service won't start. Consider making the
port configurable (the code already reads a `PORT` concept) if this becomes a
support issue.

**F. The `winCodeSign` symlink-extraction error on Windows.** electron-builder
downloads a `winCodeSign` toolchain that contains macOS symlinks. Extracting it
needs the *create-symlink* privilege, which Windows withholds from non-admin
processes outside Developer Mode — you'll see:
`ERROR: Cannot create symbolic link : A required privilege is not held by the client`.
This stops the build right before the installer is produced. Pick one fix:

1. **Enable Windows Developer Mode** (Settings → Privacy & security → For
   developers). One-time, lets unprivileged processes create symlinks. Cleanest
   permanent fix. *(Requires admin to toggle.)*
2. **Run the build terminal as Administrator.**
3. **No-admin workaround** (what this repo used to bootstrap the first build):
   make 7-Zip extract symlink entries as plain files instead of links by adding
   the `-snl-` switch. A prebuilt wrapper source lives in
   [scripts/sza-wrap/wrap.cs](../scripts/sza-wrap/wrap.cs); compile it with the
   bundled .NET `csc.exe`, rename `node_modules/7zip-bin/win/x64/7za.exe` to
   `7za-real.exe`, and drop the wrapper in as `7za.exe`. The macOS symlinks it
   skips are irrelevant on Windows. Once any build succeeds, electron-builder
   caches the extracted toolchain in `%LOCALAPPDATA%\electron-builder\Cache`, so
   subsequent builds on the same machine don't re-extract and the workaround is
   no longer needed.

**G. The service's runtime deps must be in tinyStudio's `dependencies`.**
`@mister-industries/tinyservice` is loaded externally at runtime (electron-vite
externalizes it), so its deps (`express`, `ws`, `uuid`) have to resolve inside
the asar. They live in the *sibling* repo's `node_modules`, which electron-builder
does **not** pull in. They are therefore declared directly in tinyStudio's
[package.json](../package.json) so npm installs them locally and electron-builder
bundles them. If you ever see *"Cannot find module 'express'"* from the packaged
app, a service dep is missing from tinyStudio's `dependencies`.

---

## 7. Code signing (recommended for real distribution)

Unsigned installers trigger SmartScreen ("Windows protected your PC") and AV
friction. For a polished install on *any* machine:

1. Obtain an **EV or OV code-signing certificate** (`.pfx`).
2. Provide it to electron-builder via env vars before `npm run build:win`:
   ```powershell
   $env:CSC_LINK = "C:\path\to\cert.pfx"
   $env:CSC_KEY_PASSWORD = "********"
   npm run build:win
   ```
   electron-builder signs both the app `.exe` and the NSIS installer.

This is optional — the app installs and runs unsigned — but without it users see
a SmartScreen warning on first launch.

---

## 8. End-to-end checklist

```
[ ] tinyService sibling repo present and built (npm run build there → dist/ exists)
[ ] npm install completed in tinyStudio (pulls in express/ws/uuid — Gotcha G)
[ ] arduino-cli fetched (automatic via prebuild; or npm run fetch:arduino-cli)
[ ] Developer Mode on OR 7za wrapper in place (Gotcha F)
[ ] $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"  (unless signing — section 7)
[ ] npm run build:win
[ ] dist/tinystudio-0.1.0-setup.exe produced (~250 MB)
[ ] Smoke test: launch dist/win-unpacked/tinystudio.exe, then
    Invoke-RestMethod http://localhost:3000/health → arduinoCli.available = true
[ ] Installed on a clean Windows VM (no Node/Arduino) → app launches
[ ] Connected a board, compiled a sketch (first compile downloads the core)
[ ] Upload succeeds, Serial Monitor shows output
```

If all boxes pass, `dist/tinystudio-<version>-setup.exe` is your distributable.

---

## 9. Quick reference

| Goal | Command |
|------|---------|
| Dev run | `npm run dev` |
| Type-check only | `npm run typecheck` |
| Unpacked build (debug) | `npm run build:unpack` |
| Windows installer | `npm run build:win` |
| macOS build | `npm run build:mac` |
| Linux build | `npm run build:linux` |

Relevant files: [electron-builder.yml](../electron-builder.yml),
[ServiceManager.ts](../src/main/ServiceManager.ts),
[INTEGRATION_GUIDE.md](../INTEGRATION_GUIDE.md).
