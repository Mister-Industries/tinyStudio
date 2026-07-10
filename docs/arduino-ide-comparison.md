# tinyStudio vs. Arduino IDE 2.x — Core Functionality Comparison

**Date:** July 2, 2026
**Scope:** Core IDE functionality only (editing, building, uploading, board/port handling, serial monitor, library/board management). The Visual and Circuit views are intentionally excluded.
**Sources compared:** `tinyStudio` (v0.2.0, this repo, plus the `@mister-industries/tinyservice` backend it ships) and `arduino-ide` (v2.3.11, `arduino-ide-extension` sources).

---

## 1. Executive Summary

tinyStudio covers a solid slice of the Arduino IDE's core loop: verify, upload, serial monitor, connected-board detection, a Library Manager, and a Boards Manager with additional-URL support. The largest functional gaps are in **code intelligence** (Arduino IDE runs a full clangd-based language server; tinyStudio has a regex syntax highlighter), **board/port architecture** (Arduino IDE has an event-driven port watcher, per-port monitor services, board options, programmers, and manual board selection; tinyStudio has a polled snapshot with a combined board+port dropdown), and the **serial monitor pipeline** (Arduino IDE uses arduino-cli's gRPC monitor API with pause/resume around uploads and persisted per-port settings; tinyStudio spawns and kills `arduino-cli monitor` CLI processes and filters its text output).

The device-detection and monitor-switching behavior you've noticed is not a tuning issue — the two products use fundamentally different mechanisms. Arduino IDE talks to a long-lived `arduino-cli daemon` over gRPC and *subscribes* to port add/remove events (`BoardListWatch`), so plug/unplug appears within ~100 ms. tinyStudio shells out to `arduino-cli board list` on a timer that **stops polling once one board is found**, so unplugs and port changes go unnoticed until a manual refresh. Details in §3.

Several concrete state bugs were found in tinyStudio's serial path, including a false "connected" status sent before the port actually opens, a filter that swallows the port-busy error message, a stale process-close handler that can delete the *new* monitor's registration, and an auto tab-switch that hides compile errors 400 ms after a failed build. Details in §5.

---

## 2. Architecture: How Each IDE Talks to arduino-cli

This difference explains most of the behavioral gaps, so it's worth stating plainly.

**Arduino IDE 2.x** starts `arduino-cli daemon` once and keeps a persistent **gRPC** connection to it (`node/arduino-daemon-impl.ts`, `node/core-client-provider.ts`). Every operation — compile, upload, board list, monitor — is a gRPC call or a long-lived gRPC *stream* against that daemon. Streams matter: the daemon pushes port events and monitor data to the IDE the instant they happen, requests carry structured protobuf payloads (no text parsing), progress is reported natively, and operations are cancellable.

**tinyStudio** spawns a fresh `arduino-cli <subcommand>` child process per operation (`tinyservice/services/arduino-cli.service.js`) and parses its stdout — JSON for lists, raw text for everything else. The renderer talks to tinyService over a local WebSocket, and responses are correlated to requests **by action name only** — there are no request IDs (`WebSocketArduinoService.waitForResponse()`). The CLI-per-call model means every board scan pays process startup cost, there is no push channel for hardware events, upload progress must be faked (see Bug 9), and two in-flight requests with the same action name will cross-talk.

This isn't a demand to rewrite on gRPC — arduino-cli's daemon mode is exactly what it exists for, and adopting it (or at least `board list --watch`, which streams JSON events over stdout **without** the daemon) would close the biggest gaps at moderate cost.

---

## 3. Device Detection — Why Arduino IDE Feels Better

**Arduino IDE** (`node/board-discovery.ts`): a singleton backend service opens a `BoardListWatch` gRPC stream at startup. The CLI's pluggable discoveries (serial, mDNS, etc.) push `add`/`remove` events; the IDE debounces them for 100 ms, diffs against current state, and broadcasts to the frontend. Consequences:

- Plug in a board → it appears in the toolbar within ~100 ms. Unplug → it disappears just as fast.
- Ports that change address after upload (native-USB boards like your ESP32-S3 re-enumerate when the sketch resets) are tracked as remove+add events, and the IDE re-associates the selected board with the new port (`boards-service-provider.ts`).
- Network (mDNS/OTA) boards are discovered too, not just serial ports.
- The selected board + port are persisted per window and restored on restart (`selectedBoardStorageKey` in `boards-service-provider.ts`).
- If a detected board's platform isn't installed, the IDE prompts to install it (`boards-auto-installer.ts`).
- Ports with no identifiable board can still be used: the "Select other board and port" dialog lets the user manually pair any FQBN with any port (`boards-config-dialog.tsx`), and that pairing is remembered.

**tinyStudio** (`useArduino.ts`, `arduino-cli.service.js#listBoards`): runs `arduino-cli board list` as a one-shot snapshot. Polling only runs **while zero boards are known** (every 8 s) and stops as soon as one is found — the comment in `useArduino.ts:585` says plug/unplug after that "is picked up by the manual Refresh or the next operation." On top of that, `WebSocketArduinoService.listBoards()` throttles to one real scan per 5 s and silently serves a cached list otherwise. Consequences, all of which match the symptoms you described:

- Unplugging the selected board is never detected; the UI keeps showing it as connected until an upload fails.
- Swapping boards, or a board re-enumerating on a different COM port after flash, is invisible until manual refresh.
- Clicking Refresh within 5 s of the last scan animates the spinner but returns the stale cache.
- Unknown VID/PID devices are guessed by a hardcoded table (`identifyByUsb`) — any Espressif VID `303A` is labeled a tinyCore, and CP210x bridges produce a board with an **empty FQBN** that will fail to compile if selected. There is no manual board-to-port pairing to correct a wrong guess.
- Nothing is persisted; board selection resets every launch.

**Recommendation:** replace the poll with `arduino-cli board list --watch --format json` (a long-lived child process that streams add/remove events as JSON lines — no gRPC required), keep the port list in tinyService as the single source of truth, and push changes to the renderer over the existing WebSocket. Remove the 5 s cache once events are push-based. Add a "choose board for this port" flow instead of the `identifyByUsb` guess table.

---

## 4. Serial Monitor — Why Arduino IDE Switches Cleanly

**Arduino IDE** (`node/monitor-manager.ts`, `node/monitor-service.ts`): each board+port combination gets its own `MonitorService` keyed by `fqbn-address-protocol`, using arduino-cli's **gRPC monitor stream** (not the `monitor` CLI command). Key behaviors:

- **Upload coordination is first-class.** `notifyUploadStarted()` *pauses* the monitor (releases the port, keeps the service and its buffer/state alive); `notifyUploadFinished()` resumes it — and if the board came back on a *different* port, it stops the old service and starts a queued one on the new port. Monitor open requests that arrive mid-upload are queued, then started only after verifying the board is still present.
- **Settings are real and persisted.** Baud rates come from the board's pluggable monitor (`enumerate_port_settings`), so the list is board-appropriate rather than hardcoded. Baud, line ending (None/NL/CR/Both NL&CR), autoscroll, and timestamps are persisted per port (`node/monitor-settings/`, `browser/monitor-model.ts`).
- **Raw data fidelity.** The stream delivers bytes as-is to the frontend; timestamps are applied at render time; nothing is trimmed or filtered.
- There is also a **Serial Plotter** fed by the same monitor stream (`browser/serial/plotter/`).

**tinyStudio** (`tinyservice/handlers/serial.handler.js`, `SerialContext.tsx`): opening the monitor spawns an `arduino-cli monitor -p <port>` child process; closing kills it (`taskkill /T /F` on Windows). The renderer keeps one app-level connection (`SerialProvider`) that auto-opens whenever a board is selected. Functional gaps against the IDE:

- Only five hardcoded baud rates (9600–115200); missing 300–4800, 19200, 74880 (ESP boot messages), 230400, 460800, 921600, 2000000, and anything board-specific.
- No line-ending choice — every send unconditionally appends `\n` (`serial.handler.js:12`).
- No timestamps option; no persistence of baud/autoscroll across restarts (baud resets to 9600).
- Output is line-ified and sanitized: every chunk is split on newlines, each line is trimmed, blank lines are dropped, and any line starting with `Connected to`, `Disconnected`, etc. is discarded — so sketches that print those words, print leading whitespace, use `\r`-based progress output, or use `Serial.print()` without newline get visibly distorted output.
- No Serial Plotter.
- The port is held continuously while a board is selected (auto-open on selection). This also DTR-resets the board every time the app starts or the port reopens. Arduino IDE only opens the port while the monitor is actually in use.
- Because open/close is kill-and-respawn of a CLI process rather than pause/resume of a service, every upload/baud-change/reconnect pays process startup, reset, and the race conditions described in §5.

---

## 5. Bugs and State Issues Found in tinyStudio

These are concrete defects observed in the current code, roughly ordered by impact. Items 1–5 together explain the "weird COM port state" you've been seeing.

**1. "Connected" is reported before the port actually opens.**
`serial.handler.js:70-74` sends `{opened: true}` ("Listening on PORT @ BAUD") immediately after `spawn()`, before arduino-cli has opened the port. If the port is busy or gone, the UI flashes connected, then flips to disconnected when the child exits — with no error shown, because of Bug 2.

**2. The output filter swallows the actual error messages.**
The same handler's `emit()` filter (lines 36–43) deliberately drops lines containing `Port monitor error` and `command 'open' failed`. Those are exactly the lines arduino-cli prints when the port is busy or missing. Net effect: a failed monitor open is completely silent — combined with Bug 1, the user sees "connected… disconnected" with no explanation.

**3. Stale close-handler can delete the *new* monitor's registration (Windows-biased race).**
`SerialHandler.close()` kills the old child and resolves on its `exit` event **or a 1.5 s fallback timeout** — on Windows the kill is an async `taskkill /T /F` whose result is ignored. If the old process outlives that window (slow taskkill, exclusive-port teardown), the new monitor is spawned and stored in `this.monitors` under the same connection ID; when the old child finally dies, its still-attached `close` handler runs `this.monitors.delete(connection.id)` — deleting the **new** child's entry — and pushes `{closed: true}` to the client. Result: UI shows disconnected while data still streams, `serial-write` silently no-ops (no child found), and the orphaned entry can't be closed cleanly. While the old process lingers it also still holds the COM port, so the new spawn hits Bug 1 + Bug 2. Fix: key handlers to the specific child (compare `this.monitors.get(id) === child` before deleting/emitting), and don't reuse the connection ID as the sole key.

**4. Unplug/replug is undetected while a board is selected.**
`useArduino.ts:585-592` — the 8 s poll only runs when `boards.length === 0`. Once a board is listed, hardware changes are invisible (see §3). The stale selection then feeds uploads to a dead port and monitor opens to a dead port (which fail silently per Bugs 1–2).

**5. Refresh within 5 s returns cached results while claiming a fresh scan.**
`WebSocketArduinoService.listBoards()` throttle (5 s) returns `cachedBoardList` silently; `refreshBoards()` still logs "Scanning for connected boards… Found N board(s)". The user's replugged board doesn't appear even though they explicitly asked for a rescan.

**6. Failed compile output is hidden 400 ms after the build finishes.**
`SerialMonitor.tsx:38-45` — when `isCompiling || isUploading` goes false, the panel switches back to the Serial tab after 400 ms **unconditionally**, including on failure. The user gets a red toast, but the Output pane with the actual compiler errors is yanked away. It also overrides the tab the user selected manually. Arduino IDE keeps the Output panel up and additionally renders errors inline in the editor. Fix: only auto-return to Serial on *success*, and never if the user manually switched tabs during the build.

**7. Response cross-talk: no request IDs on the WebSocket protocol.**
`waitForResponse()` matches replies by action string alone. Two overlapping `lib-search` calls (easy to trigger by typing in the Library Manager), or `list-boards` from two code paths, will interleave and resolve each other's promises with mixed output. Needs a per-request ID echoed by tinyService.

**8. Every `tinyCore:*` FQBN is collapsed to one board variant.**
`normalizeTinyCoreFqbn()` (`WebSocketArduinoService.ts:80-85`) rewrites *any* detected tinyCore FQBN to `tiny_core_esp32s3_nopsram`, and `identifyByUsb()` claims every VID `303A` (all native-USB Espressif chips) as a tinyCore. Any future tinyCore variant — or any other ESP32-S2/S3/C3 board — gets compiled for the wrong target with no way to override. Related: CP210x devices are surfaced with `fqbn: ""`, which is selectable and then fails at compile time.

**9. Upload progress bar is fake.**
`useArduino.ts:418-432` — a `setInterval` bumps the percentage by 10 every 200 ms up to 90%. It reflects wall-clock time, not the actual flash. arduino-cli reports real upload progress (the IDE consumes it via gRPC); at minimum, esptool's stdout percentages could be parsed from the streamed output.

**10. Timeout "success sniffing" doesn't match your own boards.**
`waitForResponse()`'s timeout fallback (lines 195–211) infers a successful upload from `avrdude done` / `Upload complete` — AVR-only strings. ESP32 uploads (tinyCore's own target) end with esptool's `Hash of data verified` / `Hard resetting`, so a slow-but-successful ESP32 upload that hits the 90 s timeout is misreported as a failure.

**11. Stale-closure bugs in the timeout-recovery paths.**
`compileSketch` reads `lastCompileResult` (line 337) and `uploadSketch` reads `lastUploadResult` (line 501), but neither is in its `useCallback` dependency array — the recovery logic always sees the value from when the callback was created. Low impact (only affects the timeout paths), but worth fixing while in there.

**12. tinyService binds port 3000 with no fallback.**
`ServiceManager` hardcodes `ws://localhost:3000`. If any other dev server holds 3000, the backend fails and the app reports the agent as offline. A port scan + handoff of the chosen port to the renderer (it already supports a `tinyservice.url` override) would fix this.

**13. Double/ambiguous `closed` events.**
On `serial-close`, both the handler's explicit `complete/closed` reply and the child's own `close` event handler fire `{closed: true}` messages, and the server's upload path (`websocket.service.js:90-95`) sends a third variant. Harmless today because the reducer is idempotent, but it makes ordering bugs like #3 harder to see and debug.

---

## 6. Feature Gap Matrix

Legend: ✅ present · 🟡 partial · ❌ missing. "Ignoring" cloud accounts and Arduino Cloud sync as non-core.

### 6.1 Code Editing & Intelligence

| Feature | Arduino IDE 2.x | tinyStudio |
|---|---|---|
| Syntax highlighting | ✅ semantic (clangd) | 🟡 regex tokenizer (`MonacoEditor.tsx`); no user-library symbols |
| Code completion | ✅ Arduino Language Server (clangd, board-aware) | 🟡 Monaco word-based suggestions only |
| Go to definition / hover docs / signature help | ✅ | ❌ |
| Live diagnostics while typing | ✅ | ❌ |
| Compile errors shown inline in editor (squiggles + jump) | ✅ (`compiler-errors.ts`, `cli-error-parser.ts`) | ❌ errors only as text in Output pane |
| Auto-format (ClangFormat, Arduino style, `.clang-format` override) | ✅ Ctrl+T | ❌ |
| Find/replace in file | ✅ | ✅ (Monaco built-in) |
| Find across sketch/workspace | ✅ | ❌ (no UI) |
| Auto-save | ✅ (default on) | 🟡 manual Ctrl+S; dirty buffers are flushed before Verify/Upload |
| Multi-file sketch tabs (.ino/.h/.cpp) | ✅ | ✅ |
| Undo history preserved across tab switches | ✅ | ✅ (`keepCurrentModel`) |

### 6.2 Boards, Ports & Detection

| Feature | Arduino IDE 2.x | tinyStudio |
|---|---|---|
| Event-driven port watch (instant plug/unplug) | ✅ gRPC `BoardListWatch` | ❌ snapshot polling, stops after first board (§3) |
| Port re-association after upload re-enumeration | ✅ | ❌ |
| Manual "select other board and port" pairing | ✅ dialog, searchable, remembered | ❌ only auto-detected entries selectable |
| Separate board vs. port selection | ✅ | ❌ combined; `PortSelect` is a disabled stub |
| Board/port persisted across restarts | ✅ | ❌ |
| Board options (Tools menu: PSRAM, partition, CPU freq, etc.) | ✅ `boards-data-store.ts`, FQBN options | ❌ FQBN fixed; tinyCore variants collapsed (Bug 8) |
| Programmer selection / Upload Using Programmer | ✅ | ❌ |
| Burn Bootloader | ✅ | ❌ |
| Prompt to install missing platform for detected board | ✅ `boards-auto-installer.ts` | 🟡 auto-installs esp32 + tinyCore only, at startup |
| Network/OTA (mDNS) board discovery + upload | ✅ | ❌ serial only |
| Board details view (VID/PID etc.) | ✅ | ❌ |

### 6.3 Build & Upload

| Feature | Arduino IDE 2.x | tinyStudio |
|---|---|---|
| Verify / Upload with streamed output | ✅ | ✅ |
| Real upload progress | ✅ gRPC progress | ❌ simulated (Bug 9) |
| Cancellable compile/upload | ✅ | ❌ no cancel; UI locked until timeout |
| Verbose output toggle, warning-level prefs | ✅ preferences | ❌ |
| Export compiled binary / build path access | ✅ | ❌ |
| Monitor paused & resumed around upload (incl. port change) | ✅ `monitor-manager.ts` | 🟡 closed before upload (client + server), reopened by effect; kill/respawn races (§5) |
| Serial-port auth / user fields for upload | ✅ | ❌ |
| Firmware & certificate uploader (WiFi radios) | ✅ | ❌ |
| Debugging (hardware debug via arduino-cli debug) | ✅ | ❌ |

### 6.4 Serial Monitor & Plotter

| Feature | Arduino IDE 2.x | tinyStudio |
|---|---|---|
| Serial Monitor | ✅ gRPC stream service | 🟡 spawned `arduino-cli monitor` process (§4) |
| Board-specific baud list | ✅ from pluggable monitor | ❌ 5 hardcoded rates |
| Line-ending selector (None/NL/CR/NL+CR) | ✅ | ❌ always `\n` |
| Timestamps toggle | ✅ | ❌ |
| Settings persisted per port | ✅ | ❌ |
| Raw output fidelity (whitespace, partial lines, CR) | ✅ | ❌ trimmed/filtered/line-split (§4) |
| Serial Plotter | ✅ | ❌ (Visual view exists but is out of scope per your note) |
| Monitor usable while no sketch open | ✅ | ✅ |

### 6.5 Sketch, Library & Platform Management

| Feature | Arduino IDE 2.x | tinyStudio |
|---|---|---|
| New sketch / open / save | ✅ | ✅ (project dialog + file explorer) |
| Save As, rename, archive sketch (.zip), delete | ✅ | ❌ (file-explorer rename/delete of files, but no sketch-level ops) |
| Recent sketches / sketchbook view | ✅ | ❌ no recent-projects list; reopen via folder picker each time |
| Examples menu from installed cores & libraries | ✅ auto-generated | 🟡 curated `examples.json` only |
| Include Library (auto-insert `#include`) | ✅ | ❌ |
| Add .ZIP library | ✅ | ❌ |
| Library Manager (search/install/uninstall/version) | ✅ | ✅ (`LibraryManager.tsx`) |
| Library type/topic filters, update-all | ✅ | ❌ |
| Boards Manager + additional URLs | ✅ | ✅ (`BoardManager.tsx`) |
| Index auto-update + progress UI | ✅ | 🟡 update on URL add only |
| Open sketch in external editor / reveal in OS | ✅ | ❌ |

*(Not itemized: Theia platform niceties — command palette, keyboard shortcut editor, i18n, interface scaling. Real, but lower priority.)*

---

## 7. Prioritized Recommendations

1. **Switch board detection to `arduino-cli board list --watch --format json`** streamed from tinyService, and delete the 8 s poll + 5 s cache. This single change fixes Bugs 4–5 and closes most of the perceived detection gap. (§3)
2. **Fix the serial monitor lifecycle** (Bugs 1–3): only report `opened` after arduino-cli confirms the port, stop filtering error lines (surface them as `error` messages instead), and bind child-process event handlers to the specific child instance. Consider arduino-cli's daemon/gRPC monitor as the longer-term replacement for kill-and-respawn.
3. **Stop hiding failed builds** (Bug 6): keep the Output tab up on failure; parse `file:line:col` from compiler output and set Monaco markers so errors appear in the editor — this is cheap with `monaco.editor.setModelMarkers` and gets you 70% of the IDE's inline-error value.
4. **Add request IDs to the tinyService protocol** (Bug 7) — prerequisite for everything else being reliable under concurrency.
5. **Board options + manual board selection**: expose FQBN config options (arduino-cli reports them via `board details`) and a "choose board for this port" dialog; remove the `303A → tinyCore` assumption and the FQBN collapse (Bug 8).
6. **Monitor UX parity**: full/board-derived baud list, line-ending selector, timestamps, persist settings per port. All small, all frontend + one handler.
7. **Adopt the Arduino Language Server** (`arduino-language-server` + clangd, both distributed as binaries like arduino-cli): Monaco speaks LSP via `monaco-languageclient`. This is the single biggest step toward "everything Arduino IDE does" in the editor.
8. Quality-of-life follow-ups: real upload progress (parse esptool percentages or use gRPC), cancellable operations, ESP32-aware success strings (Bug 10), port-3000 fallback (Bug 12), Include Library / Add .ZIP, sketch archive/save-as.
