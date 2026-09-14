# Changelog

What changed in each tinyStudio release. Dates are when the version was
finished; versions follow [semantic versioning](https://semver.org).

## 0.4.0 — unreleased

0.3.0 was merged to `main` in July 2026 but never tagged or released, so 0.4.0
is the first release since 0.2.0 and includes everything under 0.3.0 below.

### Projects

- A start screen with **Create new**, **Open existing**, **Try an example** and
  your recent projects.
- **Open existing** takes a local folder, a pasted GitHub repo or link, one of
  your own repos, or a recent project.
- The **New Project** dialog names the folder and sketch the way the Arduino IDE
  does.
- A project menu in the header.
- In the browser, recent folders reopen with one permission prompt. Projects
  that only live in the browser show a **Save to computer** banner, and Firefox
  and Safari get scratch projects kept in browser storage.
- The browser build can compile and upload a real local folder.

### GitHub

- Desktop sign-in uses GitHub's device flow and keeps the token in the system
  keychain instead of browser storage. A personal access token is still accepted
  under **Advanced**.
- Sign-in asks only for access to public repositories.
- **Make it mine** copies an example into a new public repo in your account,
  images included, and keeps you editing there.
- Link, Push, Pull and Publish from the GitHub tab. A project opened from a repo
  subfolder stays pinned to that folder.
- Whether you can push to a repo is checked with GitHub instead of guessed.

### Parts

- Parts now live in the [tinyparts](https://github.com/Mister-Industries/tinyparts)
  repo as a folder per part: a `part.json` plus real SVG files you can edit in
  Illustrator. Pins come from shapes named `pin-*`.
- The app ships a snapshot of tinyparts and, on launch, downloads only the files
  that changed on GitHub (checked at most every 15 minutes).
- Parts are layered: your own edits on this computer, then a developer
  checkout, then GitHub, then the built-in snapshot.
- The parts editor shows both views and can save a part on this computer or
  reset it to the default.
- The Parts Packs panel is reorganised into Built in, Developer, This computer
  and More packs. Installed packs stay linked to GitHub.
- Fritzing art ships with its CC-BY-SA attribution.
- New breadboard art for the tinyCore, tinyDisplay, tinyProto and tinySpeak.
- In the parts editor, arrow keys nudge the selected pin by one unit of the
  art's own coordinates (Shift: 0.1 in). While pins come from `pin-*` shapes
  the nudge moves the shape in the SVG, so the file stays the source of truth.
  Ctrl+Z and Ctrl+Y undo and redo pin, size and art changes.

### Circuit view

- A new circuit editor replaces the old one, saving to `circuit.json`. Opening
  the view doesn't write into a project that has no circuit: a **Create
  circuit** button adds one, and projects with an old `diagram.json` get a
  **Convert** button that writes `circuit.json` and keeps the original as
  `diagram.json.bak`.
- **Breadboard:** zoom at the cursor, pan, fit, marquee select; draw, bend and
  tap wires; rotate, flip, nudge, copy and paste parts; generated mini, half and
  full breadboards that connect parts seated in their holes; bendable LED and
  resistor legs; undo and redo up to 200 steps.
- **Schematic:** the same circuit as a schematic, with a hand-drawn US/IEEE
  symbol set, ground, power and net labels, reference designators above each
  symbol and simulated values below, ratsnest lines, and an electrical rule
  check.
- **Simulate** is labelled Experimental, with a note that results may be
  wrong. Circuits that contain a board read 0 V everywhere; the board's pins
  aren't modelled yet.
- **Simulation:** ngspice runs in the app (downloaded on first use, about
  20 MB) with DC operating point, DC sweep, transient and AC analyses; charts
  with cursors, zoom, log axes, dB and phase; CSV export; voltage and current
  probes; node voltages drawn on the canvas. Pick what to plot by clicking the
  schematic.
- Import a Fritzing `.fzpz` by dropping it on the canvas.
- SVG and PNG export of either view.
- The **Edit** button is labelled, each view remembers its own zoom and
  position, and pins stay easy to click when zoomed out.

### Code, build and serial

- Renaming an open file updates its tab's name as well as its path.
- Boards are detected as they're plugged in and unplugged, without polling.
- A board options menu (PSRAM, partition scheme, CPU frequency) and
  **Change board**.
- Compiler errors show as markers in the editor, and a failed build keeps the
  Output tab open.
- Real upload progress, and ESP32 uploads report success correctly.
- The Serial Monitor has the full baud list, a line-ending picker, timestamps,
  and remembers settings per port. It reports a port as open only when it is.
- Code completion, hover, signature help and live diagnostics from the Arduino
  language server (desktop).
- The backend picks a free port starting at 3000, and the app connects to
  whichever one it got.
- Requires tinyService 1.1.0.

### Visual view

- The Visual view no longer writes `visual.js` into a project that has none;
  it offers to create one from the serial plotter template.
- Sketches run in a sandbox, so a project's `visual.js` can't reach your files.
- p5.js is bundled, so Visual works offline.
- A `theme` object lets sketches follow light and dark mode. New projects start
  with a serial plotter.
- The exported web page has a theme toggle and a connection status.

### Studio AI

- Runs in the browser as well as the desktop app.
- New tools: read a built-in guide, inspect the circuit, find parts, read serial
  output. Guides cover the app, the tinyCore pinout, `visual.js`, serial and
  `circuit.json`.
- The conversation stays when you switch to another tab.
- Pick the model in the Studio AI settings: Opus 5 (the default), Sonnet 5 or
  Haiku 4.5. Earlier builds were pinned to Opus 4.8.

### Examples

- Example tags are generated in the examples repo by its own workflow; the
  app reads them from that repo's `examples.json` and no longer carries a copy
  of the manifest.
- Examples come from the
  [tinyStudio-examples](https://github.com/Mister-Industries/tinyStudio-examples)
  repo, with tags, search and filters. Board tags use each board's colour.

### App

- Light theme by default, with coloured chrome and tabs. Diagrams in docs follow
  the theme.
- **About tinyStudio** in the header menu shows the version, licence and credits.
- **Keyboard shortcuts** in the header menu (or Ctrl+/) lists every shortcut
  the app defines.
- With no project open, the Files panel just says so; creating and opening
  projects happens on the start screen and in the header menu, with the same
  names in both: **Create new**, **Open existing**, **Try an example**.
- If tinyService stops while the desktop app is open, the app restarts it once.
  If that fails, or it stops again within a minute, a notification says so and
  offers **Restart**. A missing arduino-cli is reported the same way.
- Links in project READMEs open in your browser instead of replacing the app.
- The Windows installer has its own app identity and ships only the built app.
- Your theme choice carries over from earlier versions.
- The unfinished blocks editor (Blockly) is gone. It was bundled but could
  never be switched on.

### Security

- tinyService 1.2.0 listens on this computer only and refuses browser origins
  it doesn't know, so another website can't reach your boards through it.
- File access on desktop is limited to folders you've opened, plus downloaded
  examples. Projects opened in an earlier version ask for their folder once.
- Only web and email links open outside the app, and only documents and images
  open in other programs.
- Part art from packs and imports is sanitised before it's shown.
- A strict Content Security Policy in the built app.

## 0.3.0 — not released

Merged to `main` between 3 and 22 July 2026 and included in 0.4.0: the new
circuit editor with breadboard, schematic and simulation; Arduino IDE parity for
board detection, board options, serial and the language server; the light theme.

## 0.2.0

See the [GitHub release](https://github.com/Mister-Industries/tinyStudio/releases/tag/v0.2.0).
