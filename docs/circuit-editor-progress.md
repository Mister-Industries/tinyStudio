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
