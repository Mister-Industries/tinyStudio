<div align="center">

<img src="resources/icon.png" alt="tinyStudio" width="120" />

# tinyStudio

**Code, wire, simulate, and flash tiny hardware projects — all in one place.**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Built with Electron](https://img.shields.io/badge/Electron-2f3242?logo=electron&logoColor=9feaf9)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-20232a?logo=react&logoColor=61dafb)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

---

tinyStudio is an open-source IDE for makers. It brings the **code**, the **circuit**, and a
live **visual** together in a single window, so you can write an Arduino sketch, draw the
wiring next to it, watch a p5.js simulation react to your serial output, and upload to a real
board — without leaving the app. It runs as a cross-platform desktop app (Electron) and in the
browser.

It's built around the **tiny\*** hardware family from
[MR.INDUSTRIES](https://github.com/Mister-Industries) — starting with the **tinyCore**
(ESP32‑S3) — but it speaks plain Arduino, so most sketches and boards (e.g. an Arduino Uno)
work too.

## Highlights

- **Three views, one project** — switch between **Code / Circuit / Visual** for the same folder:
  - **Code** — a Monaco-based editor for `.ino` sketches with Arduino-aware tooling.
  - **Circuit** — a drag-and-drop circuit designer that reads and writes a
    [Wokwi-compatible](https://docs.wokwi.com/diagram-format) `diagram.json`.
  - **Visual** — a `visual.js` [p5.js](https://p5js.org/) sketch that runs live and reacts to
    your serial output. Export it to a standalone web page with one click.
- **Build & flash for real** — compile and upload over a bundled
  [`arduino-cli`](https://arduino.github.io/arduino-cli/) via the tinyService backend, with a
  built-in **Serial Monitor**.
- **A growing parts library** — built-in tiny\* boards plus a catalogue imported from
  [Fritzing](https://fritzing.org/) parts, each with breadboard and schematic views. Easy to
  extend — see [Extending the library](#extending-the-library).
- **Board & Library managers** — install board packages and Arduino libraries from the UI.
- **Optional AI assistant** — bring your own Anthropic API key for an in-app agent.
- **Desktop + web** — the same renderer runs in Electron and as a static web build.

## The tiny\* family

| Board         | Description                       |
| ------------- | --------------------------------- |
| `tinyCore`    | The main ESP32‑S3 microcontroller |
| `tinyGlow`    | Addressable RGB LED module        |
| `tinyProto`   | Prototyping / breakout board      |
| `tinyDisplay` | I²C display module                |
| `tinySniff`   | I²C sensor module                 |

These ship as built-in parts in the Circuit view (see
[`partsLibrary.ts`](src/renderer/src/lib/partsLibrary.ts)).

## Getting started

### Prerequisites

- **Node.js** 18+ and npm.

That's it. `npm install` pulls the backend packages (**`@mister-industries/tinyservice`** and
**`@mister-industries/shared`**) from public npm — no token or registry config needed — and
`arduino-cli` is fetched automatically the first time you run `npm run dev` (or `npm run build`)
by [`scripts/fetch-arduino-cli.mjs`](scripts/fetch-arduino-cli.mjs). See
[INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) for what tinyService does and how it's wired in.

### Install

```bash
npm install
```

### Develop

```bash
npm run dev       # Electron desktop app — starts the tinyService backend for you
npm run dev:web   # browser-only renderer at http://localhost:5173
```

> **How the backend works:** all compile/upload/serial goes through **tinyService**, a small
> local WebSocket server (on `ws://localhost:3000`) that wraps `arduino-cli`. On the **desktop**
> app it starts automatically. For the **browser** build, run tinyService yourself
> (`npx @mister-industries/tinyservice`, or a standalone binary) and the page connects to it —
> so you can host the web build on GitHub Pages/Netlify and users just run the backend locally.
> Point the UI at a non-default backend by setting `localStorage["tinyservice.url"]`.

### Build

```bash
npm run build:win     # Windows installer
npm run build:mac     # macOS app
npm run build:linux   # Linux package
npm run build:web     # static web bundle (dist-web/)
```

Windows packaging notes live in [docs/packaging-windows.md](docs/packaging-windows.md).

## Example projects

The [`demo/`](demo) folder holds ready-to-open projects. Open one with **Files → Open Folder**,
then pick your board and port and hit **Verify** / **Upload**.

| Project                                | What it shows                                            |
| -------------------------------------- | -------------------------------------------------------- |
| [Blink Example](demo/Blink%20Example)  | Blink an LED and mirror its state in the Visual view     |
| [Fade Example](demo/Fade%20Example)    | PWM-fade an LED and chart the brightness curve live      |
| [Joystick Example](demo/Joystick%20Example) | Read a Qwiic joystick and visualize the stick position |

Each project is a folder with the same shape:

```
My Example/
  my_sketch/
    my_sketch.ino   ← the Arduino sketch (its own folder, per Arduino convention)
  diagram.json      ← the circuit (Circuit view)
  visual.js         ← the p5 sketch (Visual view)
  README.md         ← how to run it
```

## Extending the library

Adding your own **example projects** and **custom parts** is a first-class workflow. The full
walkthrough — the part JSON schema, pin coordinates, breadboard vs. schematic views, importing
from Fritzing, and authoring a new example — is in:

📖 **[docs/extending-the-library.md](docs/extending-the-library.md)**

In short:

- **A custom part** is a JSON file in
  [`src/renderer/src/assets/parts/`](src/renderer/src/assets/parts) plus one entry in
  [`index.json`](src/renderer/src/assets/parts/index.json). You can hand-author it or generate
  it from a Fritzing part with
  [`scripts/fritzing-import.mjs`](scripts/fritzing-import.mjs).
- **An example project** is just a new folder under [`demo/`](demo) following the layout above.

## Architecture

```
src/
  main/       Electron main process — app lifecycle, tinyService manager,
              settings, the optional AI agent
  preload/    typed IPC bridge between main and renderer
  renderer/   the React UI (Code / Circuit / Visual), Redux store,
              parts library, services, and the p5 visual runtime
scripts/      arduino-cli fetcher + Fritzing parts importer
demo/         bundled example projects
docs/         contributor & packaging docs
```

The Electron main process starts **tinyService**, a WebSocket wrapper around `arduino-cli`, on
launch; the renderer talks to it to compile, upload, and stream serial. See
[INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) for details.

## Contributions

tinyStudio is in **early alpha** and is **not accepting external contributions** at this time.
Pull requests are closed automatically and issues may be closed without review. This will open up
as the project stabilizes — until then, feel free to **fork** and experiment.

## License

tinyStudio is licensed under the **GNU General Public License v3.0 (or later)**. See
[LICENSE](LICENSE).
