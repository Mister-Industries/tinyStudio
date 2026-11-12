# The default visual.js and the sketch runner

Two related pieces of the Visual view:

1. **The default `visual.js`**: a Serial Plotter + Serial Monitor that every new project starts with.
2. **How the packaged desktop app loads the sketch runner**: the `tinystudio-sketch://` scheme that makes the Visual view work when the app is loaded from `file://`.

## 1. The default `visual.js`

### Where it comes from

| What                                            | Where                                                                                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The sketch itself                               | `DEFAULT_VISUAL` in `src/renderer/src/components/editor/sketchTemplates.ts`                                                                               |
| Added to every new project                      | `createDefaultProjectFiles()` in `src/renderer/src/components/FileExplorer/utils.ts` (listed in the **New Project** preview by `CreateProjectDialog.tsx`) |
| **Create visual.js** in a project that has none | `VisualPane.tsx`, same `DEFAULT_VISUAL`                                                                                                                   |

`DEFAULT_VISUAL` is a template literal, so backslashes, backticks and `${` in the sketch are escaped there (`\\s`, `` \` ``, `\${`). Edit it as a `.js` file first and escape it when pasting back, or the regexes break silently.

The starter `.ino` prints `led:1` / `led:0` (it used to print `LED ON` / `LED OFF`), so a brand-new project graphs its blink in the Visual view with no edits.

### What it looks like

A 480×480 canvas, top to bottom:

- **Header.** `SERIAL PLOTTER` on the left, the number of data lines received on the right.
- **Legend.** One entry per series: a colour chip, the name and the latest value. It wraps onto more rows when there are many series.
- **Plot card.** The last 200 samples of every series, auto-scaled to everything on screen (with 8% headroom), four grid lines with value labels, and a zero line when zero is in range. Before any numbers arrive it shows "Waiting for numbers…" and an example line.
- **Monitor strip.** The last 5 raw lines, newest at the bottom, cut with "…" to fit. Every line goes here, including lines with no numbers (like `Setup complete!`).

All colours and fonts come from `theme`, so it follows light/dark mode. Series use `theme.series` (5 colours), then `theme.text` and `theme.muted`, so a 6th or 7th series doesn't reuse the first colour.

### Line format (same rules as the Arduino IDE's Serial Plotter)

Each line the board prints is one sample. Fields are split on **spaces, commas and tabs**:

| Board prints               | Plotted as                                             |
| -------------------------- | ------------------------------------------------------ |
| `512`                      | `value 1` = 512                                        |
| `512,300` or `512 300`     | `value 1` = 512, `value 2` = 300                       |
| `temp:21.5 humidity:40`    | `temp` = 21.5, `humidity` = 40                         |
| `temp: 21.5, humidity: 40` | same (a `label:` followed by a number field is a pair) |
| `ax:-4 ay:499 az:4161`     | three series: `ax`, `ay`, `az`                         |
| `Setup complete!`          | nothing plotted; shown in the monitor strip            |
| `chip id: 0x48`            | nothing plotted (`0x48` isn't a decimal number)        |

- A field counts as a number only when the **whole field** is one: `12`, `-3.5`, `.5`, `1e3`. That's stricter than `serialValue()`, which takes the first digits anywhere in the line, so labels with digits (`A0:512`) or hex IDs don't pollute the chart.
- Unnamed numbers are named by their position among the unnamed numbers in that line: `value 1`, `value 2`, …
- A series that appears later is back-filled with gaps so all lines stay aligned on the x axis. A line that lacks a series leaves a gap (the line breaks) rather than repeating the last value.

### How it reads serial

- `serialEvent(line)` is called once for **every** line, so no samples are dropped or duplicated. The old default pushed `serialValue()` once per frame, which repeated values when the board was slow and dropped lines when it was fast.
- `setup()` replays `serialLines()` (the app keeps the last 300), so restarting the sketch or opening the Visual view mid-stream shows recent history straight away.
- It only uses p5, `theme`, `serialEvent` and `serialLines`, so it runs unchanged in the exported standalone page.

### Tuning

At the top of the sketch:

| Constant        | Default | Meaning                              |
| --------------- | ------- | ------------------------------------ |
| `MAX_POINTS`    | 200     | samples kept on screen per series    |
| `MONITOR_LINES` | 5       | raw lines shown in the monitor strip |

### Example: a project-specific visual

`BMI330_Pocket_Test` (a SparkFun ESP32-C6 Qwiic Pocket + BMI330 IMU) replaces the default with an artificial horizon, roll/pitch/|a| readouts and gyro bars, parsing the same `ax:… ay:… az:… gx:… gy:… gz:…` lines. Its README explains the maths. It's a good reference for going from "plot the numbers" to a purpose-built display.

## 2. Loading the sketch runner in the packaged app

### The problem

`VisualPreview.tsx` runs `visual.js` inside `public/sketch-runner/index.html`, in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`. That keeps sketches (which can come from any GitHub repo) away from the app, project files and accounts. A sandboxed frame has an **opaque origin**.

The packaged app loads its UI with `loadFile()`, so the runner URL was `./sketch-runner/index.html` → `file:///…/out/renderer/sketch-runner/index.html`. Chromium refuses to let an opaque-origin document load `file://` URLs:

```
Not allowed to load local resource: file:///Applications/tinyStudio.app/Contents/Resources/app/out/renderer/sketch-runner/…
```

The runner never posted `{ type: 'ready' }`, so the Visual view stayed on "starting…" with a blank canvas. The dev server (`npm run dev`) and the web app serve the runner over http and never hit this, which is why it only showed up in the installed app.

### The fix

`src/main/sketchRunnerProtocol.ts` serves the runner folder over a private scheme:

| Step                   | Where                                                                                                                       | What                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Register the scheme    | `registerSketchScheme()`, called at the top level of `src/main/index.ts` (schemes must be registered before `app` is ready) | `tinystudio-sketch` with `standard: true` (relative URLs like `p5.min.js` resolve normally) and `secure: true` |
| Serve files            | `serveSketchRunner(join(__dirname, '../renderer/sketch-runner'))`, called in `app.whenReady()` before the window is created | `tinystudio-sketch://runner/<path>` → `out/renderer/sketch-runner/<path>` via `net.fetch`                      |
| Point the iframe at it | `RUNNER_URL` in `src/renderer/src/components/VisualPreview.tsx`                                                             | `tinystudio-sketch://runner/index.html` when the page is `file:`; `/sketch-runner/index.html` otherwise        |
| Allow it as a frame    | the CSP in `src/renderer/index.html`                                                                                        | `frame-src 'self' tinystudio-sketch:`                                                                          |

The sandbox is unchanged: the iframe still has an opaque origin and talks to the app only through `postMessage`. The handler only serves files inside the runner folder: the decoded path is normalized and must stay under it (so an encoded `%2e%2e/` can't climb out), a missing file is a 404, and a malformed URL is a 400.

### Known limitation (not fixed here)

Monaco's web workers also fail in the packaged app (`Could not create web worker(s). Falling back to loading web worker code in main thread`), most likely for the same `file://` reason (not confirmed). Editing still works, but language features run on the UI thread. Serving the whole renderer from a custom scheme instead of `file://` would probably fix both at once; that's a bigger change.

## Testing

What was run for these changes (2026-11-11):

- `tsc --noEmit` for `tsconfig.node.json` and `tsconfig.web.json`: clean.
- **Headless runner test.** The real `runner.js` + p5 1.9.4 in Chromium (Playwright), driven with `postMessage` exactly as `VisualPreview` does, in light and dark themes. Inputs:

  - 6-series IMU lines;
  - mixed labelled lines, with a series appearing mid-stream and a text line in between;
  - bare numbers;
  - no data;
  - a replayed buffer.

  No sketch errors in any case.

- **In the app, loaded from `file://`.** `electron-vite build`, swapped into `dist/mac-arm64/tinyStudio.app`, with a SparkFun ESP32-C6 Qwiic Pocket + BMI330 streaming live:
  - the Visual view ran (it stayed blank before this fix);
  - a new project contained `visual.js` and plotted all six series;
  - the BMI330 visual tracked the board.
