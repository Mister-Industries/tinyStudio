# Circuit Design Document — Fritzing vs. tinyStudio, Fritzing Part Import, and the Road to KiCad

**Status:** Draft for review · **Date:** 2026-07-02 · **Scope:** `fritzing-app` (upstream reference) and `tinyStudio` Circuit view (`DiagramEditor.tsx`, `wireRouting.ts`, `circuitNets.ts`, `partsLibrary.ts`, `PartsEditor.tsx`, `scripts/fritzing-import.mjs`)

This document explains how Fritzing's breadboard/wiring/parts architecture works, how tinyStudio's circuit view works today, the exact differences between them, how a Fritzing part can be imported directly, the bugs and gaps in the current circuit designer, and a phased roadmap toward "the best breadboard view ever" with schematic generation and KiCad export — while keeping `diagram.json` Wokwi-compatible.

---

## Part I — How Fritzing works

Fritzing is a Qt/C++ desktop app built on `QGraphicsScene`. One electrical **model** drives four synchronized **views** (icon, breadboard, schematic, PCB). Everything below is verified against the `fritzing-app` source in this workspace.

### 1.1 The part model: `.fzp` + per-view SVGs

A Fritzing part is an XML file (`.fzp`) plus up to four SVG files (one per view). The `.fzp` contains:

- **Metadata** — `moduleId` (unique id), title, label, author, date, tags, `taxonomy`, description.
- **Properties** — a `family` (parts in the same family are hot-swappable in the Inspector) plus free-form key/value pairs (`resistance`, `package`, `voltage` …).
- **Views** — for each of `iconView` / `breadboardView` / `schematicView` / `pcbView`, an `image` path to an SVG and one or more `layer` ids (`breadboard`, `schematic`, `copper0`, `copper1`, `silkscreen` …). PCB parts reference multiple layers inside a single SVG.
- **Connectors** — each `<connector>` has an `id` (`connector0` …), a human `name` (`V+`, `GND`), a `type` (**male** or **female** — this drives breadboard behavior, see §1.3), optional ERC metadata (`<erc etype="VCC">`, current/voltage hints), and per-view bindings:
  - `svgId` — the id of the graphic element in that view's SVG that *is* the pin (e.g. `connector0pin`).
  - `terminalId` (optional) — a smaller element marking the exact wire-attach point (used mostly in schematic view; without it the terminal defaults to the center of the `svgId` element).
  - `legId` (optional) — for parts with bendable rubber-band legs (LEDs, resistors in breadboard view), the SVG element that is the flexible leg.
- **Buses** — `<buses>` declares internal connectivity: a `<bus>` lists `<nodeMember connectorId="…">` pins that are permanently connected inside the part. **This is how a breadboard works in Fritzing**: the breadboard part has hundreds of female connectors, and each 5-hole row (and each power rail) is a bus.
- **Subparts** (schematic only) — multi-unit parts (e.g. quad op-amps) that can be placed as separate schematic symbols.

Key insight: **the `.fzp` stores no pin coordinates.** Geometry lives entirely in the SVGs; the `.fzp` binds connector ids to SVG element ids. Any importer must resolve those elements inside the SVG (including ancestor `transform`s) to get pin positions — which is exactly what `scripts/fritzing-import.mjs` does.

Parts ship as `.fzpz` (a ZIP of the `.fzp` + its SVGs); sketches ship as `.fzz` (a ZIP containing a `.fz` XML plus any non-core parts used).

### 1.2 The scene/item architecture

- `ModelPart` / `ModelPartShared` — the in-memory part (shared data parsed once from the `.fzp`).
- `ItemBase` → `PaletteItem` → concrete classes (`Breadboard`, `Resistor`, `Wire`, `SymbolPaletteItem` for net labels/power symbols, `Dip`, `MysteryPart` …) — a `QGraphicsItem` per part *per view*. `PartFactory` picks the class from the moduleId/family.
- `ConnectorItem` — a `QGraphicsRectItem` child of each part for every connector in every view; handles hover highlight, hit testing, and holds the list of `connectedTo` ConnectorItems.
- `Bus` / `BusShared` — internal-connection groups from the `.fzp`.
- `SketchWidget` (≈10,800 lines) — the shared view controller; `BreadboardSketchWidget`, `SchematicSketchWidget`, `PcbSketchWidget` subclass it with per-view rules (`ignoreFemale()`, `canDropModelPart()`, trace widths, colors, grid defaults: 0.1 in breadboard/schematic, 0.05 in PCB).
- Every mutation is a `QUndoCommand` on a shared undo stack, and commands carry a **CrossViewType** so an action in one view replays into the others.

### 1.3 Breadboard view mechanics (the part to learn from)

The breadboard view has no special "breadboard mode" — it emerges from a few composable rules:

1. **Male vs. female connectors.** Breadboard holes are *female*; component pins and wire ends are *male*. When a part is dropped or moved, `findConnectorsUnder()` hit-tests each of its male ConnectorItems against female ConnectorItems beneath it (`Breadboard::canFindConnectorsUnder()` returns false — the board itself never searches; things land *on it*). Overlap ⇒ an implicit connection is formed, with no wire drawn. Move the part away ⇒ the connection dissolves (`disconnectFromFemale`).
2. **Buses make rows live.** Inserting a pin into one hole connects it to the whole 5-hole row because the row is a bus in the breadboard's `.fzp`. Power rails are long buses.
3. **Stickiness.** The breadboard is *sticky* (`ItemBase::m_sticky`): parts dropped on it are recorded in `m_stickyList` and move with it when the board is dragged.
4. **Wires with bendpoints.** A user wire is a chain of `Wire` items — each `Wire` is one straight `QGraphicsLineItem` segment with a ConnectorItem at each end; a bendpoint is where two segments share a position. `Wire::collectChained()` walks the chain to find true endpoints. Breadboard wires may also carry **Bézier curvature** per segment (`<bezier>` control points in the sketch file) for the pretty curved-jumper look. Dragging from any male/female connector spawns a temp wire (`createTempWireForDragging`); dropping on a legal target commits it.
5. **Rubber-band legs.** Parts with `legId` connectors (LED, resistor) have draggable legs that stretch to reach holes — the leg is part geometry, not a wire.
6. **Ratsnest sync.** Every connect/disconnect calls `ratsnestConnect()`; other views receive **VirtualWire** ratsnest lines grouping equal-potential connectors, which the user then routes properly in that view (schematic wires, PCB traces). This is the bridge that turns a breadboard layout into a schematic to route.

### 1.4 Nets, ERC and routing

- Equal-potential collection is a flood fill (`collectEqualPotential`) across: wire connections, female/male stacking, part-internal buses, and same-net symbols (net labels, power symbols via `symbolpaletteitem`).
- `RoutingStatus` tracks nets total / routed / connectors-to-route per view.
- ERC data (`erc.h`, connector `etype`, current/voltage) supports a basic electrical rule check and drives the newer simulation module (`src/simulation`, ngspice-based).
- PCB view has a full maze autorouter + DRC (`src/autoroute`), Gerber export (`svg2gerber`), and ground-plane generation. Schematic/breadboard have no autorouter — humans route; only the ratsnest guides them.
- `src/svg/kicad2svg` imports **KiCad → Fritzing** (modules and schematic symbols → part SVGs). There is no KiCad *export* in Fritzing — a gap tinyStudio can leapfrog.

### 1.5 Sketch file format (`.fz` inside `.fzz`)

XML `<module>` with `<views>` (per-view background/grid settings) and `<instances>`. Each `<instance>` has `moduleIdRef`, a per-view `<geometry>` (x/y/z, and for wires `x1/y1/x2/y2` + `wireFlags`), optional `<wireExtras>` (width, color, Bézier control points), and a `<connectors>` block whose `<connect>` children record the id + modelIndex of everything each connector touches. Connections are therefore stored **explicitly and per-view**, symmetric on both sides.

---

## Part II — How tinyStudio's Circuit view works

The Circuit view is a React component tree inside an Electron (or web) app. The single source of truth is a **`diagram.json` file in the user's project**, edited live: `EditorPanel.tsx → CircuitView` loads `diagram.json` (creating a default if absent) and hands its text to `DiagramEditor`, which parses on every change and writes back serialized JSON through Redux (`updateFileContent`). Editing the JSON in the Code view and dragging parts in the Circuit view are the same operation on the same buffer.

### 2.1 Data model (Wokwi-first)

```jsonc
{
  "version": 1,
  "editor": "tinystudio",
  "author": "…",
  "parts": [ { "type": "resistor", "id": "resistor_a1x", "left": 520, "top": 230, "rotate": 90, "attrs": {…} } ],
  "connections": [ ["tinycore:SIG", "resistor:Pin 0", "#36c46b", ["v-22.73", "h-179.8"]] ],
  "schematic": { "pos": { "partId": [x, y] }, "routes": { "<connKey>": ["h…","v…"] } }
}
```

- **Parts** use Wokwi's `id`/`type`/`left`/`top`/`rotate`/`attrs` fields (px @ 96 DPI; 0.1 in = 9.6 px grid).
- **Connections** use Wokwi's 4-tuple `[from, to, color, journey]` with `h<px>`/`v<px>` instructions. Two tinyStudio extensions: a `d<dx>,<dy>` instruction for diagonal ("straight mode") segments, and endpoints may be a free point `{x, y}` (a junction tapping another wire's body) instead of `"part:pin"`.
- **`schematic`** is a per-view overlay (positions + routes) so a future schematic view can diverge from the breadboard layout without duplicating the electrical data. Pin *names* are stable across views, so connections stay valid when switching views.

### 2.2 Parts library (`partsLibrary.ts`)

One schema for all parts (`PartDef`): `type`, `label`, `family`, and `views.{breadboard,schematic}` each `{ svg, w, h, pins: { name: [x, y] } }` — inline SVG plus pin coordinates in px from the part's top-left. Sources:

1. **Built-ins** — the tiny* boards, authored inline with generated SVG.
2. **Fritzing-imported catalogue** — 29 parts currently under `assets/parts/`, one JSON per part, lazy-loaded via Vite dynamic import; `index.json` is the eagerly-loaded manifest (label, family, icon, pin count) that fills the palette.
3. **User parts** — `PartsEditor` (modal: upload SVG, click to drop pins, drag to place, name them) registers a `PartDef` into the live registry via `registerPart()`. **In-memory only — not persisted** (see bug B7).

### 2.3 The import pipeline that already exists (`scripts/fritzing-import.mjs`)

This is the crucial piece for "take a Fritzing part and drop it straight into the circuit view." It already works, offline, against a checkout of `fritzing-parts`:

1. Parse the `.fzp` (metadata, per-view `image`, connector list with `svgId`/`terminalId`/`legId`).
2. Load the view SVG; read `viewBox` + real-world `width`/`height` (in/mm/pt…), convert to px @ 96 DPI (`in×96`, `mm×3.7795` …).
3. For each connector, find the `svgId`/`terminalId` element (schematic prefers `terminalId` — the precise attach point; breadboard prefers `svgId`), compute its **local anchor** (rect center, circle center, path/polygon bbox center, line far-end heuristic, first-child for `<g>` wrappers), then apply the **cumulative ancestor transform chain** and scale into canvas px.
4. Emit `PartDef` JSON + manifest entry + `_report.json` (ok / partial / failed / skipped).

So the conversion math (the genuinely hard part: FZP→pixels with transforms and units) is done and validated. What's missing is productization — see Part IV.

### 2.4 Wiring engine (`wireRouting.ts` — ported from the tinySchematic prototype)

- **Absolute bendpoints.** A wire's stored instruction list is decoded into interior bend positions *fixed in world space*. When a part moves, only the leg(s) touching it re-anchor (`collectFrozen` → `buildWirePoints(source, bends, target)`); the wire body holds still. This mirrors Fritzing's behavior, where bendpoints are their own objects.
- **Orthogonal elbow routing.** `calculateOrthogonalPath` builds L-paths; the final segment approaches the pin along the major travel axis so wires dock perpendicular. Hold Shift for straight/diagonal mode (`d` instructions).
- **Junctions.** While drawing (or dragging an endpoint), landing on another wire's body clamps the endpoint onto that segment (`clampOntoSegment`) and stores a free `{x,y}` endpoint; a solder dot is rendered, and the net model merges the nets.
- **Editing.** Selected wires get Fritzing-style handles: squares mid-segment (perpendicular segment drag via `dragSegment`, inserting corner bends at anchored ends), circles at bends (`vertexDrag` keeps neighbors orthogonal), rings at endpoints (retarget to a pin, a wire body, or free space). Double-click adds/removes a bend. `simplifyWirePoints` drops collinear/duplicate points before saving.

### 2.5 Net model (`circuitNets.ts`)

Union-find (DSU) over endpoint keys with three edge types: physical connections, part-internal **buses** (via an optional `busesFor` callback — **currently never supplied by the editor**, see bug B8), and junction endpoints lying within 2 px of another wire's polyline. Output maps pins/connections → net index; drives the yellow equipotential hover glow and the "Nets: N" counter. This is a faithful miniature of Fritzing's `collectEqualPotential`.

### 2.6 Rendering & UX

Parts are absolutely-positioned `<div>`s with `dangerouslySetInnerHTML` SVG bodies (CSS `rotate` around center); wires are a single SVG overlay (glow → dark outline → color core → animated selection dashes, rounded fillets via quadratic arcs); pins are 16 px hit targets rendered only in edit mode. Custom camera (`{scale, tx, ty}`), wheel zoom (0.25–3×), middle/Alt-drag pan, fit-to-view. Two-column palette rail (left) and Inspector (right: name, x/y, rotation, free-form `attrs` properties, wire color, net pin count). PNG export composes a standalone SVG and rasterizes at 2×. View/edit toggle; footer status pills.

---

## Part III — Architecture comparison

| Aspect | Fritzing | tinyStudio Circuit view |
|---|---|---|
| Platform | Qt/C++, QGraphicsScene | Electron/web, React + SVG/DOM |
| Document | `.fzz` (zipped XML), instances with per-view geometry, symmetric explicit connects | `diagram.json` (Wokwi format + extensions), connections as endpoint tuples |
| Views | 4 synced views (icon/bb/schematic/pcb), cross-view undo commands | Breadboard live; schematic exists as a per-view overlay in data + code but is **not reachable in the UI** (view state is hard-locked) |
| Part format | `.fzp` XML + per-view SVGs, pins = SVG element refs | `PartDef` JSON, pins = resolved px coordinates, SVG inlined |
| Pin identity | `connector0…N` ids + names, male/female typed | pin *names* only; no male/female concept |
| Breadboard | Real part: female connectors + row buses + sticky + drop-to-connect | No breadboard part; wires connect pin-to-pin only |
| Bendpoints | Wire = chain of segment items; Bézier curves optional | Instruction list (`h/v/d`) decoded to absolute bendpoints |
| Junctions | Bendpoint-on-wire creates a shared connector | Free `{x,y}` endpoint + proximity net merge |
| Nets | Flood fill incl. buses, net labels, power symbols | DSU incl. junctions; bus support present but unused; no net labels/power symbols |
| Undo | Full QUndoStack, cross-view | **None** (every drag frame rewrites the file buffer) |
| ERC/simulation | ERC types per connector; ngspice simulation | None (Wokwi compat is the intended simulation path) |
| PCB | Full view, maze autorouter, DRC, Gerber | Out of scope (KiCad export is the plan) |
| KiCad | Import only (KiCad→Fritzing SVG) | None yet — export is roadmap Phase 4 |
| Rubber-band legs | Yes (`legId`) | No |
| Part swapping | Family-based Inspector swap | No |

---

## Part IV — Importing a Fritzing part directly into the Circuit view

### 4.1 Why it already (mostly) just works

The importer proves the mapping is clean:

| Fritzing | tinyStudio | Notes |
|---|---|---|
| `.fzp` title/label/family/description | `label` / `family` / `description` | `family` also groups the palette |
| filename / `moduleId` | `type` (slugged filename; moduleId kept in `source`) | moduleIds in core are often random hashes; filenames are the stable human identity |
| `breadboardView`/`schematicView` image SVG | `views.{breadboard,schematic}.svg` (minified, width/height stripped, viewBox kept) | |
| SVG real-world size | `w`/`h` in px @ 96 DPI | `in×96`, `mm×3.7795`, `pt×1.333` |
| connector `name` (fallback `id`) | pin name (deduped `name.2`, `name.3`…) | names must stay stable across views |
| `svgId`/`terminalId` element position | `pins[name] = [x, y]` | ancestor transforms accumulated; schematic prefers `terminalId` |

Because pin coordinates are resolved to Wokwi pixel space at import time, an imported part **drops straight into `diagram.json`** and wires exactly like a hand-made or built-in part. There is no runtime dependency on Fritzing.

### 4.2 What's still missing for "no difficulty" in-app import

1. **`.fzpz` drag-and-drop in the app.** Today import is a build-time Node script against a repo checkout. Ship the same logic in the renderer (it's pure XML/string work; bundle `@xmldom/xmldom` or use the browser `DOMParser`, and `fflate` for the ZIP): drop a `.fzpz` onto the palette → unzip → parse `.fzp` → resolve pins from the bundled SVGs → `registerPart()` → **persist** (see B7). The only script feature needing care is path resolution (`.fzpz` bundles its SVGs with prefixed names like `svg.breadboard.foo.svg`, so section-searching isn't needed).
2. **Buses.** The importer drops `<buses>` entirely. Emit `buses: string[][]` (groups of pin names) into `PartDef` and pass a `busesFor` callback to `buildNets` (the parameter already exists). Without this, any imported part with internal common pins — most importantly *a breadboard* — nets wrongly.
3. **Female connectors.** Add `pinType: 'male' | 'female'` per pin. Needed for drop-to-connect breadboard behavior (Phase 2) and for better wire-end semantics; harmless otherwise.
4. **Bendable legs (`legId`).** Currently ignored; leg pins resolve to the drawn leg end, which is acceptable. Real rubber-band legs are a Phase 2 renderer feature; importer just needs to tag `leg: true` on those pins.
5. **SVG hygiene at import time** (fixes live rendering *and* PNG export):
   - **Namespace all `id`s** (`<part-type>-<id>`) — Fritzing SVGs freely reuse ids (`connector0pin`, gradient ids), and multiple inlined parts on one page currently collide (bug B6).
   - Inline `class`-based styles (some parts carry `<style>` blocks that leak or get lost).
   - Font mapping: Fritzing text uses OCRA and Droid Sans; map to bundled/system fallbacks or convert text to paths at import for pixel fidelity.
6. **Coverage QA.** Run `--all --views breadboard,schematic` against the whole `fritzing-parts` core (~4,000 parts), triage `_report.json` partials (unresolved pins mostly come from exotic anchor shapes and `<use>` references — add `<use>`/`href` resolution to `localAnchor`), and land the catalogue in releases as a downloadable pack rather than bundling everything.
7. **Multi-unit subparts and PCB layers** — explicitly out of scope for breadboard/schematic import; note in `_report`.

---

## Part V — Bugs and gaps in the current circuit designer

Verified against the code, roughly ordered by user impact.

### Correctness bugs

- **B1 — Schematic view is unreachable.** `DiagramEditor` line ~279: `const [view] = React.useState<ViewKind>('breadboard')` — there is no setter and no UI toggle, so all the per-view schematic code (`schematic.pos`, `schematic.routes`, `viewFor` fallbacks, schematic wire styling) is dead in the UI. Either ship the toggle or remove the overlay until Phase 3.
- **B2 — Wokwi `"*"` journey instruction is ignored.** `accumulatePoints()` skips `*`, treating *all* instructions as source-anchored. Wokwi's format applies pre-`*` instructions from the source and post-`*` instructions **in reverse from the target**. Any real Wokwi diagram using `*` renders wrong wire routes in tinyStudio. Fix the decoder; on write, keep emitting source-anchored lists (valid Wokwi).
- **B3 — Unknown top-level keys are dropped on save.** `write()` reconstructs the JSON with only `version/editor/author/parts/connections/schematic`. A Wokwi project's `serialMonitor` and `dependencies` sections (and any future keys) are silently destroyed the first time a part is nudged. Preserve unknown keys on round-trip.
- **B4 — Wire identity is positional and collision-prone.** Selection (`selWire`) is an array index (stale after deletes reorder), and `connKey` = `"from>to"` collides when two wires share endpoints (both schematic routes land in one key; deleting one wire's route deletes the other's). Give connections a hidden stable key (or dedupe by construction) and select by key.
- **B5 — Duplicate-wire guard misses object endpoints.** `onPinClick`'s `exists` check compares `c[1] === ref` strictly; junction (`{x,y}`) endpoints and reversed duplicates slip through.
- **B6 — SVG id collisions across inlined parts.** Every built-in board SVG defines `id="g"` for its gradient; Fritzing SVGs reuse ids across parts. With several parts inlined into one document, `url(#g)` resolves to the *first* match — wrong gradients/clips on later parts, and the same corruption is baked into PNG export. Namespace ids per instance at render/import time.
- **B7 — Custom parts vanish on restart.** `PartsEditor` → `registerPart()` is memory-only. A `diagram.json` referencing a custom part loads as an unknown-type placeholder next session. Persist user parts (project-local `parts/` folder next to `diagram.json`, plus optional global user library) and hydrate the registry on project open.
- **B8 — Bus support exists but is never wired up.** `buildNets(…, busesFor)` is called without `busesFor`; `PartDef` has no `buses` field. Internal-bus parts (breadboards, boards with multiple GND pins that are really one net) net incorrectly.
- **B9 — Junction wires dangle after their host wire is deleted/moved.** A free `{x,y}` endpoint is a coordinate, not a reference: deleting or rerouting the tapped wire leaves the tapping wire floating in space, silently detached from the net. Junctions need to reference the host connection (e.g. `{ on: <connKey>, t: 0.42 }`) or be re-validated on edit.
- **B10 — Inconsistent free-point keying.** `circuitNets.refKey` rounds to 2 dp; `DiagramEditor.refStr` uses raw coordinates for route keys — near-coincident points can split or merge inconsistently between the net model and the route store.

### Architecture / UX gaps

- **B11 — No undo/redo.** Worse: `onPartMove` calls `write()` **per pointer-move frame**, so every drag floods Redux/file-content updates (dirty-flag churn, JSON.stringify per frame). Introduce an in-editor draft state committed on pointer-up, plus a proper undo stack (Fritzing treats undo as core infrastructure for a reason).
- **B12 — No multi-select, box-select, copy/paste, duplicate, or keyboard nudge.** Single-part selection only.
- **B13 — Only 90° rotations, no flip/mirror.** Fritzing supports 45° and horizontal/vertical flips; schematics need mirroring. (Wokwi `rotate` is free-form degrees, so the format allows it.)
- **B14 — No breadboard.** The "breadboard view" has no breadboard: no female holes, no row buses, no drop-to-connect, no stickiness. This is the core of Part VI.
- **B15 — Part `type` names don't map to Wokwi types.** `resistor` vs `wokwi-resistor`, `tinycore` vs `board-esp32-s3-devkitc-1`. A diagram saved by tinyStudio won't simulate in Wokwi as-is. Add a per-part `wokwiType` alias (plus attrs mapping) and an "Export for Wokwi simulation" that emits translated types, straightens `d` segments, and resolves junction endpoints into shared-pin fan-outs.
- **B16 — Junction endpoints and `d` moves are tinyStudio-only.** Fine as extensions, but the Wokwi exporter must normalize them (junction → two wires meeting at the nearest pin, or a fan-out from the shared pin; `d` → h+v staircase).
- **B17 — Performance cliffs.** Junction dot resolution is O(n²) per render in the component body (not memoized); `buildNets` re-resolves every wire's points on every diagram/tick change; fine at 20 parts, painful at 300 (a real breadboard sketch). Cache resolved points per connection, memoize junctions, and move net building behind `useMemo` keyed on a structural hash.
- **B18 — Fixed logical canvas (1100×640) and zoom clamps (0.25–3×)** — arbitrary bounds for big boards; the empty-state hint centers on the fixed canvas, not the viewport.
- **B19 — Wheel-zoom hijacks scrolling** (no Ctrl-to-zoom option) and there's no touch/trackpad pinch on the custom camera.
- **B20 — `uid()` is 3 chars at collision risk** for part ids (36³ ≈ 46k space, birthday collisions plausible in long-lived projects); ids are also user-invisible. Lengthen and dedupe.
- **B21 — Dead/legacy code.** `CircuitEditor.tsx` (static SVG/PNG viewer) appears unused by `EditorPanel` (which mounts `DiagramEditor`); confusing next to the real editor. Remove or repurpose as the read-only embed.
- **B22 — No ERC of any kind.** No polarity/short warnings (e.g., LED without resistor, V+ tied to GND). Fritzing's per-connector `erc` metadata survives in the `.fzp` sources and could be imported for a cheap win.
- **B23 — Rotated-part labels and pin hits.** Label counter-rotates around its own origin (drifts for 180/270°); pin hit targets don't grow at low zoom (hard to click when zoomed out — Fritzing scales hover targets).

---

## Part VI — Design: the best breadboard view ever → schematics → KiCad

### 6.1 Guiding principles

1. **`diagram.json` stays Wokwi-valid.** Extensions live in namespaced keys (`schematic`, future `tinystudio` block) that Wokwi-side tooling can ignore — plus an explicit Wokwi export that normalizes the extensions away (B15/B16). One file: layout + wiring + (via Wokwi) simulation.
2. **Nets are the spine.** Breadboard, schematic, and KiCad export are three projections of one net model — exactly Fritzing's architecture, minus the C++.
3. **Steal Fritzing's proven interactions** (drop-to-connect, sticky boards, bendpoint wires, family swap, ratsnest), skip its baggage (per-view duplicated geometry XML, monolithic SketchWidget).

### 6.2 The breadboard experience (Phase 2)

- **A real breadboard part**: generated procedurally (`half+`, `full+`, mini sizes) rather than imported — holes on the 9.6 px grid, row buses `[a1…e1]`, rails as buses, `pinType: 'female'` throughout. Procedural generation gives crisp SVG, parametric sizes, and correct buses for free.
- **Drop-to-connect**: when a part is dropped/moved, hit-test its male pins against female pins beneath (spatial hash on the grid — O(pins)); snap the part so all pins seat in holes; seated pins form implicit connections (rendered as subtle hole highlights, not wires). Moving away dissolves them. This is Fritzing rule-for-rule (§1.3.1–2).
- **Stickiness**: parts seated on the board move with it.
- **Curved jumpers**: optional Bézier rendering for wires between holes (pure eye candy; store as an extension field like Fritzing's `wireExtras/bezier`, straighten on Wokwi export).
- **Bendable legs** for LED/resistor class parts (import `legId`), so components can straddle the center channel realistically.
- **Quality bar**: hole-level hover tooltips (`row 12, column c — net N`), net glow lighting whole rows, alignment guides, auto-color for power rails (red/blue), and one-key part swap within a family (Fritzing's killer Inspector feature — the `family` field is already imported).

### 6.3 Breadboard → schematic (Phase 3)

- Unlock the existing dual-view data model (fix B1): same parts + connections, per-view positions/routes in `schematic.pos/routes`, schematic symbols from the already-imported `schematicView` SVGs (`terminalId`-anchored pins).
- **Ratsnest, not magic**: when entering schematic view, place unpositioned parts by a simple heuristic (MCU center, passives orbiting by connectivity), draw grey ratsnest lines for unrouted nets, and let the user pull real orthogonal wires — the engine already does absolute-bendpoint orthogonal routing. Auto-layout can improve later (ELK layered layout is a good web-native fit).
- **Schematic niceties that KiCad export needs anyway**: net labels and power symbols (GND/3V3 as parts with `netlabel` semantics — Fritzing models them as SymbolPaletteItems joining nets by name), reference designators (auto-assign R1/C2/D3 from family), and value fields surfaced from `attrs`.

### 6.4 KiCad export (Phase 4)

Two deliverables, in order of increasing effort:

1. **Netlist export** (fast, high value): emit a KiCad S-expression netlist (`(export (version "E") (components …) (nets …))`). Components carry ref/value/footprint; nets list `(node (ref R1) (pin 1))`. KiCad's pcbnew imports this directly ("Import Netlist") — users get PCB layout from a tinyStudio breadboard without a schematic. Requirements: net model (have), refdes (Phase 3), a **footprint mapping table** per part (`resistor → Resistor_THT:R_Axial_DIN0207…`, stored in `PartDef.kicad.footprint`, user-overridable in the Inspector).
2. **`.kicad_sch` export**: generate KiCad 8/9 S-expression schematics — symbol instances from a **symbol mapping table** (`PartDef.kicad.symbol` → `Device:R` etc., with per-pin number mapping), positions scaled from `schematic.pos` (KiCad grid = 1.27 mm; snap), wires from routed segments, net labels carried over. Unmapped parts fall back to a generated generic symbol (rectangle + named pins) so export never blocks. Validate by round-tripping demo projects into KiCad and running ERC there.

### 6.5 Fritzing import, productized (Phase 1–2, per Part IV)

`.fzpz` drop-in import, bus + pinType + leg extraction, id namespacing, persisted user/project libraries, full-core catalogue QA, and an optional "parts pack" download so the app stays lean.

---

## Part VII — Feature roadmap

**Phase 0 — Stabilize (1–2 weeks of focused work)**
Fix B2 (`*` decoding), B3 (preserve unknown keys), B4/B5 (stable wire identity + dedupe), B6 (SVG id namespacing), B10, B20, B23; remove dead `CircuitEditor.tsx` (B21). Add draft-state dragging + undo/redo stack (B11) — do this before any new features multiply the mutation surface. Add multi-select/copy/paste/nudge (B12). CI check: every demo `diagram.json` passes `wokwi-cli lint` after normalization.

**Phase 1 — Parts pipeline (2–4 weeks)**
In-app `.fzpz` import; persist custom/imported parts per-project + global library (B7); importer emits `buses`/`pinType`/`leg`; wire `busesFor` into `buildNets` (B8); junction endpoints become host-referencing (B9); full `fritzing-parts` core import QA + downloadable catalogue pack; Wokwi type alias table + "Export for Wokwi" normalizer (B15/B16).

**Phase 2 — Best breadboard view ever (4–8 weeks)**
Procedural breadboard parts with row/rail buses; drop-to-connect + snapping + stickiness; hole/net hover intelligence; bendable legs; curved jumpers; family part-swap in the Inspector; alignment guides; performance pass (B17: spatial hash, memoized nets/junctions) targeting 500+ connectors; camera/zoom polish (B18/B19); basic ERC warnings (B22: shorts, floating pins, LED-without-resistor).

**Phase 3 — Schematic view (4–6 weeks)**
Unlock the view toggle (B1); ratsnest for unrouted nets; auto-placement heuristic; net labels + power symbols; auto reference designators + value fields; mirror/flip (B13); schematic-quality wire styling (junction dots per IEEE convention, 4-way-junction avoidance).

**Phase 4 — KiCad export (3–5 weeks)**
Footprint/symbol mapping tables in `PartDef` + Inspector overrides; KiCad netlist export (pcbnew-ready); `.kicad_sch` generation with generic-symbol fallback; round-trip validation against KiCad ERC on the demo projects.

**Phase 5 — Beyond (ongoing)**
Wokwi-elements rendering option for simulatable parts (the `@wokwi/elements` web components are open source, giving pixel-identical Wokwi visuals); in-app simulation via Wokwi; auto-routing assistance in schematic view; community parts sharing; PCB preview via KiCad CLI.

**Dependency chain:** Phase 0 → 1 → 2 are strictly ordered (undo before breadboard; buses before breadboard). Phase 3 needs Phase 1 (schematic SVGs + terminal anchoring). Phase 4 needs Phase 3 only for `.kicad_sch` — the netlist exporter needs just Phases 0–1 and could ship early as a teaser.

---

## Appendix A — File/format quick reference

- Fritzing part: `.fzp` XML + `svg/<section>/{breadboard,schematic,pcb,icon}/*.svg`; bundle: `.fzpz` (ZIP). Sketch: `.fz` XML; bundle: `.fzz` (ZIP).
- tinyStudio part: `src/renderer/src/assets/parts/<type>.json` (`PartDef`), manifest `index.json`, import report `_report.json`.
- tinyStudio diagram: `<project>/diagram.json` — Wokwi `version/author/editor/parts/connections` + tinyStudio `schematic` overlay + extensions (`d` moves, `{x,y}` junction endpoints).
- Wokwi journey: `["v10","h5","*","v-15","h10"]` — pre-`*` from source, post-`*` reverse from target, remainder auto-completed (tinyStudio must honor `*` on read; emits source-anchored lists on write).
- KiCad targets: S-expression netlist (pcbnew import) and `.kicad_sch` (KiCad 8/9), 1.27 mm grid, symbol libs like `Device:R`.

## Appendix B — Key source locations

- Fritzing: `src/model/modelpart*` (part model) · `src/connectors/{connector,connectoritem,bus}*` (connectivity) · `src/sketch/sketchwidget.cpp` + `breadboardsketchwidget.cpp` (view logic, `findConnectorsUnder`, ratsnest) · `src/items/wire.*` (segment/bendpoint wires) · `src/items/breadboard.*` (sticky, no-45°) · `src/svg/kicad2svg*` (KiCad import precedent) · `resources/parts/core/*.fzp` (canonical FZP examples, e.g. `dcpower.fzp` for buses + ERC metadata).
- tinyStudio: `components/DiagramEditor.tsx` (editor) · `lib/wireRouting.ts` (routing/bendpoints) · `lib/circuitNets.ts` (DSU nets) · `lib/partsLibrary.ts` (registry/schema) · `components/PartsEditor.tsx` (custom parts) · `scripts/fritzing-import.mjs` (FZP→PartDef converter) · `components/EditorPanel.tsx#CircuitView` (file binding).
