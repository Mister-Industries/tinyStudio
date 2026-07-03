# Circuit Editor v2 — Progress Log

**Branch:** `circuit-editor` · **Spec:** `docs/circuit-view-tech-spec.md` · **Background:** `docs/circuit-architecture-and-roadmap.md`

This file is the running context for agents working on the Circuit View v2. Read the spec first; read this second; append (never rewrite history) as you land work. Keep entries terse and factual.

---

## How to work on this

- All v2 code lives in `src/renderer/src/circuit/`. **`core/` must stay React-free and Node-free** (runs in renderer, web build, workers, and tests).
- Every doc mutation is a Command (`core/commands.ts`) dispatched through `CircuitStore` (`core/store.ts`) — never mutate the doc directly; that's what gives us undo/redo for free.
- Tests: `npm run test:circuit` (bundles `circuit/__tests__/*.test.ts` with esbuild → `node --test`). Plain `node:test` + `node:assert` — no framework. Add tests with every core change; migrate to vitest only as a deliberate repo-wide decision.
- Typecheck before committing: `npm run typecheck`.
- **Enable the v2 view:** DevTools → `localStorage.setItem('tinystudio.circuitV2','1')` → reopen the Circuit tab. Unset (or `'0'`) to get the legacy DiagramEditor back. Same window slot, works in desktop and `dev:web`.
- Decisions already made (don't relitigate without Geoff): JSON `circuit.json` v2 format; greenfield module (legacy `DiagramEditor.tsx` untouched until M4 removes it); sim = ngspice-WASM behind `SimBackend`, **tscircuit's build as intended default** (M4 bake-off vs eecircuit-engine); KiCad export via circuit-json + `circuit-json-to-kicad` first; theme follows tinyStudio design system; US/IEEE symbols default; default parts pack in a new `tinyparts` repo (Mister-Industries); Fritzing CC-BY-SA art OK with per-pack ATTRIBUTION.

---

## 2026-07-02 — M0: core skeleton ✅ (this commit)

### Added

- `circuit/core/model.ts` — `circuit.json` v2 types (parts with independent `bb`/`sch` placements, per-view wires, `{wire,t}` junction ends, netLabels, sim config); `parseCircuitFile` (never throws; detects v2 / v1-tinyStudio / Wokwi by shape); **migration** from v1 `diagram.json` + Wokwi incl. `schematic.pos/routes` overlay → per-view placements/wires; stable-ordered `serializeDoc`; **unknown top-level keys preserved** round-trip (fixes B3).
- `circuit/core/routing.ts` — port of `lib/wireRouting.ts` with the **Wokwi `*` journey fix (B2)**: `decodeJourney` anchors pre-`*` at source, applies post-`*` reversed from target, auto-completes the gap. Plus `pointAtT`/`tAtPoint`/`polylineLength` for parametric junctions, `hitWire` by wire id (not index).
- `circuit/core/nets.ts` — DSU net engine over: wires (both views share nets), **junction-by-identity** (B9), part buses (`busesFor` — actually consumed now, B8 seam), same-named net labels (label virtual pin `<id>:1`), and caller-supplied **implicit connections** (breadboard seating seam for M2). One canonical key scheme (B10). `danglingJunctions` validator.
- `circuit/core/commands.ts` — pure Commands: add/place/attr/rename/delete parts, add/reroute/reconnect/recolor/delete wires, net labels, sim config, `composite`. Duplicate-wire guard incl. reversed + per-view (B5). `renamePart` rewrites wire endpoints. **`cascadeWireRemoval`**: junction riders re-anchor to the removed host's `from` (recursively), degenerate wires dropped.
- `circuit/core/store.ts` — `CircuitStore`: immutable snapshots, undo/redo (depth 200), **mergeKey** gesture collapsing (1.2 s window), `useSyncExternalStore`-ready subscribe/revision, `serialize()` echo-guard + `replaceFromFile()` (external Code-tab edits become an undoable step). Fixes B11's architecture (no per-frame file writes).
- `circuit/core/geometry.ts` — rotate/flip local→world pin transform, **snap-by-first-pin** (Fritzing behavior), `SpatialHash` for drop-to-connect/hit tests.
- `circuit/core/refdes.ts` — family→prefix map, `nextRefdes`, id validation (part ids ARE refdes).
- `circuit/index.ts` — public API + `circuitV2Enabled()` (`localStorage tinystudio.circuitV2`).
- `circuit/views/CircuitView.tsx` — M0 **read-only preview** in the real IDE slot: parses (auto-migrates in memory; the file on disk is untouched), renders bb parts + wires + junction dots on the dot-grid with zoom/pan/fit, status pills (parts/wires/nets, migration notes). Part visuals via the **legacy `partsLibrary` adapter** (temporary until the M2 registry).
- `circuit/__tests__/` — 35 tests: routing (incl. the Wokwi-docs `*` example verbatim), model round-trip/migration/key-preservation, nets (buses/junctions/labels/implicit/dangling), store (undo/redo/merge/cascades/echo), refdes.
- `scripts/test-circuit.mjs` + `package.json` `test:circuit` script.
- `EditorPanel.tsx` — 4-line flag branch mounting `CircuitViewV2` in the Circuit tab.

### State / verification

- `npm run test:circuit` → **35/35 pass**. `npm run typecheck` (node + web) → clean.
- Legacy editor untouched and default-on; v2 behind the flag.

### Known gaps / notes for the next agent

- v1 free-point junction endpoints migrate as *pending junctions* (`{wire:'', t:-1, x, y}`) — geometric resolution to `{wire,t}` must happen in the editor on first render (M1, where pin geometry exists). `CircuitView.tsx#makeResolver` already renders them via raw coords.
- The preview resolves pins through the legacy `partsLibrary` (breadboard view only, no flip support there). The v2 parts registry (M2, `circuit/parts/`) replaces this adapter.
- `deleteParts` cascade removes wires in BOTH views (correct per spec §6.1) — the M1 UI should communicate that.
- Editing is NOT wired yet — M1 is: pointer state machines (`views/canvas/`), palette, inspector, wire gestures, camera polish, save path (debounced `store.serialize()` → Redux `updateFileContent`, writing `circuit.json` + one-time `diagram.json.bak`).
- Watch out (tooling, this session): file writes through the Cowork mount occasionally truncated files / left NUL bytes — if a file looks cut off, restore via `git show HEAD:<path>` and re-apply. Verify with typecheck after bulk edits.

### Next up (M1 — breadboard editor parity)

1. `views/canvas/Canvas.tsx`: camera + pointer routing + selection/marquee.
2. Wire gestures ported from DiagramEditor behaviors (draw, bend, segment/vertex/endpoint handles, junction taps → `{wire,t}` via `tAtPoint`).
3. Part drag with `collectFrozen`-style reroutes → `placePart(…, reroutes, merge=true)`.
4. Palette + Inspector (reuse legacy partsLibrary until M2).
5. Save path + `circuit.json` adoption + `.bak` migration write.
6. Keyboard: undo/redo (Ctrl+Z/Y), delete, rotate R, nudge arrows, Esc.
7. Multi-select, copy/paste (`application/x-tinystudio-circuit`), duplicate.
8. SVG/PNG export with id-namespacing (B6) — namespacing helper belongs in `circuit/parts/svg.ts`.

---

## 2026-07-03 — M1: breadboard editor parity ✅

### Added

- `core/clipboard.ts` — copy/paste as pure doc logic: `buildClipboard` (wires kept only when every endpoint resolves inside the payload; junction riders filtered to a fixpoint), `parseClipboard` (shape-detected JSON on the system clipboard as text — custom MIME was unreliable across desktop/web), `materializePaste` (fresh refdes per prefix, endpoint/junction-host rewrite, placement offset).
- `commands.composite(label, cmds, mergeKey?)` — composites can merge, so multi-part drags collapse into one undo step.
- `model.ts` — `PendingJunctionEnd` / `isPendingJunction` formalize the v1-migration pending state.
- `parts/svg.ts` — `namespaceSvgIds` (B6), `svgNs`, `stripSvgSize`, `escapeXml`. Full sanitizer is M2.
- `views/partsAdapter.ts` — ALL geometry glue over the legacy partsLibrary (pin world positions, endpoint resolver incl. junction chains + pending, `collectFrozen`/`reroutesFor` for frozen-bend moves, `snapBB` = snap-by-first-pin per §6.3). The M2 registry replaces only this file's imports.
- `views/canvas/Canvas.tsx` — the M1 editor: camera (wheel-zoom-at-cursor, middle/Alt pan, left-pan in view mode, fit), marquee + shift multi-select, wire drawing (pin→pin, junction taps store `{wire,t}` via `tAtPoint`, Shift straight, click bends, Esc), selected-wire handles (segment ⊥-drag, vertex, endpoint; endpoint drop must land on a pin or wire — reverts on empty space since v2 has no free endpoints), double-click add/remove bend, part drag (multi-part; wires between two moved parts translate their bends, others hold world-space), label drag → `Placement.labelOffset`, right-click/R rotate, arrow nudge (Shift=5×), Del cascade, Ctrl+Z/Y, Ctrl+C/X/V/D. Pending junctions resolve to `{wire,t}` on first render once part defs load (one undoable "Resolve migrated junctions" step; unresolvable ones stay pending and render at their raw coordinate).
- `views/palette/Palette.tsx`, `views/inspector/Inspector.tsx` — ported rail + inspector; inspector edits refdes (rename validated + wires rewritten), display label (attrs.label), location/rotation (with reroutes), attrs; wire color/net info; multi-select summary.
- `views/CircuitView.tsx` — shell owns the store; **save path**: revision subscription → debounced 250 ms `store.serialize()` → `onChange` → Redux `updateFileContent` (disk write stays on Ctrl+S like all buffers). External Code-tab edits fold in as an undoable step; the echo guard + a `skipSaveRev` marker prevent both loops and reformat-under-cursor.
- `views/exportImage.ts` — standalone scene SVG (id-namespaced per instance), `.svg` download + `.png` @2×, watermark.
- `EditorPanel.tsx` — v2 branch split into `CircuitV2View` (adoption) → `CircuitV2Inner` (buffer): on first open with only `diagram.json`, writes migrated `circuit.json` + verbatim `diagram.json.bak`, refreshes the tree, then opens `circuit.json` as the hidden buffer. **Deviation from spec §4:** `diagram.json` is left in place (not renamed) until M4 removes the legacy editor, so flipping the flag off keeps working.
- Tests: +18 (53 total) — clipboard rules/paste re-iding, svg namespacing, composite mergeKey collapse, placePart reroutes, pending-junction typing/resolution.

### State / verification

- `npm run test:circuit` → **53/53**. `npm run typecheck` (node + web) → clean.
- Committed as 4 chunks: core (f12699a), svg/export (61d3c9a), views (9a98df9), integration+log (this commit).

### Known gaps / notes for the next agent

- Camera is NOT persisted to `doc.camera` (writing it would dirty the file on pan; needs a non-undo side channel — decide in M3 when the second view needs per-view cameras anyway).
- Pin hit targets are fixed 16 world px (legacy parity), not the B23 min-10-screen-px rule — revisit with the M2 registry.
- Legacy `partsLibrary` has no `buses`, so `buildNets` runs without `busesFor` in the view (bus seams are wired in core and tested; M2 turns them on).
- Clipboard rides `text/plain` JSON with a format marker instead of `application/x-tinystudio-circuit` (Chromium custom-type restrictions in the web build); cross-project paste works.
- PartsEditor still saves via `registerPart` (in-memory, B7) — persistence is an M2 item.
- Wire-end plug-into-hole (wire-end as male pin) needs real breadboard parts — M2 drop-to-connect.
- **Tooling (this session, worse than last time):** Write/Edit through the Cowork mount truncated files to their PREVIOUS byte length whenever an edit GREW a file (commands.ts, model.ts, index.ts, EditorPanel.tsx, CircuitView.tsx all hit; one NUL-padded). `.git/index` also corrupted once (`bad signature 0x00000000` → `rm .git/index && git reset`). Reliable path: write files from the LINUX side (bash heredoc / python replace), verify with a NUL+tail scan, keep typecheck as the gate.

### Next up (M2 or M3 — parallelizable per spec §15)

- M2: procedural breadboards + drop-to-connect + legs; `.fzpz` import; Part Editor v2 persistence; pack manager + GitHub index install; regenerate default pack (buses/pinType/legs).
- M3: schematic view (needs M0/M1 only): view toggle, symbols, unplaced tray + ratsnest, net labels/ground, flip/mirror, ERC panel.

---

## 2026-07-03 (later) — M1 fix: image export

Geoff's testing found SVG export rendering symbols wrong and PNG export dead. Root cause (probed in Node with the Blink demo): Fritzing part SVG roots carry their own `x="0px" y="0px"` (and width/height) — the composer's injected placement attributes duplicated them → **invalid XML**. The in-app canvas tolerates it (lenient HTML parser); the standalone `.svg` and the PNG rasterizer's strict XML parse both fail. Fixes: `prepareSvgForEmbed` (strips prolog/doctype + root x/y/width/height, keeps viewBox) replaces `stripSvgSize` in the exporter; `namespaceSvgIds` now also rewrites `#id` selectors in `<style>` blocks; `resolveCssVars` inlines `var(--…)` design tokens (builtin board art) at export time; PNG rasterize failure logs instead of dying silently. Probe validates the composed scene parses clean. 56/56 tests.
