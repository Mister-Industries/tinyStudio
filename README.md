<div align="center">

<img src="resources/icon.png" alt="tinyStudio"/>

**Write and flash embedded code, design circuits, and deploy apps all in one place**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Built with Electron](https://img.shields.io/badge/Electron-2f3242?logo=electron&logoColor=9feaf9)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-20232a?logo=react&logoColor=61dafb)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

---

> ### ⚠️ WARNING - This is a ROUGH Alpha. Please read this first
>
> Because ya'll are impatient, I have decided to release tinyStudio in **Alpha** (Although that's giving it a lot.). Right now it's a ***demonstration of the concept***, not a
> finished product. It's buggy, incomplete, and quite rough around the edges. 
> Almost everything you see here is **subject to change**. Some of it will probably (definitely) be ripped out and redone.
>
>You may notice there's a fair amount of agentic code in this repo. 
>
> Treat it as a preview, not a tool you'd rely on yet. If you want to follow along or experiment,
> hell yeah Batman. Just go in expecting stuff to break. See [Known bugs](#known-bugs) and
> [Roadmap](#roadmap) for where things stand.

tinyStudio is an open-source IDE for makers. The idea was to be able to write an Arduino sketch, upload the code, see the wiring next to it, and watch a p5.js simulation react to your serial output, without jumping between apps. It can run as a local desktop app (Electron) and in the browser.

It's built around the family of tinyBoards from
[MR.INDUSTRIES](https://github.com/Mister-Industries), starting with the **tinyCore** (a development board based on ESP32‑S3).
It also speaks plain Arduino, so most sketches and boards (an Arduino Uno, ESP32, etc) work too.

## What it does today

Keep the alpha warning above in mind, all of these things work, but they're... early.

- **Three views, one project.** Switch between Code / Circuit / Visual for the same folder:
  - **Code** is a Monaco-based editor for `.ino` sketches with some Arduino-aware tooling.
  - **Circuit** is a drag-and-drop designer that reads and writes a
    [Wokwi-compatible](https://docs.wokwi.com/diagram-format) `diagram.json`.
  - **Visual** is a `visual.js` [p5.js](https://p5js.org/) sketch that runs live off your serial
    output. You can export it to a standalone web page.
- **Build and flash for real.** Compile and upload over a bundled
  [`arduino-cli`](https://arduino.github.io/arduino-cli/) through the tinyService backend, with a
  built-in serial monitor. As Arduino gets tighter with their licensing, we plan to write our own service, but this makes it work for now. Please read the CLI's license to ensure you are okay with the terms.
- **A parts library.** Built-in tinyBoards plus parts imported from
  [Fritzing](https://fritzing.org/), each with breadboard and schematic views. You can add your
  own — see [Extending the library](#extending-the-library).
- **Board and library managers.** Install board packages and Arduino libraries from the UI.
- **Optional AI assistant.** Bring your own Anthropic API key for an in-app agent. Can read/write files with permission.
- **Web and GitHub Pages Project Export.** The same renderer runs in Electron and as a static web build.

## The tinyFamily

| Board         | Description                       |
| ------------- | --------------------------------- |
| `tinyCore`    | The main ESP32‑S3 microcontroller |
| `tinyGlow`    | Addressable RGB LED module        |
| `tinyProto`   | Prototyping / Breakout board      |
| `tinySpeak`   | Microphone and Speaker AI module  |
| `tinySniff`   | MEMS Gas Sensor Array             |

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
> (`npx @mister-industries/tinyservice`, or a standalone binary) and the page connects to it,
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

The [`demo/`](demo) folder holds ready-to-open projects. Clone the repo, and open one the folders in the editor,
then pick your board and port and hit **Verify** / **Upload**.

| Project                                | What it shows                                            |
| -------------------------------------- | -------------------------------------------------------- |
| [Blink Example](demo/Blink%20Example)  | Blink an LED and mirror its state in the Visual view     |
| [Fade Example](demo/Fade%20Example)    | PWM-fade an LED and chart the brightness curve live      |
| [Joystick Example](demo/Joystick%20Example) | Read a Qwiic joystick and visualize the stick position |

Each project is a folder with the same structure:

```
My Example/
  my_sketch/
    my_sketch.ino   ← the Arduino sketch (its own folder, per Arduino convention)
  diagram.json      ← the circuit (Circuit view)
  visual.js         ← the p5 sketch (Visual view)
  README.md         ← how to run it
```

## Extending the library

Creating your own **example projects** and **custom parts** is pretty straightforward. The full
walkthrough has been documented in:

📖 **[docs/extending-the-library.md](docs/extending-the-library.md)**

> Just a heads up though, we are not opening up CONTRIBUTING just yet, since a lot will be SUBJECT TO CHANGE.

TL;DR:

- **A custom part** is a JSON file in
  [`src/renderer/src/assets/parts/`](src/renderer/src/assets/parts) plus one entry in
  [`index.json`](src/renderer/src/assets/parts/index.json). You can hand-author it or generate
  it from a Fritzing part using
  [`scripts/fritzing-import.mjs`](scripts/fritzing-import.mjs).
- **An example project** is just a new folder under [`demo/`](demo) following the layout above.

## Architecture

```
src/
  main/       Electron main process: app lifecycle, tinyService manager,
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

## Known bugs

This is an alpha, so the list is short only because we haven't written everything down yet.
Known issues right now:

- **Chat sessions don't persist between tabbing.** Switch away from the AI assistant and back,
conversation is gone.

## Roadmap

Nothing here is final, and priorities will shift. But this is roughly where we're headed.

**Up next**

- Circuit diagram overhaul and expansion (The wires suck right now, I'm aware)
- Tutorials for using tinyStudio
- Built-in examples (and better examples in general)
- Better Markdown support (in the README viewer and the agent)
- General UI improvements

**Further out**

- CircuitPython support
- KiCad Schematic export

## Contributions

tinyStudio is in **early alpha** and is **not accepting external contributions** at this time.
Pull requests are closed automatically and issues may be closed without review. This will open up
as the project stabilizes, until then, feel free to **fork** and experiment.

## License

tinyStudio is licensed under the **GNU General Public License v3.0 (or later)**. See
[LICENSE](LICENSE).
