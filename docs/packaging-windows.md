# Packaging tinyStudio for Windows

How to build the Windows installer: a single `tinystudio-<version>-setup.exe` that
runs on Windows 10 and 11 (x64) with nothing else installed. No Node, no Arduino
IDE.

## 1. What goes in the installer

| Part                       | What it is                                                               | Where it ends up                                          |
| -------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| Renderer and main process  | The React app and the Electron entry, built by electron-vite into `out/` | `resources/app/out/`                                      |
| Production dependencies    | Including `@mister-industries/tinyservice` and its runtime deps          | `resources/app/node_modules/`                             |
| arduino-cli                | The compiler and uploader, fetched into `vendor/`                        | `resources/arduino-cli/win32-x64/arduino-cli.exe`         |
| Language server (optional) | `arduino-language-server` and `clangd`                                   | `resources/language-server/windows-x64/`                  |
| Board toolchains           | ESP32, tinyCore, AVR                                                     | **Not bundled.** Downloaded on first compile (section 5). |

Things that shape the build:

- **`asar` is off.** tinyService runs as a child Node process that imports the ESM
  package from `node_modules`, and Node's ESM loader can't read inside an asar
  archive. See [INTEGRATION_GUIDE.md](../INTEGRATION_GUIDE.md).
- **Only the built app ships.** `files` in
  [electron-builder.yml](../electron-builder.yml) lists `out/**/*` and
  `package.json`; electron-builder adds production dependencies itself. Sources,
  docs and scripts stay out. Check with `npm run build:unpack`:
  `dist/win-unpacked/resources/app/` should hold only `node_modules`, `out` and
  `package.json`.
- **No native Node modules.** Serial goes through tinyService, so nothing needs
  `node-gyp`. `npmRebuild: false` keeps it that way.
- **The app identity is `cc.tinystudio.app`.** Windows uses it to group taskbar
  icons and notifications. Changing it after release makes Windows treat the app
  as a different program.

## 2. Prerequisites

On the build machine only:

- **Node.js 22** and npm.
- **Windows.** electron-builder can cross-build from macOS or Linux, but the NSIS
  step then needs Wine.
- Nothing for GitHub sign-in: the tinyStudio OAuth app's client id is built in.
  Set `VITE_GITHUB_CLIENT_ID` only to build against another app. See
  [github-auth.md](github-auth.md).

```powershell
npm install
```

## 3. arduino-cli and the language server

[scripts/fetch-arduino-cli.mjs](../scripts/fetch-arduino-cli.mjs) downloads the
pinned arduino-cli release (the `VERSION` constant at the top of the script) for
every platform into `vendor/arduino-cli/<platform>/`. It runs automatically before
every build through the `prebuild` hook and skips platforms already present.
`vendor/` is git-ignored.

```powershell
npm run fetch:arduino-cli                        # all platforms
node scripts/fetch-arduino-cli.mjs windows-x64   # one platform
& "vendor/arduino-cli/windows-x64/arduino-cli.exe" version
```

The script unpacks with Windows' own `System32\tar.exe`, because Git Bash's GNU
tar can't read `.zip`.

The language server isn't fetched automatically. For editor completion and
diagnostics in the installer, run this first:

```powershell
npm run fetch:language-server
```

Without it, the installer builds and the editor works without code intelligence.

## 4. Build

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"   # unsigned build; see section 7
npm run build:win
```

`build:win` runs, in order:

1. `prebuild`: fetch arduino-cli if it's missing.
2. `npm run typecheck`: stop on any TypeScript error.
3. `electron-vite build`: main, preload and renderer into `out/`.
4. `electron-builder --win`: the app folder, `extraResources` and the Electron
   runtime, packed into an NSIS installer.

Output in `dist/`:

```
dist/tinystudio-<version>-setup.exe   ← the installer
dist/win-unpacked/                    ← the app folder, for testing
```

The installer creates a desktop shortcut and a Start menu entry named
**tinyStudio**; the executable is `tinystudio.exe`.

For faster iteration, `npm run build:unpack` builds `dist/win-unpacked/` without
the installer step.

## 5. Board toolchains need the internet once

The installer has arduino-cli but not the toolchains it drives. tinyService
installs them the first time someone compiles for a board family: it adds the
tinyCore board index, updates the index and installs the cores into
`%LOCALAPPDATA%\Arduino15`. That first compile needs a connection and can take a
few minutes (the ESP32 toolchain is hundreds of megabytes). Later compiles work
offline.

### Offline installs

To ship the toolchains too:

1. Install the cores once with the bundled arduino-cli, so versions match:
   ```powershell
   $cli = "vendor/arduino-cli/windows-x64/arduino-cli.exe"
   & $cli config add board_manager.additional_urls https://raw.githubusercontent.com/Mister-Industries/arduino-board-index/refs/heads/main/package_tiny_core_index.json
   & $cli core update-index
   & $cli core install esp32:esp32
   & $cli core install tinyCore:esp32
   & $cli core install arduino:avr
   ```
2. Add the populated data folder to `extraResources` in `electron-builder.yml`.
3. Point arduino-cli at it with `ARDUINO_DIRECTORIES_DATA`. This needs a change in
   `ServiceManager` to set that variable for the child process in packaged builds,
   which doesn't exist yet.

This grows the installer from about 150 MB to about 1 GB, so only do it for a real
offline requirement.

## 6. Gotchas

**arduino-cli missing at build time.** electron-builder builds an installer without
it, and the failure only shows at run time as "Arduino CLI is not available". The
`prebuild` hook normally prevents this; check `vendor/` if a build ran with
`--ignore-scripts`.

**Missing tinyService dependency.** If the packaged app logs
`Cannot find module` from `[tinyService]`, a runtime dependency of tinyService
isn't in tinyStudio's `dependencies`. `express`, `ws` and `uuid` are declared
there for this reason.

**`Cannot create symbolic link` during the build.** electron-builder unpacks a
`winCodeSign` archive containing macOS symlinks, and Windows only lets
administrators create symlinks outside Developer Mode. Turn on Developer Mode
(Settings → System → For developers) or run the build as Administrator once;
electron-builder caches the unpacked archive in
`%LOCALAPPDATA%\electron-builder\Cache`, so later builds don't need it.

**Port 3000 in use.** Not a problem: tinyService takes the first free port from
3000 to 3009.

## 7. Code signing

Unsigned installers trigger SmartScreen ("Windows protected your PC"). To sign,
get an OV or EV code-signing certificate and give it to electron-builder:

```powershell
$env:CSC_LINK = "C:\path\to\cert.pfx"
$env:CSC_KEY_PASSWORD = "********"
npm run build:win
```

electron-builder signs both `tinystudio.exe` and the installer.

## 8. Release checklist

```
[ ] npm install
[ ] npm run fetch:language-server (if shipping code intelligence)
[ ] Developer Mode on, or an Administrator terminal (first build on the machine)
[ ] Signing set up, or CSC_IDENTITY_AUTO_DISCOVERY=false
[ ] npm run build:win
[ ] dist/win-unpacked/resources/app holds only node_modules, out, package.json
[ ] Launch dist/win-unpacked/tinystudio.exe; the status bar shows the backend connected
[ ] Install on a clean Windows machine (no Node, no Arduino IDE); the app launches
[ ] Compile for a board (the first compile downloads the core), upload, see Serial Monitor output
[ ] Sign in to GitHub
```

## Quick reference

| Goal               | Command                |
| ------------------ | ---------------------- |
| Run in development | `npm run dev`          |
| Typecheck          | `npm run typecheck`    |
| App folder only    | `npm run build:unpack` |
| Windows installer  | `npm run build:win`    |
| macOS              | `npm run build:mac`    |
| Linux              | `npm run build:linux`  |
