# Release plan: 0.4.0 and 1.0 beta

A handoff for a fresh Claude Code session. It comes from the [September 2026 audit](audit-2026-09.md)
of tinyStudio and the decisions the owner made on each open item. Item ids in
brackets (BUG-4, GAP-2) are the audit's, kept so work can be traced back.

## Before you start

**Where things stand.** Branch `v0.4-dev`. Every flagged audit fix is committed
locally and not pushed (`git log origin/v0.4-dev..HEAD`). Typecheck passes, lint
has 0 errors, 277 tests pass, the web build succeeds.

**Progress (2026-09-14).** Steps 1–5, 7a, 7c, 8, 9, 10, 11 and 12 are committed.
Waiting on the owner: step 6 (client id), 7b (decisions on the parts worksheet),
7d (the symbol editor mock). Blocker 2 is settled (the art was right; two boards'
pins were snapped back onto the grid in tinyparts) and blocker 5 is done.

**Rules from the owner**

- Commit locally. Don't push, tag or publish a release; the owner does that.
- In `../tinyparts`, commit locally and never push `main`: every installed app
  pulls from it on launch.
- Ask before anything destructive (deleting branches, deleting files outside this
  plan) and before changing another repo (tinyService, tinyStudio-examples).
- End commit messages with
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Before each commit: `npm run typecheck`, `npm run lint` (0 errors), `npm test`.
  For anything visible, run the app (`npm run dev:web`, or `npm run dev` for
  desktop-only features) and look at it.
- Add each user-visible change to the 0.4.0 section of `CHANGELOG.md`.
- Don't reformat `src/renderer/src/assets/tinyparts/`: the parts sync compares git
  blob hashes of those files.

**Read first:** `README.md`, `docs/state-management.md`, `INTEGRATION_GUIDE.md`,
`docs/circuit-view-tech-spec.md`, `docs/parts-and-art.md`.

## Waiting on the owner

These block specific steps below. Raise them early.

1. **tinyService release** [SEC-4]. tinyService 1.1.0 ignores `allowedOrigins`
   and listens on every interface. It needs to bind `127.0.0.1` and check the
   `Origin` header. After that release: bump the dependency and remove the Known
   issue from `README.md` and `CHANGELOG.md`.
2. **tinyparts art vs tests.** The local tinyparts commit `94dd94e` has newer
   tinyBoards art that fails 5 circuit tests (stack connector, 25-pin positions,
   0.1 in pitch, symmetry 182.66 vs 182.4, sync). Until the owner says whether the
   art or the tests are right, don't run `npm run parts:sync`.
3. **Write access to tinyStudio-examples** (step 11).
4. **The GitHub OAuth client id** (step 6), and the client secret set in Netlify's
   environment. The id arrived 2026-09-14; the secret, the callback URLs and the
   deploy-preview subdomain are the owner's Netlify and GitHub settings
   ([accounts-and-domains.md](accounts-and-domains.md), "Change now").
5. **`npm audit`** reports 21 vulnerabilities, 1 critical. Show the owner the
   critical one; apply fixes that don't need a major version bump.

## 0.4.0

In order. Removal comes first so later steps don't touch dead code; sweeps and
tests come after the features they cover.

### 1. Remove Blockly [LEFT-6, GAP-9]

Nothing can switch the blocks editor on.

- Delete `src/renderer/src/components/BlocklyEditor.tsx` and the
  `editorMode === 'blocks'` branch in `components/editor/CodeView.tsx`.
- Remove `editorMode` / `setEditorMode` from `redux/editorSlice.ts` if nothing
  else uses them.
- Remove the `blockly` dependency and the top-level `public/media/` folder (Blockly
  media, never served).
- Remove Blockly from `components/AboutDialog.tsx` and `THIRD_PARTY_NOTICES.md`.

Done when `grep -ri blockly src package.json` finds nothing and the build passes.

### 2. Stale branches [LEFT-12]

- Candidates to delete: `circuit-editor` (remote, merged) and `blockly-editor`
  (local).
- For `development` (local and remote), `file-state` (local) and `ui-reskin`
  (remote), list the commits not in `v0.4-dev`
  (`git log v0.4-dev..<branch> --oneline`).
- Show the owner the lists and delete only what they approve. Deleting a remote
  branch is a push, so the owner may prefer to do that part.

### 3. Views ask before creating files [BUG-4]

Today, opening Circuit or Visual silently writes files into the project.

- `components/editor/projectFiles.ts`: `useProjectFile` writes `makeDefault()`
  when the file is missing.
- `components/editor/CircuitPane.tsx` converts an old `diagram.json` on open,
  writing `circuit.json` and `diagram.json.bak`.

New behaviour:

- **No `circuit.json`:** the Circuit view shows "This project has no circuit yet"
  with a **Create circuit** button.
- **No `visual.js`:** the Visual view shows the same, with a button that creates
  it from the serial plotter template.
- **Only a `diagram.json`:** explain that it's the old format and offer
  **Convert**, saying it writes `circuit.json` and keeps the original as
  `diagram.json.bak`.
- Preview and Publish in the Visual view write `index.html`. Those are explicit
  actions; leave them.

Done when opening both views on a folder holding only an `.ino` leaves the folder
unchanged. Remove the matching Known issue from `README.md`.

### 4. Restart the backend once, then tell the user [BUG-5]

- **`src/main/ServiceManager.ts`, exit handler:** track a `stopping` flag set by
  `stop()`. On an unexpected exit, restart once on the same port, so the
  renderer's URL stays valid.
- **When the restart fails, or the service exits again within 60 seconds:** send
  `service:error` with enough detail to show.
- **New IPC:** add `service:restart` in `src/main/index.ts`, `src/preload/index.ts`
  and `index.d.ts`.
- **Renderer:** on desktop, `components/BackendPrompt.tsx` shows "tinyService
  stopped" with the error and a **Restart** button. Check what currently listens
  to `service:error`.
- **Testability:** keep the restart decision in a pure function, tested in step 12.
- **Docs:** remove the matching Known issue from `README.md`.

### 5. Studio AI model picker [BUG-11]

- `src/shared/agentCore.ts:27` pins `claude-opus-4-8`. Default to
  `claude-opus-5`, and offer:
  - Opus 5 (`claude-opus-5`)
  - Sonnet 5 (`claude-sonnet-5`)
  - Haiku 4.5 (`claude-haiku-4-5-20251001`)
- **Where the choice is stored:**
  - Desktop: next to the API key in `src/main/settings.ts`.
  - Web: add a key to `lib/storageKeys.ts`.
- **UI:** the Studio AI settings (`components/AIAssistant.tsx`, `agentSettings` in
  `lib/agentChat.ts`).
- Check that the thinking and prompt-caching options the agent sends are valid
  for every model offered (the `claude-api` skill has current model details).

### 6. GitHub sign-in in the browser [GAP-2, REL-5, B.1]

The domains and the OAuth app's registration are decided in
[accounts-and-domains.md](accounts-and-domains.md); this step follows it.

1. **Client id [REL-5].** The tinyStudio OAuth app's client id is public. Make
   it the default in `src/shared/githubApp.ts`, used by `src/main/githubAuth.ts`,
   `electron.vite.config.ts` and the web build, keeping `VITE_GITHUB_CLIENT_ID`
   as an override. Update `docs/github-auth.md`, the checklist in
   `docs/packaging-windows.md` and the README.
2. **Web flow.** GitHub's web OAuth flow needs the client secret for the token
   exchange even with PKCE, so that exchange runs server-side:
   - **Netlify function.** Add `netlify/functions/github-token.ts` and wire it in
     `netlify.toml`. It swaps the code for a token using `GITHUB_CLIENT_SECRET`
     from Netlify's environment. Origins it accepts: `https://studio.tinycore.cc`,
     `https://app.tinystudio.cc` until it forwards,
     `https://deploy-preview-<n>.preview.tinystudio.cc`, `http://localhost:5173`
     and `http://localhost:5174`.
   - **PKCE.** GitHub supports `code_challenge` (S256) for OAuth apps; use it.
   - **Scope:** `public_repo` only. The owner decided against private-repo access.
   - **Callback.** `/auth/github/callback` (not `/auth/callback`, which the
     tinyCore sign-in uses). Build `redirect_uri` from `window.location.origin`,
     so every host returns to itself. Make `lib/projectRouting.ts` ignore
     `/auth/*`, so it isn't read as `/<owner>/<repo>`.
   - **Local development.** An OAuth app allows up to 10 callback URLs, so no
     second app is needed; the localhost callbacks are registered on the one app.
   - **Token field.** The pasted token stays under **Advanced**.
3. **Domain references.** `app.tinystudio.cc` becomes `studio.tinycore.cc` in
   `netlify.toml`, `lib/projectRouting.ts`, `src/shared/agentGuides/tinystudio.md`,
   `docs/github-auth.md`, `INTEGRATION_GUIDE.md` and this plan. Links to
   `https://tinystudio.cc` stay: that address becomes the landing page.
4. Done when `studio.tinycore.cc` and a deploy preview at
   `deploy-preview-N.preview.tinystudio.cc` both sign in without a pasted token.

### 7. Circuit editor [B.4]

The owner's feedback: the parts palette feels random next to Fritzing, its order
doesn't make sense, and part labels don't follow a convention they like;
simulation doesn't seem to work; symbol editing doesn't really work. For 0.4.0,
drawing circuits well matters most.

**a. Label simulation Experimental.** Add an Experimental tag and a one-line note
("Simulation is experimental and results may be wrong") where the Simulate panel
opens (`circuit/views/sim/SimPanel.tsx` and its entry points). Fix crashes only.
Try a resistor divider and an LED circuit, and write down what fails for beta
step 5.

**b. Curate the parts palette.**

1. **Build a picker page** listing every part: the appendix below, plus the parts
   generated in code (breadboards, power, ground and net labels, sources and
   probes; start from `circuit/views/palette/Palette.tsx`).
2. **Ask the owner to decide:**
   - which parts stay
   - the categories and their order
   - the order within each category
   - a label convention
3. **Apply it** in `../tinyparts`: `label`, `family` and `description` in each
   `part.json`, and whatever decides palette order (find that in `Palette.tsx`).
   Use the dev-folder layer to see the result live.
4. **Check** with `npm run parts:check`, then commit in tinyparts locally. Sync
   into this repo only after blocker 2 is settled.

**c. Nudge pins in the parts editor.** In `components/PartsEditor.tsx`:

- select a pin on the breadboard art
- arrow keys move it one unit in the art's own coordinates
- Shift+arrow moves it 0.1 in
- the move writes back to the pin and can be undone

**d. Schematic symbol editor.** A new mode in the parts editor for a part's
schematic view:

- draw the body rectangle
- add, move and rename pins, snapped to a 0.1 in grid, with side and order
- edit the part name text
- save it as the part's schematic SVG, with pins as `pin-*` shapes so it
  round-trips through the parts pipeline (`docs/parts-and-art.md`)
- start from the existing art or the generated symbol (`circuit/parts/symbolLibrary.ts`)

Scope is rectangles, pins and text, with no freeform drawing. Show the owner a
mock of the editor before building it.

### 8. Interface

**a. One place for project actions [UX-1].** With no project open, the Files
panel (`components/FileExplorer/FileExplorerContent.tsx`) says only "No project
open". Creating and opening projects happens on the start screen and in the
header's project menu, with the same wording in both.

**b. Keyboard shortcuts dialog [UX-3].**

1. **Inventory** every key handler:
   `grep -rn "keydown\|onKeyDown" src/renderer/src`.
2. **Create one list** in `lib/shortcuts.ts`: id, keys, label and where it applies.
3. **Have the handlers read that list,** including `components/editor/CodeView.tsx`,
   `circuit/views/canvas/Canvas.tsx` and the toolbar.
4. **Add the dialog,** opened from the header menu and with Ctrl+/.

**c. Alpha label [UX-5].** No change in 0.4.0. The status bar badge
(`components/StatusBar.tsx:239`) and the README notice switch to "beta" at 1.0
beta.

### 9. Sweeps (separate commits, no behaviour change except error reporting)

**a. Error reporting [CODE-7].**

1. **Add the helper.** `reportError(title, error)` in `lib/notify.ts` shows an
   error toast and logs to the console.
2. **Rule:**
   - A failure of something the user did gets a toast.
   - A background failure logs a warning with context.
   - An empty `catch` carries a comment saying why it's safe to ignore.
3. **Write the rule** into `docs/state-management.md`, or a new
   `docs/code-conventions.md` linked from the README.
4. **Convert the call sites.** Start from `grep -rn "console.error\|catch {" src`.

**b. Comments that narrate history [CODE-2].** Rewrite comments that describe
what the code used to do so they say what it does now and why. Start from
`grep -rniE "used to|previously|no longer|the old |was wrong|before this" src`.
History belongs in git.

### 10. CI for tinyparts [GAP-7, first half]

In `../tinyparts`, add a GitHub Actions workflow that runs the part checks on every
push and pull request, so a broken `part.json` can't reach `main`. The checker
lives here (`scripts/parts-tool.mjs check`). Either check out tinyStudio in the
workflow and point the checker at the tinyparts checkout (read the script for its
arguments), or copy it into tinyparts. Commit locally; the owner pushes.

### 11. Example tags move to the examples repo [B.3, DOC-4, UX-4]

Needs blocker 3.

- **Move tag generation.** Move `scripts/gen-example-tags.mjs` to
  tinyStudio-examples, with a workflow that writes tags into its `examples.json`.
- **Clean up here.** Delete `examples.json` and `examples-tagged.json` from this
  repo, and any code in `lib/examples.ts` that falls back to this repo's manifest.
- **Refresh `docs/web-deploy.md`.** It still calls the examples repo a future step
  and points at `ExamplesContent.tsx` for the manifest URL.
- **Fix the example content there.** `blink-alternate`'s README says it "was
  one-shot by Claude Sonnet 4.0", and its `visual.js` hardcodes a dark palette
  instead of using `theme`.

### 12. Tests for the critical paths [GAP-4]

The runner is `scripts/test-circuit.mjs` (esbuild and `node:test`). Read how it
finds tests. Keep tested functions free of `electron` imports, or stub them.

- **Folder access** (`src/main/folderAccess.ts`): granted folders, subfolders,
  case rules per platform, the examples folder.
- **Link and file rules:** `isSafeExternalUrl` (`src/main/externalLinks.ts`), and
  the `open-path` extension allowlist (export it from `src/main/ipc/files.ts`).
- **Backend restart** (step 4): the decision function.
- **File actions** (`commands/fileCommands.ts`), against a fake `fileSystem`:
  - `openFolder` builds the tree
  - `refreshWorkspace` keeps ids
  - `renameItem` updates open tabs
- **Theme migration:** `readSavedTheme` in `lib/ThemeProvider.tsx` (export it).

### 13. Release prep

- **BUG-9:** the blink-alternate example opens as "Empty circuit" although it has
  a `circuit.json`. Found: the file was empty (`parts: []`), written by 0.3's
  Circuit view on open and committed by a web-export push. Removed from the
  examples repo; the parser is right.
- **Changelog and docs:** finish the 0.4.0 section of `CHANGELOG.md` and the
  README's Known issues.
- **Owner:** the hardware smoke test (below), then tagging and release.

**Hardware smoke test:**

1. Install on a clean machine.
2. Plug in a tinyCore and check it's detected.
3. Compile (the first compile downloads the core), then upload.
4. Serial Monitor shows output, and a Visual sketch reacts to it.
5. Sign in to GitHub; Make it mine, then Push.
6. Reopen a recent project.
7. Draw a circuit.

## 1.0 beta

In order.

1. **Split `Canvas.tsx`.** About 2,000 lines with every gesture in one component.
   Give each gesture its own module (pan and zoom, select and marquee, part drag,
   wire drawing and editing, leg bending, keyboard) with no behaviour change. The
   steps below build on it.
2. **Performance test.** Time part drags and net updates on a large circuit (say
   200 parts and 500 wires), and set a budget.
3. **ERC pin-type checks.** Use each pin's type from `pins[]`: two outputs
   driving the same net, power pins left unconnected.
4. **Bent-leg art.** Bent LED and resistor legs currently draw as a line over
   unchanged art; make the art follow the leg.
5. **Simulation that runs the sketch, like Wokwi.** Start with a written
   comparison for the owner before building anything:

   - **Emulators to evaluate:** Wokwi's open-source emulators for AVR and RP2040,
     and Espressif's QEMU fork for ESP32 and ESP32-S3.
   - **How emulated pins and serial would drive circuit parts:** LEDs, buttons,
     the Serial Monitor.
   - **What happens to the SPICE simulator.**

   **Findings from 0.4.0 step 7a (2026-09-14).** Tried in the web build, DC
   operating point unless noted:

   - A 5 V source into two 1 kΩ resistors gives 2.500 V at the midpoint and
     2.50 mA. Correct.
   - 5 V through 220 Ω into the 5 mm LED gives 2.646 V forward and 10.7 mA,
     and the DC sweep plots all three signals. Plausible.
   - A tinyCore driving the same LED from D13 to GND reports every node at
     0 V with the notice "U1 (tinycore) is a board — not simulated; drive
     its pins with sources". The netlist has no ground node either, since
     the board's GND pin is not a ground label. This is almost certainly
     what "simulation doesn't seem to work" means: the circuits people draw
     have a board in them. Until the sketch runs (this step), at least the
     board's power pins (3V3, 5V, GND) could be modelled as fixed sources.
   - No crashes in any of the three.

6. **Milestone M5 [GAP-1], all of it.** KiCad netlist export, `.kicad_sch`
   export, Wokwi `diagram.json` import and export with a lint check, and `.fzz`
   import, as specified in `docs/circuit-view-tech-spec.md`.
7. **Arduino IDE parity [GAP-5].**
   - Sketch → Include Library.
   - Installing a library from a .ZIP, from inside the Library Manager dialog
     (`components/arduino/LibraryManager.tsx`); the owner specifically wants it
     there.
   - Save As, and Archive (export as .zip).
   - Programmer selection, Upload Using Programmer and Burn Bootloader. These need
     tinyService support; plan that release with the owner.
8. **Signing and updates [GAP-3].** Windows code signing; macOS signing and
   notarization (`notarize: false` today); `electron-updater` publishing to
   GitHub Releases in `electron-builder.yml`.
9. **Third-party parts packs [GAP-7, second half].** A confirmation step when
   someone adds a pack index URL, and file hashes checked against the index.
10. **Getting started [GAP-8].**
    - A first-run onboarding tour of Code, Circuit and Visual.
    - A few Basics bundled in the installer, so Examples works offline.
    - Guided tutorials inside the app.
11. **End-to-end test [GAP-4].** An Electron smoke test (Playwright's Electron
    support): launch, open a project, compile against a mock tinyService. Run it
    in CI.
12. **Label.** Switch "alpha" to "beta" in the status bar and README [UX-5].

## After beta

- Upload over Wi-Fi (OTA).
- CircuitPython support.

## Audit items with no decision yet

Check these with the owner when planning beta:

- **SEC-5:** the renderer still runs with `sandbox: false`. Navigation and
  window-open are already guarded.
- **SEC-7:** the web build keeps the Anthropic key and GitHub token in
  localStorage.
- **REL-11:** the main web chunk is 6.4 MB, mostly Monaco languages and mermaid.
  Split it.
- **CODE-4:** layout depends on measured sizes and magic numbers: the editor
  height in `EditorPanel.tsx`, and the Files panel width, measured from the
  toolbar divider in `App.tsx`.

## Appendix: bundled parts

From `src/renderer/src/assets/tinyparts/packs/*/parts/*/part.json`, as of this
plan. Columns are the pack, the part folder, `label` and `family`.

| Pack       | Part                                      | Label                           | Family                          |
| ---------- | ----------------------------------------- | ------------------------------- | ------------------------------- |
| core       | 7segment-100-cat                          | 7 Segment Display               | Character Display               |
| core       | battery-aa                                | Battery                         | Battery                         |
| core       | buzzer-v15                                | LilyPad Buzzer                  | microcontroller board (lilypad) |
| core       | capacitor-ceramic-100mil                  | Ceramic Capacitor               | Capacitor [bidirectional]       |
| core       | capacitor-ceramic-200mil                  | Ceramic Capacitor               | Capacitor [bidirectional]       |
| core       | capacitor-electrolytic-medium             | Electrolytic Capacitor          | Capacitor [unidirectional]      |
| core       | diode-1n4001-300mil                       | Rectifier Diode                 | Diode                           |
| core       | diode-zener-0-5w-3-6v-300mil              | Zener Diode                     | Diode                           |
| core       | ir-receiver-v14                           | IR Receiver Breakout            | IR                              |
| core       | ldr-photocell-300mil-v5                   | Photocell (LDR)                 | Photo-Resistor                  |
| core       | led-generic-3mm                           | Red LED - 3mm                   | LED                             |
| core       | led-generic-5mm                           | Red LED - 5mm                   | LED                             |
| core       | piezo-sensor                              | Piezo Speaker                   | Piezo                           |
| core       | potentiometer-rotary-16mm-5               | Rotary Potentiometer (Large)    | Potentiometer                   |
| core       | potentiometer-trimmer-6mm-5               | 6mm Trimmer Potentiometer       | Potentiometer                   |
| core       | pushbutton                                | Round Pushbutton                | Switch - 2 pin                  |
| core       | reedswitch-500mil                         | Reed switch                     | Reed Switch                     |
| core       | resistor                                  | 220 Ω Resistor                  | Resistor                        |
| core       | servo                                     | Basic Servo                     | Servo                           |
| core       | smd-inductor-0805                         | Inductor                        | air-core inductor               |
| core       | sparkfun-discretesemi-mosfet-nchannel-pth | MOSFET-NCHANNEL                 | sparkfun Mosfet (N Channel)     |
| core       | sparkfun-passives-fuse-x20mm              | FUSE                            | sparkfun Fuse                   |
| core       | sparkfun-sensors-mic-electret-smd         | MIC                             | sparkfun Electret Mic           |
| core       | switch-spst                               | Slide Switch (SPST)             | Switch                          |
| core       | te-relay                                  | RELAY                           | TE General Purpose Relays       |
| core       | thermistor-300mil                         | Temperature Sensor (Thermistor) | temperature sensor              |
| core       | transistor-signal-npn-to92-ebc            | NPN-Transistor                  | Bipolar Transistor              |
| core       | transistor-signal-pnp-to92-ebc            | PNP-Transistor                  | Bipolar Transistor              |
| core       | voltage-regulator-7805                    | Voltage Regulator - 5V          | Voltage Regulator               |
| tinyboards | tinycore                                  | tinyCore                        | tinyStudio                      |
| tinyboards | tinydisplay                               | tinyDisplay                     | tinyStudio                      |
| tinyboards | tinyglow                                  | tinyGlow                        | tinyStudio                      |
| tinyboards | tinyproto                                 | tinyProto                       | tinyStudio                      |
| tinyboards | tinysniff                                 | tinySniff                       | tinyStudio                      |
| tinyboards | tinyspeak                                 | tinySpeak                       | tinyStudio                      |
