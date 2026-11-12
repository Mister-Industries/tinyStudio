# Changelog

What changed in each tinyStudio release. Dates are when the version was
finished; versions follow [semantic versioning](https://semver.org).

## 0.5.0 (2026-11-12)

### Boards

- tinyStudio remembers the board you choose for each device, options
  included. Plug the same board in again, on any USB port, or let it reset
  during an upload, and your choice comes back instead of whatever detection
  guesses. ESP32 boards are recognized by their USB serial number (the chip's
  MAC address); boards without one by their port. **Forget** in the Boards
  Manager goes back to automatic detection for that device.
- tinyStudio assumes a tinyCore only for a generic ESP32: a board that reports
  only Espressif's shared USB id (303a:1001, every ESP32-S3/C3/C6 in its default
  USB mode) and that you haven't chosen a board for. Any other board is shown
  as arduino-cli identifies it. When several boards match one device they are
  all offered, and an unrecognized device asks for its board type instead of
  being guessed (a CH340 adapter used to become an "Arduino Uno").
- A board that disappears for a moment, as an ESP32 does on every reset, stays
  selected; the selection moves to another board only if it is gone for more
  than five seconds. With nothing else plugged in, the unplugged board stays
  selected, so Verify keeps working.
- The Boards Manager shows installs as they happen: what is downloading, how
  far along, and what is being unpacked. The status bar shows the same from
  anywhere in the app, including the automatic board setup on first run.
- Only one install runs at a time. While one runs (yours, another window's, or
  the automatic setup's), the install buttons are disabled; a second click
  used to start a duplicate download of a package that was still installing.
- An install no longer fails after a fixed 10 minutes. Espressif's ESP32
  package is about 1.8 GB, so only a long stretch with no progress at all
  counts as a failure, and a lost connection to tinyService fails the request
  at once.
- Platforms the automatic setup didn't install (because you removed them, or
  it failed) are listed in the Boards Manager with an **Install** button.

### Visual view

- New projects come with a `visual.js`: a **Serial Plotter** like the Arduino
  IDE's, with the latest raw lines underneath like its Serial Monitor. It plots
  every number on a line, not just the first: `label:value` pairs (or bare
  numbers, as `value 1`, `value 2`, …) separated by spaces, commas or tabs each
  get their own coloured line and legend entry. **Create visual.js** in an
  existing project gives the same sketch. See
  [docs/visual-default-plotter.md](docs/visual-default-plotter.md).
- The starter sketch prints `led:1` / `led:0` instead of `LED ON` / `LED OFF`,
  so the Visual view graphs the blink straight away.

### Circuit

- Parts plug into a **tinyProto**'s holes the way they plug into a breadboard:
  drop a resistor, LED, button or capacitor on it with its legs in holes and
  they connect, ride along when the board moves, and turn with it. A tinyProto
  placed on a tinyCore stacks onto its header, pin for pin, and draws on top of
  it. Before, nothing seated in a tinyProto, so a part on it connected to
  nothing.
- **Wire on both sides of a tinyProto or breadboard.** The **Front/Back**
  button in the breadboard view turns the board over: the back (solder side) is
  shown mirrored, with the parts faded through the board, and wires drawn
  there are back-side wires. Wires on the other side are shown dashed and faded
  and can't be grabbed by accident. Nets don't care which side a wire is on.
- SparkFun's **6 mm** (COM-00097) and **12 mm** (COM-09190) tactile buttons are
  in Core → Input, with schematic symbols that show which legs are joined.
- The tinyProto no longer appears on the schematic as a 208-pin box. Like a
  breadboard it only joins nets, so the schematic shows the parts on it.
- A demo project, **tinyProto_Demo**, walks through the whole flow: two buttons
  and two LEDs on a tinyProto, wired front and back, laid out as a schematic
  and exported to KiCad.

### KiCad export

- **Export → KiCad HAT project** now writes a **schematic** (`.kicad_sch`) as
  well as the board, netlist and project. It uses KiCad's own symbols (embedded
  in the file, so it opens without any library installed), the parts where you
  put them on tinyStudio's schematic, net labels on every connection, ground
  symbols, and no-connect flags on unused pins. It passes KiCad's ERC with no
  errors, and **Tools → Update PCB from Schematic** brings every part onto the
  HAT with its ratsnest to the tinyCore headers, which are already linked to
  their symbols.
- In the desktop app the project goes into a **KiCad** folder in your project
  instead of a zip download. Exporting again rewrites the schematic, netlist
  and README but never the board or project file, so a layout you've started
  is kept: run Update PCB from Schematic again to pick up the changes.
- The KiCad files are named after your project, and the project file points at
  this schematic (it used to name tinyMove's).
- The project carries `fp-lib-table` and `sym-lib-table` entries for the
  KiCad stock libraries it uses, so footprints like the radial capacitor and
  6 mm button resolve even where the global library tables leave them out.
- The 12 mm button uses SparkFun's `Push_PTH_12x12mm` footprint. A few parts
  pointed at KiCad symbols that have since moved (3-pin header, BJTs, MOSFET);
  they use the current names.
- Values come out right for parts without one: a button is "Tactile Button
  6mm", not "false".
- See [docs/kicad-export.md](docs/kicad-export.md).

### Fixed

- **Save** (and ⌘S / Ctrl+S) saves the circuit in the Circuit view and the
  sketch in the Visual view. It only ever saved the file open in the code
  editor, so circuit edits were lost unless you switched back to the code first.
- The desktop app reopens your last project on launch, and no longer shows a
  "Repo not found" error at startup. Project links only apply in the web app;
  the packaged app read its own file path as one.
- Dialogs with a long line of text no longer push their buttons off the edge:
  the Library Manager's **Install** and **Search** buttons were clipped.
- While an upload runs, only **Upload** shows progress. Verify used to show
  "Verifying…" at the same time.
- macOS has a proper app menu: **Quit tinyStudio** (⌘Q), Hide, About.
- Installing a library that depends on one that comes with the board package
  (most I²C libraries depend on `Wire`) works. arduino-cli refused the whole
  install because `Wire` isn't in the library index; tinyService 1.3.0 installs
  the library and its other dependencies and skips the built-in one.
- The Visual view runs in the installed desktop app. It stayed on
  "starting…" with a blank canvas because the sandboxed sketch frame was loaded
  from `file://`, which Chromium won't let a sandboxed page do ("Not allowed to
  load local resource"). The app now serves the sketch runner over its own
  `tinystudio-sketch://` scheme. The dev server and the web app were never
  affected.
- The app no longer stops responding to clicks after closing the board menu,
  the Boards Manager or another popup. A menu that opened a dialog while it was
  still closing left `pointer-events: none` on the page; the Radix UI
  dependencies are deduplicated and a guard clears a stale lock.

- Choosing a board type in the Boards Manager sticks. Picking one before a
  board is plugged in left the selection without a port, and the next board-list
  update either swapped it back to the detected board or cleared it, which
  greyed out Verify and Upload. A hand-picked board is now kept and adopts a
  port as soon as one is detected.
- A tinyCore on USB is identified as **tinyCore ESP32-S3 No PSRAM** rather than
  **ESP32 Family Device**. Every ESP32-S3 enumerates as 303a:1001, which only
  the platform's hidden USB-discovery entry claims; that entry has no build
  settings, so compiling against it failed inside arduino-cli with no
  diagnostics. Detected placeholders are now mapped to the real board, and a
  build against an unmapped one fails with an explanation instead.

## 0.4.0 (2026-09-19)

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
- The browser build signs in through github.com and comes straight back, no
  token to paste. The web app's address is `studio.tinycore.cc`;
  `app.tinystudio.cc` forwards to it.
- **Make it mine** copies an example into a new public repo in your account,
  images included, and keeps you editing there.
- Link, Push, Pull and Publish from the GitHub tab. A project opened from a repo
  subfolder stays pinned to that folder.
- Push makes one commit with your message, deleted files included, and stops
  instead of overwriting files someone changed on GitHub since your last sync.
- Pull brings in GitHub's changes and keeps your edits to files GitHub also
  changed, naming them.
- A bar above the editor shows how many changes aren't pushed yet, with a Push
  button.
- Opening a folder that is a git clone of a GitHub repo links it automatically.
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
- The parts bin works like Fritzing's. A rail of tabs holds Search, Core, Mine,
  and one tab for each installed pack; all the SparkFun packs share one tab.
  Core opens with the tinyCore boards, then follows Fritzing's Core order
  (Basic, Input, Output, Power, then the breadboards). Mine holds the parts you
  import or make. Tiles are icons, with the name on hover.
- Search finds any installed part, including package variants, which no longer
  get a tile of their own. Simulation sources and probes are found by search.
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
- Requires tinyService 1.2.0.

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

## 0.3.0 (not released)

Merged to `main` between 3 and 22 July 2026 and included in 0.4.0: the new
circuit editor with breadboard, schematic and simulation; Arduino IDE parity for
board detection, board options, serial and the language server; the light theme.

## 0.2.0

See the [GitHub release](https://github.com/Mister-Industries/tinyStudio/releases/tag/v0.2.0).
