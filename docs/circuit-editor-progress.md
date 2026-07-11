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
- **Rigid breadboard rotation.** Rotating a breadboard (right-click, or `R` with a lone board selected) now turns the board, its seated parts, and the wires *between* seated parts as one rigid assembly about the board's centre — layout is preserved instead of the wires rerouting. Uses `reroutesFor`'s `transformBoth` hook (rot90-about-centre) for both-ends-on-board wires; seated parts get their centres rotated + `rotate += 90`. Grid-aligned seating means holes map to holes, so pins re-seat exactly. New `rotateBoardAssembly` helper in `Canvas`; `rotateSelection` and the board context-menu delegate to it. (Wires with only one end on the board still reroute — expected, that end left the assembly.)
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
- `partsAdapter.ercFloatingPins` — view-side floating-pin finding (needs pin geometry); only flags *partially* connected parts to avoid noise.
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
- **Unplaced tray auto-places** (reverting the click-then-click attach-to-cursor): clicking a tray chip drops the part straight onto a free slot *and* flips the view into edit mode so it can be dragged immediately.
- **Double-click any component → edit mode** (`Canvas.onRequestEdit`, wired to `CircuitView.enterEdit`): double-clicking a part or net label in view-only mode enters edit mode.

### Visuals

- **View-aware palette icons** (`Palette.iconFor`): the components rail shows schematic symbols in the schematic view, breadboard art in the breadboard view.
- **Black part legs** (`partsAdapter.blackenLegs`): Fritzing legs are baked into the art as `<line id="connectorNleg" … stroke="#8C8C8C"/>`; we recolor those leg strokes to ink (`#1A1A1A`) at render time (cached). Only leg elements are touched.
- **Bigger watermark** (canvas + image export): ~5× larger, thin `tiny` + bold `Studio` to match the header wordmark; export uses `<tspan>` weights and extra bottom padding.
- **Cleaner status area**: dropped the persistent "Parts/Wires/Nets" pill and the idle "Scroll to zoom" / "View-only" hint bubbles. One compact warning bubble appears only when there's something to fix (unplaced parts · unwired nets · ERC err/warn) and opens the ERC panel; the contextual wiring hint now shows only while actively drawing/reshaping.

### Part editor

- **Dual-view authoring** (`PartsEditor`): a Breadboard | Schematic toggle; each view keeps its own art, size, and pin positions (pin names are the shared cross-view key). Save writes both populated views; palette icon prefers the breadboard art. A dot next to a toggle label marks which views have pins.

### App shell

- **Stable left panel** (`App`): the Files panel no longer gets shoved around when the right (docs) or bottom (serial) panel toggles. We remember a manual drag (`ResizableHandle onDragging` → `manualFilePct`) and otherwise the toolbar-divider alignment, and re-assert that width via the imperative panel handle after any panel toggle. So it only changes when *you* drag it.
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
