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

- v1 free-point junction endpoints migrate as _pending junctions_ (`{wire:'', t:-1, x, y}`) — geometric resolution to `{wire,t}` must happen in the editor on first render (M1, where pin geometry exists). `CircuitView.tsx#makeResolver` already renders them via raw coords.
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

---

## 2026-07-03 (later) — M2 core + M3 core ✅ (breadboards, drop-to-connect, schematic view)

### M2 core (commit a0f3ccd)

- `parts/breadboard.ts` — parametric generator (`breadboard-mini`/`-half`/`-full`), holes on the GRID_BB pitch, per-column bank buses + rail buses (`breadboardBuses`), generated SVG. Registered into the legacy partsLibrary at view mount.
- `partsAdapter.implicitSeats()` — derived pin-in-hole seating (SpatialHash, radius = ½ pitch); `seatedPartsOn` (sticky boards); `holeAt`.
- Canvas: boards skip per-pin divs (>60 pins) — press-without-displacement = hole interaction (wires can start/end on holes), board drags carry seated parts, hole hover shows highlight + `hole · net members` tooltip, green seat marks. Net model runs with `busesFor` + implicit seats.

### M3 core (this commit)

- `parts/symbols.ts` — generated IC-box schematic symbols (label on top, pins left/right in definition order, 9.6 grid, ink = `var(--text-strong)`); `schematicVisual` prefers authored art.
- `partsAdapter` is now **view-generic**: `visualFor/pinWorldOf/makeEndResolver/wireGeometry/viewBounds/collectFrozen/reroutesFor/snapBB/pinAtWorld` all take a `ViewId` (default `'bb'`; `bbVisual`/`bbWireGeometry`/`bbBounds` kept as aliases). `ratsnest()` computes unrouted-here bridges: global net groups by this-view-only connectivity (bb counts seating as routed), greedy nearest-group bridging.
- Canvas takes `view`: per-view placements/wires/snap (sch wires bend on the 4.8 fine grid, parts snap pins to 9.6), sch wires ink + orthogonal-only (Shift-straight is bb-only), junction dots ink in sch, flip (F key + Inspector mirror button, sch only, CSS `scaleX(-1)` matching `transformLocalPoint`), ratsnest dashed layer, seats/holes gated to bb. Canvas is remounted per view (`key={view}`) so gesture state can't leak across views.
- Shell: **Breadboard | Schematic** toggle (top-center), **unplaced tray** (chips for parts placed only in the other view; click = place at viewport centre — spec wants attach-to-cursor, simplified for now), status pill gains `routed here: k/n`, per-view part adds (palette/drop place into the active view), exports hidden in sch (composer is bb-only for now). Inspector is view-aware (location/rotation/flip act on the active view's placement).
- Tests: 63 total (breadboard geometry/buses/net integration; symbol grid/split/caching).

### Deferred (still open from M2/M3 scope)

- M2: `.fzpz` drop-import, pack manager + GitHub index install, Part Editor v2 persistence (B7), bendable legs, default-pack regeneration, "all pins must seat" rigid-translation rule (we seat per-pin on grid match).
- M3: net labels / ground symbols UI (nets engine + model support already exist and are tested — needs palette entries, canvas rendering of `netLabels`, label pin wiring), ERC panel, attach-to-cursor tray placement, schematic-styled canvas background (currently same dot grid), sch-view image export.

### Verification

- `npm run test:circuit` → **63/63** · `npm run typecheck` → clean · NUL scan clean (all writes done Linux-side per the tooling note above).

---

## 2026-07-05 — bug-fix pass (Geoff's testing feedback)

Five fixes, all in the editor layer (no core/model changes). `npm run typecheck` clean · `npm run test:circuit` → 63/63.

- **Breadboards are transparent on the schematic.** They no longer appear as a placeable/`U1` part in the schematic — only their row/rail buses still merge nets globally. Three-part fix: `refdes.ts` now matches `FAMILY_PREFIX` keys longest-first so `breadboard` wins over `board` (`BB1`, not `U1`); `CircuitView` drops breadboards from the "unplaced here" tray in the sch view; `Canvas` render loop skips `isBreadboard` parts when `view === 'sch'`. Added a `prefixForFamily` guard test.
- **Rigid breadboard rotation.** Rotating a breadboard (right-click, or `R` with a lone board selected) now turns the board, its seated parts, and the wires _between_ seated parts as one rigid assembly about the board's centre — layout is preserved instead of the wires rerouting. Uses `reroutesFor`'s `transformBoth` hook (rot90-about-centre) for both-ends-on-board wires; seated parts get their centres rotated + `rotate += 90`. Grid-aligned seating means holes map to holes, so pins re-seat exactly. New `rotateBoardAssembly` helper in `Canvas`; `rotateSelection` and the board context-menu delegate to it. (Wires with only one end on the board still reroute — expected, that end left the assembly.)
- **Straight-wire modifier moved Shift → Space.** Shift is now free for shift-select while drawing on a breadboard. Space was previously bound to rotate; rotate is now `R`/right-click only. Keydown on Space `preventDefault`s to stop page scroll; status hint updated ("hold Space for straight", bb only).
- **Schematic wires thinned, glow/border removed.** New `WIRE_SCH_W = 1` (was the shared `2.8`, ~3× too thick). In the sch view the color-outline path and the persistent border are dropped — a single thin ink stroke. A transparent fat stroke is layered under every wire so the thin line stays clickable. The net-highlight glow is kept but slimmed in sch.
- **Connected pins drop their yellow "open lead" dot.** A pin whose net has ≥2 members (wired or seated) is `connected`; its dot is hidden unless armed/hovered (then brand-colored) or its net is highlighted. Open leads still show yellow. Hit target is unchanged, so connected pins remain clickable to re-wire.

### Known gaps / notes for the next agent

- The **Inspector's** rotate button/dropdown still rotates a breadboard in place (it has no `seats` context), so it will reroute wires the way the canvas gestures no longer do. Low-traffic path; wire it through `rotateBoardAssembly` (or lift the helper to the shell) if it comes up.
- **Tooling (unchanged, still biting):** Write/Edit through the Cowork mount truncated `Canvas.tsx` and `store.test.ts` to their previous byte length when an edit grew them — the Windows-side file tool showed the full file while the Linux mount (where tsc/tests/git run) was cut off mid-block. Reliable path confirmed again: reconstruct the whole file from `git show HEAD:<path>` + Python `.replace()` written **Linux-side** with `newline='\n'`, then verify with `awk 'END{print NR}'` + `tail`. Also hit a stale `.git/index.lock` (`unable to unlink … Operation not permitted`) that made `git diff` go silent — diff against `git show HEAD:` instead.

---

## 2026-07-05 (later) — M3 complete: net labels, ERC, schematic polish ✅

Closes the remaining M3 scope (schematic view). All work is in `circuit/` behind the flag. `npm run typecheck` clean · `npm run test:circuit` → **71/71**.

### Net labels / ground (spec §8.4)

- `parts/netLabels.ts` — generated glyphs for the three kinds: `ground` (three-bar), `power` (up-flag with rail name, e.g. 5V/3V3), `net` (named tag). Single connection pin `"<id>:1"`, pin-on-grid via `snapNetLabel`, cached. `NET_LABEL_KINDS` drives the palette.
- The net engine already merged same-named labels (`core/nets.ts` §4) — this session added the geometry/UI: `commands.moveNetLabel` / `updateNetLabel`; `makeEndResolver` now resolves label pins in the schematic (labels are wire-connectable like any pin); `Canvas` renders the glyphs (sch only), starts/ends wires on a label pin, drags a label with live wire reroutes, selects (new optional `Selection.labels`) and deletes them.
- Palette gained a **Net Labels** section (sch only) — drag or double-click to add. `Inspector` shows a label editor (net name + kind, delete) when a label is selected. Add flow in `CircuitView.addNetLabel`; drop routes through `Canvas.onDropNetLabel`.

### ERC (spec §9)

- `core/erc.ts` — net-model rule checks (pure, tested): **rail short** (two named rails/grounds on one net → error), **floating net label** (placed but unwired → info), **missing ground** (power rails but no GND → info), **dangling junction host** (error, reuses `danglingJunctions`).
- `partsAdapter.ercFloatingPins` — view-side floating-pin finding (needs pin geometry); only flags _partially_ connected parts to avoid noise.
- `CircuitView` — an **ERC pill** in the status row (clean / err·warn·info counts) toggles a non-blocking findings panel; clicking a row selects the offending part/wire/label.

### Schematic polish

- Canvas background is now paper (`--bg`) with a finer dot grid in the schematic (spec §8.1); breadboard view unchanged.
- **Attach-to-cursor tray:** clicking an "unplaced here" chip arms placement (chip highlights, hint changes) and the next canvas click drops the part at the cursor — replaces the old drop-at-centre. `Canvas` gained `placingId` / `onCanvasPlace`.
- **Schematic image export:** `exportImage.composeSceneSvg` is now view-generic — ink single-stroke wires, generated symbols, net-label glyphs, part flip; breadboards omitted in sch. Export buttons show in both views (`exportSvg/exportPng(doc, view)`), filenames `circuit-schematic.{svg,png}`.

### Tests (+8, 71 total)

- `netLabels.test.ts` (glyph pins, grid snap), `erc.test.ts` (rail short, floating label, missing ground), `exportSch.test.ts` (sch compose: ink wires + label glyphs, balanced SVG tags, graceful null).

### Deferred (out of M3 scope → M4/M5)

- Solder-dot rendering at genuine T-junctions is via the existing junction-dot layer; 4-way-crossing "never auto-join" hygiene (spec §8.1) is not specially enforced yet.
- ERC's `erc` pin-type rules (shorted `power-out`↔`power-out`, LED-without-series-R heuristic) need typed pins from the M2 parts pipeline — current pins carry no `erc` metadata, so those checks are stubbed out (not emitted) rather than guessed.
- Net-label rotation is supported in the model/geometry but has no keyboard/inspector control yet (drag + delete only).

### Notes for the next agent

- `Selection` grew an optional `labels: Set<string>`; most construction sites omit it (treated empty). Marquee/rubber-band does **not** yet grab labels — click / shift-click only.
- Pre-existing lint: `Canvas.tsx` (`emptySel`) and `Palette.tsx` (`WIRE_COLORS`) trip `react-refresh/only-export-components` (colocated helpers) — unchanged by this work; gates remain typecheck + `test:circuit`.
- Tooling: same Cowork-mount truncation gremlin — every file this session was written Linux-side (bash heredoc / Python `.replace`, `newline='\n'`) and verified with `awk NR` + `tail`. The stale `.git/index.lock` is still unremovable from the sandbox, so this work is **uncommitted** on `circuit-editor` (see file list below).

---

## 2026-07-05 (later) — editor UX pass (Geoff's feedback round 2)

Eleven fixes across the circuit editor + app shell. `npm run typecheck` clean · `npm run test:circuit` → 71/71.

### Placement & interaction

- **Collision-avoidance placement** (`partsAdapter.occupiedBoxes` / `findFreePlacement` / `freePasteOffset`): new parts, tray placements, and copy/paste all spiral out on the grid to a slot that clears existing parts, net labels, and wire segments — parity with the pre-rewrite editor. `addPartAt` and paste now route through these.
- **Unplaced tray auto-places** (reverting the click-then-click attach-to-cursor): clicking a tray chip drops the part straight onto a free slot _and_ flips the view into edit mode so it can be dragged immediately.
- **Double-click any component → edit mode** (`Canvas.onRequestEdit`, wired to `CircuitView.enterEdit`): double-clicking a part or net label in view-only mode enters edit mode.

### Visuals

- **View-aware palette icons** (`Palette.iconFor`): the components rail shows schematic symbols in the schematic view, breadboard art in the breadboard view.
- **Black part legs** (`partsAdapter.blackenLegs`): Fritzing legs are baked into the art as `<line id="connectorNleg" … stroke="#8C8C8C"/>`; we recolor those leg strokes to ink (`#1A1A1A`) at render time (cached). Only leg elements are touched.
- **Bigger watermark** (canvas + image export): ~5× larger, thin `tiny` + bold `Studio` to match the header wordmark; export uses `<tspan>` weights and extra bottom padding.
- **Cleaner status area**: dropped the persistent "Parts/Wires/Nets" pill and the idle "Scroll to zoom" / "View-only" hint bubbles. One compact warning bubble appears only when there's something to fix (unplaced parts · unwired nets · ERC err/warn) and opens the ERC panel; the contextual wiring hint now shows only while actively drawing/reshaping.

### Part editor

- **Dual-view authoring** (`PartsEditor`): a Breadboard | Schematic toggle; each view keeps its own art, size, and pin positions (pin names are the shared cross-view key). Save writes both populated views; palette icon prefers the breadboard art. A dot next to a toggle label marks which views have pins.

### App shell

- **Stable left panel** (`App`): the Files panel no longer gets shoved around when the right (docs) or bottom (serial) panel toggles. We remember a manual drag (`ResizableHandle onDragging` → `manualFilePct`) and otherwise the toolbar-divider alignment, and re-assert that width via the imperative panel handle after any panel toggle. So it only changes when _you_ drag it.
- **Docs panel reopens on view mode** (`EditorPanel.onEditChange`): entering circuit edit mode still closes the docs panel to free space; returning to view mode reopens it (`isOpen: !editing`).

### Notes for the next agent

- Marquee/rubber-band still selects parts + wires only, not net labels (click / shift-click for labels).
- Leg recolor is render-time and keyed by svg string; if a part with a different (non-`connectorNleg`) leg convention shows up, extend `blackenLegs`.
- Tooling: `PartsEditor.tsx` hit the Cowork-mount truncation bug when written via the file tool (cut at line 399 mid-word) — rewritten Linux-side and verified. Everything else this round was written Linux-side. The stale `.git/index.lock` is still unremovable from the sandbox, so this round is **uncommitted** on `circuit-editor`.

---

## 2026-07-11 — M2 leftovers + M4 core: persistence, .fzpz import, simulation ✅

Four chunks, committed separately. `npm run typecheck` clean · `npm run test:circuit` → **89/89** (sim tests run the real WASM engine on generated netlists).

### Small gaps (from the 07-05 notes)

- **Marquee selects net labels** (sch) alongside parts/wires; additive with Shift.
- **Inspector breadboard rotate is rigid**: `rotateBoardAssemblyCmd` lifted into `partsAdapter` (shared by canvas gestures and the Inspector, `steps` param covers the 0/90/180/270 dropdown); Inspector detects `isBreadboard` + bb view and delegates.
- **Net-label rotation**: `rotateNetLabelCmd` (90° steps about centre, pin re-snapped to grid, wires reroute) — `R` key with labels selected, plus a rotation dropdown + 90° button in the label Inspector.

### M2: Part Editor persistence (B7) — `lib/userParts.ts`

- Custom parts persist in **IndexedDB** (`tinystudio-user-parts`), one impl for Electron renderer + web; localStorage fallback. `initUserParts()` (idempotent) restores them into the live registry on CircuitView/DiagramEditor mount, before geometry; both PartsEditor save paths now `saveUserPart` (register + persist). `deleteUserPart` exported for a future pack-manager UI.

### M2: `.fzpz` drop-import — `parts/zip.ts`, `parts/svgUnits.ts`, `parts/fzpz.ts`

- **Zero-dep zip reader**: central-directory walk + native `DecompressionStream('deflate-raw')` (Chromium + Node ≥18 → unit-testable against real deflate streams from node:zlib).
- **In-app fzp→PartDef conversion** mirroring `scripts/fritzing-import.mjs`: connector resolution by svgId/terminalId with full ancestor-transform accumulation (`svgUnits.ts` is the pure math, tested), viewBox→96 DPI scaling, line-end picking, name-uniquing, icon extraction. DOM parts use the browser DOMParser (renderer-only module).
- **Drop a .fzpz on the canvas** → converts → `saveUserPart` (persists) → places at the cursor with collision avoidance → toast (with unresolved-pin count when partial). Canvas gained `onImportFiles`; multiple files per drop OK.

### M4 core: netlist gen + SimBackend + Simulate panel

- `core/netlist.ts` — pure SPICE generation from doc + NetModel (seating/buses included as the editor sees them). Node naming per spec §10.2 (GND label → `0`, named nets keep names, `n<k>` stable). Built-in emitter table (R/C/L/D/LED/pot→2R/NPN/PNP/switch/battery + `sim-*` sources) with name-matched pins (anode/cathode/+/-) and positional fallback; breadboards transparent; boards excluded with "drive its pins with sources" info; unknowns excluded with warning. `spiceNum` normalization (`4.7kΩ`→`4.7k`, `µ`→`u`, trailing `M`→`Meg`). Analyses: `.op`/`.tran [uic]`/`.dc`/`.ac`.
- `parts/simParts.ts` — builtin **Source** family (`sim-vdc`, `sim-vsin`, `sim-idc`): generated circle symbols, same art both views, default attrs applied on placement (Inspector-editable). Registered at CircuitView mount like breadboards.
- `sim/` — **`SimBackend`** interface (engine-agnostic per §10.6), `SpiceWorkerBackend`: module worker (Vite `?worker`, `worker.format='es'` set in both vite configs), lazy `eecircuit-engine` import (≈20 MB chunk, loaded on first Run), 10 s watchdog default, cancel = terminate+respawn. **eecircuit-engine installed as the first backend** — the tscircuit-build bake-off remains open behind the interface.
- `views/sim/SimPanel.tsx` — bottom-docked panel: DC | Transient tabs (step/stop/uic), Run/Cancel, netlist preview toggle, generator warnings, error surface (ngspice messages), `.op` results table, transient traces in an inline SVG plot (uPlot lands with the full plotting pass). **DC annotations**: after an `.op` run the canvas shows node-voltage chips at one pin per net (both views); results auto-clear on any doc edit.
- Tests: +18 (89 total) — netlist goldens (divider, LED chain model-once, exclusions, switches, spiceNum, analysis cards), zip round-trip/EOCD-comment, svgUnits math, **sim integration**: engine solves the generated divider `.op` within 1% and an RC transient (uic) charge curve within 5% at t=RC.

### Deferred / notes for the next agent

- M2 still open: pack manager + GitHub index install, bendable legs, default-pack regeneration, "all pins must seat" rule.
- M4 still open: DC sweep + AC tabs in the panel (cards already generate), uPlot with cursors/zoom/log axes + CSV export, current probes (§10.3 probe parts — `sim.probes` is modeled but unused), error→part/net highlight mapping, auto-rerun toggle, breadboard hole-tooltip voltages, flag default ON + legacy editor removal.
- M5 untouched (KiCad/Wokwi interop).
- The sim source symbols seat on breadboards like any 2-pin part; netlist pin matching for them keys on `+`/`-` names.
- Tooling: Cowork-mount truncation did NOT reproduce this session (new files written via the file tool verified clean); git index/HEAD locks were stale early on — **fixed by enabling file deletion for the folder**, commits work normally again.

---

## 2026-07-13 — sim UX pass (Geoff's feedback: "can't set values, can't choose probes")

- **Inspector "Simulation" section**: `netlist.simAttrsFor(type, family)` exposes each mapping's editable attrs (resistance/capacitance/inductance, voltage, amplitude+frequency+offset, current, pot position, switch closed) as labeled fields with the emitter's default as placeholder + unit hint. No more guessing magic attr names; the keys are excluded from the generic Properties rows. Attr edits are mergeKey'd (one undo step per field).
- **Trace picking**: the transient plot's legend is now clickable — toggle traces on/off (state survives reruns; results still auto-clear on doc edits). Visible traces cap at 6 colors.
- **Readable DC table**: each `v(node)` row shows the net's members ("R1:Pin 1 · LED1:anode"), `i(vxx)` rows say "current through …".
- Real probe _parts_ (§10.3, `sim.probes`) remain backlog — this pass makes everything probeable-by-default usable.
- `npm run typecheck` clean · `npm run test:circuit` → 89/89.

---

## 2026-07-13 (later) — M4 panel complete + visual fixes (Geoff's round 3)

`npm run typecheck` clean · `npm run test:circuit` → **95/95** · web build verified (worker + engine chunks intact).

### Sim panel: all four analyses (spec §10.4)

- Tabs are now **DC | Sweep | Transient | AC**. Sweep: source select (element names as emitted — VV1/II1, seeded to the first source on tab switch), from/to/step. AC: dec/oct/lin, points, fstart/fstop.
- **uPlot** (spec's decided plot lib, MIT, ~45 kB) replaces the inline SVG plot: live cursor readouts, drag-to-zoom (double-click resets), click-to-toggle legend. One `SimPlot` component handles the three sweep shapes — transient (x=time), DC sweep (x=`v(v-sweep)`), AC (log-frequency axis, magnitude in **dB** + dashed **phase** traces on a right-hand degree axis). Theme colors read from design tokens at mount.
- **CSV export** button (full vectors; complex AC data exported as mag+deg columns).
- **AC actually works**: the sine source card now carries `AC <amplitude>` (`SIN(…) AC 2`), so `.ac` sweeps have a stimulus. Generator hardening: an analysis list that resolves to zero cards falls back to `.op` (a `.dc` without a source can no longer emit a card-less netlist).

### Visual fixes

- **Breadboards render below everything**: canvas boards get `zIndex 1` (parts 2, wires 5); the image exporter paints a `boardsSvg` layer before wires and parts, so exports match the canvas.
- **Resistor color bands follow the value** (`parts/resistorBands.ts`): the Fritzing art's `band_1_st`/`band_2_nd`/`band_rd_multiplier` ids are recolored to the 4-band IEC code computed from `attrs.resistance` (gold/silver multipliers for sub-10Ω; tolerance band untouched; unparseable values leave stock art). Wired through `partsAdapter.partArtFor` — used by both the canvas and the exporter, cached per (svg, value). Resistor sim default changed 1k → **220** to match the stock red-red-brown art.
- Tests: +6 (95 total) — band parsing/coding/recolor, vsin AC card, dc-without-source fallback.

### Notes

- uPlot inlines into the main chunk (small); the engine stays its own lazy chunk.
- Sandbox web build needed `NODE_OPTIONS=--max-old-space-size=4096` once (OOM at transform) — not a repo issue.
- Remaining M4: probe parts (`sim.probes`), current probes, error→part highlight mapping, auto-rerun toggle, bb hole-tooltip voltages, flag default ON + legacy editor removal. Then M5 interop.

---

## 2026-07-22 — M4 + M2 leftovers closed out ✅ (both milestones now fully scoped-complete)

Seven commits, each independently typechecked + tested. `npm run typecheck` (node+web) clean · `npm run test:circuit` → **114/114** throughout (started the session at 95).

### M4 (closes every item on the 07-13 "remaining" list)

- **Flag default ON + legacy editor removed** (`5226072`). `EditorPanel`'s `CircuitView` now mounts `CircuitViewV2` unconditionally — no more `tinystudio.circuitV2` flag, no `CircuitV1View` branch. Deleted `components/DiagramEditor.tsx` (2009 lines) and the already-dead `CircuitEditor.tsx` static viewer (B21). `diagram.json` → `circuit.json` migration-on-open is unchanged. **This is a real behavior change for anyone who had the flag off** — done deliberately, at Geoff's request, ahead of the rest of this session so the remaining work lands on the real path.
- **Auto-rerun + hole voltage tooltips** (`1c099af`). `SimPanel` gets an "auto-rerun" checkbox: once on, doc edits re-run the active analysis after a 400 ms debounce (single in-flight run). Breadboard hole tooltips now append the net's solved DC voltage next to the existing "hole · net members" text, via a new `simVoltageForNet(netIdx)` threaded `CircuitView → Canvas`.
- **Error → part/net highlight mapping** (`83b5c70`). `generateNetlist` now records `elementOfPart` (lowercased SPICE device names per part id). New pure `mapSimIssue`/`mapSimIssues` (`core/netlist.ts`) scan raw ngspice error/warning lines for those device names and node names (word-boundary, case-insensitive, ground `0` excluded) and return implicated parts/nets. `SimPanel`'s error box renders clickable chips (+ "select all"); `CircuitView.selectSimIssue` expands net hits to member parts and selects on canvas. +6 tests.
- **Probe parts** (`715824a`) — voltage, differential voltage, current. Three placeable builtins (`parts/simProbes.ts`, CircuitLab-flag glyphs, family `Probe`). Voltage/diff probes need no SPICE element (ngspice already reports every node); the current probe emits a real `V<id> DC 0` series source so `i(v<id>)` reports the branch current without disturbing the circuit. `core/probes.ts` (pure, tested): `probesIn`, `diffProbeVector(s)` (computes `vdiff(<id>) = v(+) − v(−)`, real + imaginary for AC), `probeLabelFor` (a probe's `attrs.label` stands in for the raw vector name in `SimPanel`'s table and `Plot`'s legend — `Plot.tsx` gained an optional `labelFor` prop). +9 unit tests, +1 real-engine integration test (verifies `i(vamm1)` against the analytic divider current).

### M2 (closes every item on the 07-11 "still open" list)

- **Rigid "all pins must seat" rule** (`e70ce3a`). `partsAdapter.implicitSeats()` previously seated each pin independently against its nearest hole — a part with one leg near a hole and another off-grid reported a spurious single connection while the rest silently dangled. Now a part seats as a rigid body: **all** its pins must land within `SEAT_RADIUS` at the current placement, or none do (Fritzing's rule). Not unit-tested in isolation — `implicitSeats` depends on the legacy `partsLibrary` registry like the rest of `partsAdapter.ts`, consistent with that module's existing (lack of) coverage.
- **Bendable rubber-band legs** (`dc3dd87`). Both importers (`scripts/fritzing-import.mjs`, `circuit/parts/fzpz.ts`) now read each connector's `legId` and tag the resolved pin into a new `PartView.legs: string[]`. Geometry needed no change — `pinWorld`/`pinWorldOf` were already leg-offset aware (`Placement.legs` existed since M0/M1 but nothing produced or consumed it). Canvas (bb view only): a leg-tagged pin drags independent of the part body (`beginLegDrag`, live-dispatched merged `placePart` commands, same pattern as the existing label-offset drag — no separate drag-override path needed since wires re-anchor through the normal `doc → resolve()` recompute); a real drag suppresses the trailing click; double-click resets a bent leg. Visual is a simple ink line from rest to tip overlaid on the existing static Fritzing leg art (real per-instance SVG leg-path warping is still future work — noted in code). `implicitSeats`'s rigid rule (above) now lets a stretched leg actually reach and seat in an adjacent hole. **Not automated-tested**: this is gesture code in `Canvas.tsx`, which has no test coverage anywhere in the suite (same caveat as every other canvas interaction in this repo) — verified by typecheck + code review only, not click-tested in a real browser (no display in this environment).
- **Parts-pack manager + GitHub index installer** (`be71da3`). Targets the app's _actual_ pipeline (legacy `PartDef` v1 + `lib/userParts.ts`/IndexedDB persistence), not the unbuilt v2 `registry.ts` the spec's §5.3/§5.4 assumes. `circuit/parts/packs.ts`: `fetchIndex`/`fetchManifest` (validated, relative URLs resolved against their own manifest), `installPack` (per-part fetch + `saveUserPart`, continues past individual failures). `circuit/views/packs/PackManager.tsx`: modal off a new Components-rail icon — add/remove index URLs, per-pack Install/Update with progress + toast summaries. `scripts/make-pack-index.mjs`: wraps a `fritzing-import.mjs` output directory into `pack.json`/`index.json` — re-shapes the existing manifest, no new conversion logic. `docs/tinyparts-pack-setup.md`: full guide for Geoff to create the `tinyparts` repo by hand (he offered to do this manually rather than granting repo access this session) — layout, exact schemas, the generator command, local testing, ATTRIBUTION requirement (M0 licensing decision), explicit gaps (no hash verification, no launch-time update check, no zip hosting). +7 unit tests against mocked fetch/localStorage, **plus a real end-to-end smoke test outside the suite**: ran `make-pack-index.mjs` against the app's actual 29-part bundled catalogue, served it over a plain local HTTP server, installed it through the real `packs.ts` client — 29/29, 0 failures.

### Both milestones: what's left

- **M2**: nothing outstanding against the spec's M2 line item. The only thing not delivered is publishing the `tinyparts` repo itself — that's Geoff's action per `docs/tinyparts-pack-setup.md`.
- **M4**: nothing outstanding against the spec's M4 line item.
- **M5 (interop)** is untouched — KiCad netlist/`.kicad_sch` export, Wokwi import/export + lint CI, `.fzz` import. This is genuinely the only milestone left per the spec's Section 15 table.

### Session notes for the next agent

- **Sandbox tooling fixed**: `.git/index.lock` could not be removed all session start (`allow_cowork_file_delete` on the folder resolves it in one call, same as the 07-11 session's fix — apparently doesn't stick across sessions, ask again if `git` operations silently fail with `Operation not permitted`).
- **This sandbox's `node_modules` is Windows-native** (esbuild etc.), so `npm run test:circuit` fails here directly (`esbuild ... needs the "@esbuild/linux-x64" package`). Workaround used all session: a scratch `npm install esbuild --no-save --prefix /tmp/esbuild-linux`, then a copy of `scripts/test-circuit.mjs` importing esbuild from that absolute path instead of the repo's `node_modules` (repo `node_modules` never touched). **Must `cd` into the repo root before running it** — `sim.test.ts` resolves `eecircuit-engine` via `process.cwd()`, not `import.meta.url`. This isn't a repo change, just a note for whoever hits this again.
- **`uplot` was declared in `package.json`/`package-lock.json` but missing from `node_modules`** at session start (stale install, unrelated to this session's changes) — Geoff needs to run `npm install` on his machine; not done here since this sandbox's platform-native deps would corrupt the Windows install.
- `package.json`/`package-lock.json` carry a small pre-existing uncommitted diff (a `postinstall` fix, and a `0.2.0`→`0.3.0` lockfile version mismatch) that predates this session — left alone, not part of any commit above.
- Bendable legs and the rigid seat rule are both real behavior changes to breadboard placement that would benefit from a manual click-through (drop a resistor near-but-not-quite on holes; drag an LED leg) before calling M2 done-done — flagged, not blocking, since the logic itself is straightforward and typechecked.

---

## 2026-07-30 — Parts bins: duplicate tiles, bundled Core, palette rework

Four complaints from Geoff, all in the components rail. `npm run typecheck` (web) clean · circuit suite **123/123** · eslint clean.

### 1. "A ton of duplicates in Core Basic and such" — the fold rule was too narrow

The old variant merge (`split-parts-packs.mjs`) fingerprinted each part on _everything the app can render_ — family, title, per-view w/h, pin coordinates, artwork — and folded only exact collisions. That catches `resistor` vs `SMD_resistor_0603` (same art, same pins) and misses every case where the footprint also changes the part's physical size, which is most of them. Hence sixteen tiles all called "Inductors" in SparkFun · Passives, thirteen called "Capacitor", eighteen "Capacitor Polarized", seven "Film/Foil Capacitor".

Geoff's guess ("something like resistor values") was close: it's the `package` property, not the value.

New rule in **`scripts/lib/fold-variants.mjs`** (shared by the importer and the re-pass, so they can't drift): one tile per **(pack, family, base title)**, base title being the label with any generated `(package)` suffix stripped back off. Two guards keep it honest, because Fritzing families sometimes lump together parts that aren't interchangeable:

- **Pin names.** Connections are keyed by pin name, so parts offering different pin names never fold. Keeps the 2-pin and 3-pin ceramic resonators apart — same family, both titled "Resonator".
- **Behaviour tokens.** A package string carrying `anode`/`cathode`, `npn`/`pnp`, `spst`/`spdt`/`dpdt`, `male`/`female`, an EBC/ECB/CBE pinout or a waveform name splits its group. The nine 7-segment displays stay as two tiles (common-anode, common-cathode) rather than one that lies about which it is.

**1650 → 1345 tiles** over the same 1776 files. Passives 68 → 19, Core · Basic 71 → 25, SparkFun · Connectors 144 → 83. Audited: no two tiles share a label in any bin, every `variantOf` resolves to a present primary in the same bin, every `variants` list round-trips.

Folded parts keep their file, keep their `(package)` suffix, and **`searchParts` now returns them** (ranked below every primary). That's deliberate and it's what makes the fold safe — with captions gone from the grid, search is the only route back to a specific footprint.

### 2. Core packs now ship with the app

The ten `core-*` packs (642 files, 554 tiles) moved into `src/renderer/src/assets/parts` and render as one **Core** bin. Removed from the tinyparts index; the repo now publishes only SparkFun sub-bins and vendor packs (33 packs, 868 tiles).

`packMigration.json` gained `bundledPackIds`. On first launch after the upgrade, `discardBundled()` deletes the downloaded copies and calls the new **`restoreBundledParts()`** in `partsLibrary` — note `unregisterParts` would have been wrong here, since a pack part _overwrote_ the bundled manifest row for its type and dropping it would take the type out of the manifest entirely. `restoreBundledParts` puts the shipped row back and clears the cached def. Migration version → `1.3.0`.

Cost: **+74 MB** in the repo. Runtime is unaffected (part JSON stays lazy-loaded; startup only pays for the ~14 MB manifest), but the installer grows. Geoff chose to leave it for now — the obvious lever is running the artwork through `minifySvg` and rounding pin coordinates, worth 30-50% with no visual change.

### 3. tinyStudio boards have their own tab

New `PartSource` `'tiny'`; `sourceOf({ builtin: true })` returns it. The five tiny\* boards were five squares lost among five hundred generic ones. Palette opens on this bin.

### 4. Palette tiles: artwork only

No card, no border, no caption, and the `--warm-150` box behind each thumb is gone — that box was the "white outline around every icon". Grid went 2 → 4 columns. The name is a hover tooltip (family, pin count, folded packages, drag hint) rendered **fixed-position at the palette root**, not inside the tile: the bin scrolls, and a scroll container clips on both axes, so an absolutely-positioned label inside a 48px cell would be cut off at exactly the palette's edge. It flips left when there's no room right. Search results keep their captions — that's how you tell "Capacitor (0805)" from "Capacitor (1210)" in a list you asked for by typing.

### 5. Fritzing bin icons (`bins/more`)

`scripts/lib/bin-icons.mjs` reads each `.fzb`'s `icon=` attribute and inlines the artwork as a data URI. Three shapes in the wild, all handled: a PNG filename (most vendors); **nothing at all** — every SparkFun sub-bin, whose PNGs are sitting there unreferenced, so the `.fzb` basename is tried as a filename; and an entire XML-escaped SVG document (`voltage_regulators.fzb`). Colour over `-mono`: the rail sits on light or dark chrome depending on theme, and flat black artwork vanishes on one of them.

**22 of 33 packs** now have real artwork. The rest keep monograms — `lilypad.fzb` / `picaxe.fzb` / `parallax.fzb` name PNGs that aren't in the repo, and five SparkFun sub-bins have no `.fzb` at all.

New `circuit/parts/PackGlyph.tsx` renders all three forms; used by the palette rail and the Pack Manager list (which previously would have printed a data URI as text). `PackManager.refreshIndex` now re-records name/icon/group for installed packs, so an existing install picks up the artwork on its next look at the panel rather than only after a reinstall.

### New scripts

- **`scripts/refold-parts.mjs`** — re-pass over a published tinyparts checkout. Re-folds using the current rule, optionally bundles `core-*` into the app, stamps bin icons. Needs no Fritzing source: it only rewrites presentation metadata.
- **`scripts/lib/{fold-variants,bin-icons,bin-map}.mjs`** — shared with `split-parts-packs.mjs`, which was rewired onto them (its `fingerprint`/`primaryScore`/`packageLabel`/`sharedPrefixLength` block and its inline `BIN_TO_PACK` are gone). Classification now runs _before_ folding, since folding is per-pack.

### Session notes for the next agent

- **`refold-parts.mjs` is chunked on purpose** (`--packs a,b,c`). The library is 125 MB on a mounted Windows filesystem; a single `--all --bundle` pass runs for minutes, and background processes do not survive between sandbox shell calls, so a long run gets killed mid-write and truncates whatever JSON it was writing. The `write()` helper skips byte-identical files, which makes re-runs cheap, and `foldVariants` resets `label`/`variantOf`/`variants` from `baseTitle` first, so it's idempotent — a re-run after an interrupted one is safe. One file (`sparkfun-displays-lcd-g12864-full.json`, 3.3 MB) was truncated twice this way and restored from the `tinystudio-core` blob still in tinyparts' git history.
- `.git/index.lock` in tinyparts was stale and unremovable until `allow_cowork_file_delete` — same as the 07-11 and 07-22 sessions. It still doesn't stick across sessions. Deletes on the mounted folders need it too.
- Windows-native `node_modules` again: `npm run test:circuit` needs the `/tmp` esbuild workaround from the 07-22 notes, run from the repo root.
- **Not click-tested** — no display here. The tooltip's fixed positioning, the 4-column grid at 554 tiles, and the PNG tab icons against both themes all want a real look before this is called done.
