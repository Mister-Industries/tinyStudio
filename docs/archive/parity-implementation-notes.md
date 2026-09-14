# Arduino IDE Parity — Implementation Notes (July 2026)

Companion to `arduino-ide-comparison.md`. This documents what was implemented
from that report's §7 recommendations, across **tinyStudio** (branch
`development`) and **tinyService** (branch `claude-development`, shared
`1.2.0` / service `1.1.0`). Scope notes honored: the Visual view stands in
for the Serial Plotter, the Library Manager UX was left as-is, and everything
works in both the desktop and browser builds (LSP is desktop-only — the
language server needs the sketch on disk).

## What changed

**1. Event-driven board detection (report §3, Bugs 4–5).** tinyService now
runs one long-lived `arduino-cli board list --watch --format jsonmini`
process (`board-watch.service.ts`) and broadcasts a `board-events` push to
every client on plug/unplug (~150 ms debounce). New clients get a snapshot on
connect; `list-boards` is served instantly from the watcher's memory. The
frontend subscribes (`useArduino.ts`) instead of polling — the 8 s
poll-until-first-board and the 5 s refresh cache are gone. Unplugging the
selected board now clears the selection with a toast; a replacement port is
adopted automatically.

**2. Serial monitor lifecycle (Bugs 1–3, 13).** `serial.handler.ts` was
rebuilt around per-session objects: `opened` is only reported once confirmed
(banner, first sketch output, or survive-the-confirm-timer for arduino-cli
≥1.x's quiet piped mode); port-open failures are surfaced as `error` messages
carrying arduino-cli's own words (no longer filtered away); stale
child-process handlers can no longer delete or "close" their replacement
session (the Windows taskkill race); output is forwarded verbatim (partial
lines flushed after 120 ms) instead of trimmed/filtered.

**3. Failed builds stay visible + inline errors (Bug 6, rec 3).** The
monitor panel only snaps back to Serial on success, and never overrides a tab
the user picked mid-build. Compiler output is parsed into `file:line:col`
diagnostics (`lib/compileErrors.ts`) and rendered as Monaco markers in the
matching file (`arduino-compile` owner).

**4. Request ids (Bug 7).** The shared protocol carries an optional `id` on
every request; the service echoes it on all replies; `waitForResponse`
matches on it. Concurrent same-action requests no longer cross-talk. Fully
backward compatible (id-less messages still work).

**5. Board settings gear (rec 5, Bug 8).** New `BoardOptionsMenu` next to
the port pill: FQBN config options (PSRAM, partition scheme, CPU freq, …) via
the new `board-details` action, encoded into the FQBN like the Arduino IDE;
plus "Change board…" — a searchable picker over installed board definitions
for wrong VID/PID guesses (guessed boards are labeled). The
every-tinyCore-FQBN-collapses-to-one-variant behavior was removed; VID
`303A` still defaults to tinyCore (tradeoff kept) but is flagged as a guess
and overridable.

**6. Monitor UX parity (rec 6).** Full baud list (300 → 2 000 000, incl.
74880 for ESP boot messages), line-ending selector (None/NL/CR/Both — sends
are raw now, the backend appends nothing), timestamps toggle, and per-port
persistence of baud + line ending (localStorage).

**7. Language server (rec 7).** tinyService bridges
`arduino-language-server` + clangd over WebSocket at `/lsp?fqbn=…`
(`lsp.service.ts`; stdio framing handled server-side). The renderer has a
dependency-free LSP client (`lib/lsp/monacoLsp.ts`) wiring completion, hover,
signature help, and live diagnostics into Monaco. Desktop-only; degrades
silently when binaries are missing. **Fetch binaries with:**
`npm run fetch:language-server -- current` (they land in
`vendor/language-server/` and are picked up automatically; packaged builds
bundle them via electron-builder.yml).

**8. Quality of life (rec 8, Bugs 9, 10, 12).** Real upload progress parsed
from esptool/avrdude output (the fake 10%-per-200ms timer is gone); esptool
success markers recognized in the timeout fallback; tinyService binds the
first free port from 3000 (the renderer asks the main process for the real
URL — web builds keep the `tinyservice.url` localStorage override); stale
React closures in the compile/upload timeout-recovery paths fixed.

## Not done (deliberately)

Programmer selection / Upload Using Programmer / Burn Bootloader (needs new
service actions — small follow-up now that `board-details` returns
programmers), Include Library / Add .ZIP, sketch archive/save-as, network
(mDNS) upload, and Library Manager UX changes (kept per preference).

## To ship

1. Publish `@mister-industries/shared@1.2.0` and
   `@mister-industries/tinyservice@1.1.0` from the tinyService repo, then
   bump both deps in tinyStudio's package.json. (Until then, the freshly
   built dists were copied into `node_modules/@mister-industries/*/dist` for
   local testing — `npm install` will overwrite them.)
2. `npm run fetch:language-server -- current` for LSP in dev.
3. Test on real hardware: plug/unplug detection, upload with the monitor
   open, monitor across baud changes, a failing sketch (inline errors), the
   board options gear on a tinyCore, and — if binaries fetched — completion
   and hover in the editor. The LSP client is new wiring and has not run
   against real hardware/binaries yet; treat it as experimental.
