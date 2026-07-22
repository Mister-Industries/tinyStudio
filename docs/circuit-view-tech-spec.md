# tinyStudio Circuit View v2 — Technical Specification

**Status:** Approved-direction draft · **Date:** 2026-07-02 · **Owner:** Geoff / MR.INDUSTRIES
**Decisions locked:** ngspice-WASM simulation · JSON-superset file format · greenfield module (not an evolution of `DiagramEditor.tsx`)

---

## 0. One-paragraph vision

A brand-new Circuit View that runs alongside Code and Visual in tinyStudio: **a Fritzing-feeling breadboard editor and a CircuitLab-feeling schematic editor over one shared electrical model**, saved as a single local JSON file per project, simulated with real SPICE (ngspice compiled to WASM), able to import Fritzing parts (`.fzpz`) and Wokwi diagrams, able to export KiCad netlists and schematics, and fed by installable parts libraries hosted on GitHub — the way Arduino's Boards Manager loads board packages from index URLs. Effectively: **Fritzing's interaction model, refactored into TypeScript/Electron, with CircuitLab's simulation UX bolted on.**

This spec is written so an agent can start building without further context. Companion background document: `docs/circuit-architecture-and-roadmap.md` (deep dives on Fritzing internals, current-code bugs B1–B23, and format research). Implementation progress log: `docs/circuit-editor-progress.md` (branch `circuit-editor`).

**Platform contract (hard requirements):** runs in **both** the Electron desktop build and the web build (`build:web`) — no Node-only APIs in the renderer module; sim is WASM-in-worker (browser-native); pack storage falls back to IndexedDB on web. It mounts in the **same window slot** the Circuit view occupies today (`EditorPanel → CircuitView`), alongside Code/Visual — one integrated IDE, not a separate window.

---

## 1. Goals and non-goals

### Goals (in priority order)

1. **G1 — Dual-view editing.** Breadboard view (looks/feels like Fritzing) and schematic view (looks/feels like CircuitLab) over one net model. Move a wire in one, the ratsnest updates in the other.
2. **G2 — Local-first single file.** Everything (parts placement, wires, both view layouts, sim setup, probe positions) in `circuit.json` in the project folder. Human-diffable, git-friendly, versioned.
3. **G3 — Analog simulation.** DC operating point, DC sweep, transient, AC/frequency — CircuitLab's four modes — via ngspice-WASM in a worker. Visuals + nets first; MCU/firmware simulation explicitly deferred (future: tinyService backend).
4. **G4 — Parts as data.** One part schema serving both views + simulation + export. In-app part editor. Installable **part packs** from GitHub URLs (Boards-Manager pattern), including a default tinyStudio pack the app auto-loads.
5. **G5 — Import.** Fritzing `.fzpz` (single part) and bulk `fritzing-parts` conversion; Wokwi `diagram.json` (best-effort convert-on-open).
6. **G6 — Export.** KiCad netlist (pcbnew-ready) and `.kicad_sch`; Wokwi `diagram.json` (lossy, for simulation on wokwi.com); SVG/PNG image.
7. **G7 — Fits the IDE.** TypeScript, React 18, Redux Toolkit, Tailwind + tinyStudio design tokens, Electron + web build both work; sim engine loads lazily so the web build stays light.

### Non-goals (v2.0)

- PCB layout view (KiCad is the PCB tool; we export to it).
- MCU/digital co-simulation (Wokwi-style AVR/ESP32 emulation) — architecture leaves a seam for tinyService later (§10.6).
- Full Wokwi round-trip fidelity. Wokwi is an *import source* and *export target*, not the native format.
- Autorouting. Manual wires with great ergonomics beat a bad autorouter.
- Real-time animated current flow (Falstad-style). Possible later on top of the DC solver results.

---

## 2. What we keep, what we discard

### Keep (port into the new module as pure libraries — they are already good)

| Existing code | Fate |
|---|---|
| `lib/wireRouting.ts` | Keep ~as-is → `circuit/core/routing.ts`. Absolute bendpoints, orthogonal elbows, segment/vertex/endpoint drag math, simplify. Add `*`-aware journey decoding (bug B2). |
| `lib/circuitNets.ts` | Keep DSU approach → `circuit/core/nets.ts`. Wire in `busesFor` (B8), add implicit-connection edges (breadboard seating, §7.3), net labels (§8.4), junction refs (B9 fix). |
| `scripts/fritzing-import.mjs` | Extract the resolver (fzp parse, transform-chain math, unit scaling, anchor heuristics) into `circuit/import/fritzing/` shared by the CLI script **and** the in-app `.fzpz` importer. Extend: `buses`, `pinType`, `legId`, `<use>` resolution, id namespacing. |
| `PartsEditor.tsx` | Keep the UX; rewire to save PartDef v2 into the project/user pack (persistence, B7). |
| Design system (tokens, tactile buttons, dot grid, wire tube styling) | Keep. The new view must be visually indistinguishable from the rest of the IDE. |
| `EditorPanel.tsx` Circuit tab plumbing, `useProjectFile` | Keep the mount point; swap `DiagramEditor` for `CircuitView2` behind a feature flag during development. |

### Discard / replace

- `DiagramEditor.tsx` (2,000-line monolith: state, geometry, rendering, palette, inspector in one component) → replaced by the module in §3.
- `CircuitEditor.tsx` (legacy static viewer) → delete.
- Direct-to-file writes per pointermove → replaced by an in-memory document store with command-based undo, debounced serialization (§6).
- `diagram.json` as the native format → superseded by `circuit.json` v2 (§4). A migration shim converts old files on open (they are near-Wokwi, so the Wokwi importer handles them).

---

## 3. Architecture

### 3.1 Module layout (all under `src/renderer/src/circuit/`)

```
circuit/
  core/                      # ZERO React. Pure TS, unit-testable.
    model.ts                 # document types (§4), invariants, migration
    store.ts                 # CircuitDocument class: state + command dispatch + undo/redo + subscriptions
    commands.ts              # every mutation as a Command {do, undo, merge?} (Fritzing's QUndoStack, in TS)
    nets.ts                  # DSU net engine (+ buses, implicit, labels, junctions)
    routing.ts               # ported wireRouting
    geometry.ts              # transforms, rotation, snapping, spatial hash
    refdes.ts                # R1/C2/U3 auto-assignment
  parts/
    schema.ts                # PartDef v2 + PackManifest types (§5)
    registry.ts              # in-memory registry; resolution order: project → user packs → default pack → builtin
    packs.ts                 # pack fetch/install/update/cache from GitHub index URLs (§5.4)
    svg.ts                   # SVG sanitize, id-namespacing, symbol generation (generic fallback symbols)
  views/
    CircuitView.tsx          # shell: toolbar, view toggle, palette, inspector, statusbar
    canvas/
      Canvas.tsx             # camera, pointer routing, selection, marquee; renders active view
      BreadboardLayer.tsx    # parts, legs, breadboard, wires (Fritzing look)
      SchematicLayer.tsx     # symbols, wires, net labels, probes (CircuitLab look)
      WireGestures.ts        # drawing/editing state machines (§8)
    palette/  inspector/  simulator/   # SimPanel, plots (§10.5), probe UI
  sim/
    netlist.ts               # document → SPICE netlist (§10.2–10.3)
    engine.ts                # eecircuit-engine wrapper in a Web Worker; typed request/response
    results.ts               # vectors → probe series; units, cursors
  import/
    fritzing/                # fzp resolver, fzpz (zip) reader, fzz sketch reader (stretch)
    wokwi.ts                 # diagram.json → circuit.json
  export/
    kicadNetlist.ts  kicadSch.ts  wokwi.ts  image.ts
  index.ts                   # public API: mount, open/save, feature flag
```

**Rule:** `core/`, `parts/`, `sim/`, `import/`, `export/` never import React. Views subscribe to the store. This is the inverse of today's monolith and is what makes sim, importers, and exporters testable in Node/Vitest without a DOM.

### 3.2 State management

- **Document state** (the circuit itself) lives in `CircuitDocument` — a plain-TS class holding the parsed model, a command stack (undo/redo, command merging so a drag is one undo step), and a change-notification. React components use `useSyncExternalStore`.
- **Ephemeral UI state** (camera, hover, selection, active tool, drawing-in-progress) stays in React state within the view — never serialized.
- **App integration:** the document syncs to Redux `fileSlice` (dirty flag, save) via a debounced (250 ms) serializer, and listens for external content changes (user edits `circuit.json` in the Code tab) — last-writer-wins with a structural diff to avoid churn.
- Redux is *not* used for per-frame editing (that's what killed the old editor — B11).

### 3.3 Rendering

SVG, one `<svg>` scene per view (not DOM-divs-plus-SVG-overlay like today):

- Parts render as `<g transform>` wrapping their (sanitized, id-namespaced) SVG body. Rotation/flip on the group.
- Wires, junction dots, handles, ratsnest, pin hits are sibling layers in z-order: `board < parts < legs < wires < junctions < handles < overlays`.
- Pin hit targets scale inversely with zoom (min 10 screen px — B23).
- Perf budget: 500 parts / 1,500 wire segments at 60 fps pan/zoom (a full breadboard project). Achieved via: spatial hash for hit tests, memoized per-connection point caches keyed by a document revision counter, `will-change: transform` camera on the scene group, and virtualized palette lists. If SVG hits a wall past 2k elements, the escape hatch is rendering wires to a single `<path>` per net — decided by benchmark, not up front.

---

## 4. File format: `circuit.json` v2

One file per project (same slot `diagram.json` occupies today). JSON, 2-space, stable key order for clean diffs.

```jsonc
{
  "format": "tinystudio-circuit",
  "version": 2,
  "meta": { "author": "…", "created": "…", "modified": "…" },

  "packs": [                       // parts provenance — enables auto-install prompts
    { "id": "tinystudio-core", "version": "1.4.0", "url": "https://raw.githubusercontent.com/Mister-Industries/tinyparts/main/index.json" }
  ],

  "parts": [
    {
      "id": "R1",                  // == reference designator, unique, user-visible (§6.4)
      "type": "resistor",          // PartDef type within resolved packs
      "attrs": { "value": "220" }, // part-schema-declared properties (drive sim + BOM)
      "bb":  { "x": 480, "y": 240, "rotate": 0, "flip": false, "legs": { "1": [ -14, 28 ] } },
      "sch": { "x": 300, "y": 160, "rotate": 90, "flip": false }   // absent ⇒ unplaced (ratsnest)
    }
  ],

  "wires": [
    {
      "id": "w7",                  // stable id (B4 fix) — 8-char nanoid
      "from": "R1:2",              // "partId:pinName"
      "to":   { "wire": "w3", "t": 0.42 },   // OR a junction: parametric point on another wire (B9 fix)
      "view": "bb",                // each wire belongs to ONE view ("bb" | "sch")
      "color": "#2fa46a",          // bb only; schematic wires are always ink
      "route": ["h48", "v-19.2"],  // Wokwi-style journey, source-anchored; "d dx,dy" allowed in bb
      "curve": true                // bb only: render as bezier jumper (route still authoritative for hit tests)
    }
  ],

  "netLabels": [                   // schematic-only named nets (GND, 3V3, SDA…)
    { "id": "nl1", "name": "GND", "kind": "ground", "sch": { "x": 340, "y": 260, "rotate": 0 }, "pin": "nl1:1" }
  ],

  "sim": {
    "analyses": [
      { "id": "tran1", "kind": "tran", "step": "10us", "stop": "5ms", "enabled": true },
      { "id": "dc1",   "kind": "op", "enabled": true },
      { "id": "sweep1","kind": "dc", "source": "V1", "from": 0, "to": 5, "step": 0.05 },
      { "id": "ac1",   "kind": "ac", "sweep": "dec", "points": 20, "fstart": "1", "fstop": "1meg" }
    ],
    "probes": [
      { "id": "p1", "kind": "voltage", "at": "net:GND->led_anode", "label": "V(out)", "color": "#42a5f5" },
      { "id": "p2", "kind": "current", "at": "part:R1", "label": "I(R1)" }
    ]
  },

  "camera": { "bb": { "x": 0, "y": 0, "zoom": 1 }, "sch": { "x": 0, "y": 0, "zoom": 1 } }   // convenience, non-semantic
}
```

Design decisions and invariants:

- **Wires are per-view.** Breadboard wires and schematic wires are different physical objects (Fritzing models it the same way). The **net model is the shared truth**: a connection made in breadboard shows as ratsnest in schematic until the user draws the schematic wire, and vice versa. (This replaces v1's awkward `schematic.pos/routes` overlay where one connection was shared.)
- **Implicit connections are not stored.** Breadboard seating (pin-in-hole) is *derived* from geometry on load/edit — storing it would let the file lie. Same for junction net membership.
- **Junction endpoints reference the host wire** (`{wire, t}`), never a bare coordinate — they survive rerouting and deletion is cascaded (delete host ⇒ junction wires re-anchor to nearest pin of the host's net, or get flagged dangling).
- **Coordinates:** px @ 96 DPI. Grids: bb 2.54 mm = 9.6 px (holes), sch 4.8 px fine / 9.6 px major (CircuitLab uses a similar half-pitch feel). All pins land on-grid by part-schema contract.
- **`id` is the refdes** (`R1`, `LED2`, `U1`) — user-visible, auto-assigned by family prefix, editable with uniqueness enforcement. This makes netlists, BOM, and KiCad export trivially consistent.
- **Unknown keys are preserved** on round-trip (B3 fix): the serializer patches known sections and carries the rest.
- **Migration:** v1 `diagram.json` (and raw Wokwi files) are detected by shape and converted on open via the Wokwi importer + v1 shim; the file is rewritten as `circuit.json` v2 next save (old file kept as `diagram.json.bak` once).

**Why JSON, not XML:** everything downstream (Wokwi import, packs, TS tooling, git diffs) is JSON-native; Fritzing's XML buys nothing but familiarity to Fritzing itself. Fritzing compatibility lives in importers, not in the native format.

---

## 5. Parts system

### 5.1 PartDef v2 (per-part JSON)

```jsonc
{
  "schema": 2,
  "type": "resistor",
  "label": "Resistor",
  "family": "Passive",              // palette grouping + swap group + refdes prefix table
  "prefix": "R",                    // refdes prefix (falls back to family map)
  "description": "…",
  "tags": ["basic"],
  "properties": {                   // typed, Inspector-rendered, sim-visible
    "value":     { "kind": "spice-number", "default": "1k", "unit": "Ω", "label": "Resistance" },
    "tolerance": { "kind": "enum", "options": ["1%", "5%"], "default": "5%" }
  },

  "pins": [                         // single source of truth for pin identity/order
    { "name": "1", "type": "male", "erc": "passive" },
    { "name": "2", "type": "male", "erc": "passive" }
  ],
  "buses": [],                      // e.g. breadboard: [["1a","1b","1c","1d","1e"], …]

  "views": {
    "breadboard": {
      "svg": "…", "w": 68.5, "h": 9.6,
      "pins": { "1": [0.9, 4.8], "2": [67.5, 4.8] },
      "legs": { "1": true, "2": true }          // bendable rubber-band legs
    },
    "schematic": {
      "svg": "…", "w": 57.6, "h": 19.2,         // CircuitLab-style symbol art (§9.2)
      "pins": { "1": [0, 9.6], "2": [57.6, 9.6] },
      "labels": { "ref": [28.8, -4], "value": [28.8, 26] }   // default text anchor slots
    }
  },

  "spice": {                        // §10.3 — omit ⇒ part is sim-transparent or sim-blocking per `ercRole`
    "template": "R{REF} {1} {2} {value}",
    "models": []                    // optional .model / .subckt cards to emit once
  },
  "kicad":  { "symbol": "Device:R", "footprint": "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal", "pinMap": { "1": "1", "2": "2" } },
  "wokwi":  { "type": "wokwi-resistor", "attrs": { "value": "{value}" }, "pinMap": { "1": "1", "2": "2" } },
  "source": { "origin": "fritzing", "fzp": "resistor.fzp", "moduleId": "…" }
}
```

Notes:

- `pins[]` (ordered, typed) is new vs v1's per-view map — pin *names* stay the cross-view join key, but identity/ERC/type live view-independently.
- `spice.template` placeholders: `{REF}`, `{pinName}` (replaced with node names), `{property}`. Multi-line templates allowed (e.g. op-amp emits `X{REF} … opamp_model` and `models` carries the `.subckt`).
- The **breadboard part itself is a PartDef** generated procedurally (`breadboard-half`, `breadboard-full`, `breadboard-mini`): female pins named `a1…j63`, `power+/-` rails, `buses` for rows/rails. Generator lives in `parts/svg.ts` so sizes are parametric and SVG is crisp.
- **Generated schematic symbols:** parts lacking a schematic view get an auto-generated IC-style box symbol (name on top, pins on sides by `pins[]` order) so schematic view and KiCad export never block on missing art.

### 5.2 Registry and resolution

`registry.ts` resolves `type → PartDef` in order: **project parts** (`<project>/parts/*.json`) → **installed packs** (userData) → **default pack** (bundled) → **builtins** (tiny* boards, breadboards, net labels, sources/probes). First hit wins; the Inspector shows provenance. Lazy per-part loading stays (manifest eager, bodies on demand).

### 5.3 Pack format

A pack is a repo/folder: `pack.json` + `parts/*.json` (+ optional `README`, preview images).

```jsonc
// pack.json
{
  "schema": 1,
  "id": "tinystudio-core",
  "name": "tinyStudio Core Parts",
  "version": "1.4.0",              // semver; app checks for updates
  "homepage": "https://github.com/Mister-Industries/tinyparts",
  "parts": [ { "type": "resistor", "label": "Resistor", "family": "Passive", "file": "parts/resistor.json", "icon": "<svg…>", "pins": 2, "views": ["breadboard","schematic"], "sim": true } ]
}
```

### 5.4 GitHub distribution (Boards-Manager pattern)

- Settings → Parts Libraries: a list of **index URLs** (default seeded with the official tinyStudio pack index), exactly like Arduino's "Additional boards manager URLs".
- An index URL points to a JSON listing packs: `{ "packs": [ { "id", "name", "version", "url" (zip or raw dir), "sha256" } ] }`. Hosting a pack = a GitHub repo + a raw `index.json`; releases can serve zips.
- Install = download → verify hash → unpack to `app.getPath('userData')/parts-packs/<id>/<version>/` → register. Update check on launch (non-blocking). Web build: cache in IndexedDB/OPFS.
- Opening a project whose `packs[]` names an uninstalled pack prompts one-click install (this is why provenance is in the file).
- **Security:** parts contain SVG + templates only — sanitize SVG on install (strip scripts/foreign objects/event attrs, namespace ids), never eval anything. Spice templates are string substitution only.

### 5.5 Part authoring

- **In-app Part Editor** (evolved `PartsEditor`): SVG upload per view, click-to-place pins, pin type/name editing, property schema builder, spice/kicad/wokwi mapping tabs, live test-drop onto a scratch canvas. Saves to project parts or a local user pack (persistent — fixes B7).
- **`.fzpz` drop-import** shares the Fritzing resolver (§11.1) and lands the result in the same editor for review before save.

---

## 6. Core editing model

### 6.1 Commands and undo

Every mutation is a `Command` object (`AddPart`, `MovePart`, `DrawWire`, `RerouteWire`, `SetAttr`, `RotatePart`, `DeleteSelection`, `PasteClipboard`, …) with `do/undo` and optional `merge(prev)` (pointer-drag frames merge into one step). Stack depth 200. Cross-view effects (e.g. deleting a part removes its wires in both views) happen inside one composite command — Fritzing's cross-view command semantics, simplified because we have one document.

### 6.2 Selection and clipboard

Multi-select (click, shift-click, marquee), copy/paste/duplicate (offset + refdes reassignment), arrow-key nudge (grid step; shift = 5×), select-whole-net (double-click a wire in view mode). Clipboard is JSON on the system clipboard (`application/x-tinystudio-circuit`), enabling cross-project paste.

### 6.3 Geometry

Rotation 0/90/180/270 both views (45° increments allowed for bb wires' aesthetics, not parts, v2.0); horizontal/vertical flip in schematic (mirrored symbols are mandatory for readable schematics — B13). Snapping: parts snap so *pins* land on-grid (not the part origin — this is a subtle Fritzing behavior that makes everything line up).

### 6.4 Reference designators

Auto-assigned on add from `prefix`/family map (`R`, `C`, `D`, `LED`, `U`, `SW`, `J`); renaming validates uniqueness; renumber-all command (compacts gaps) offered before KiCad export.

---

## 7. Breadboard view — "feels like Fritzing"

The behaviors below are the Fritzing breadboard contract, restated as requirements (source analysis in the companion doc, Part I).

### 7.1 Look

- Photorealistic-style SVG parts (the Fritzing catalogue art, imported) on the tinyStudio dot-grid canvas; procedural breadboards with realistic hole geometry, row numbering, rail striping (red/blue).
- Wires: the existing glossy-tube rendering (dark outline → color core), rounded corners; optional **curved jumper** rendering (`curve: true`, cubic Bézier with sag proportional to length) matching Fritzing's signature look.
- Junction solder dots; yellow equipotential glow on hover (keep — it's better than Fritzing).

### 7.2 Placement interactions

- Drag from palette (ghost preview under cursor, pins highlight candidate holes); double-click to drop at center.
- **R**/right-click/Inspector to rotate; drag to move with wires holding their bends (existing absolute-bendpoint behavior — keep).
- Part swap within family from the Inspector (preserves id, attrs where compatible, and connections by pin name).

### 7.3 Drop-to-connect (the heart of it)

- On part drop/move-end: for each male pin, spatial-hash query for a female pin within snap radius (0.5 grid). If **all** seatable pins can seat with one rigid translation ≤ radius, snap the part and create **implicit connections** (derived, not stored — §4).
- Seated pins render a subtle green seat mark (Fritzing shows green square highlights); hovering a hole tooltips `e12 · net 4 (R1.2, LED1.anode)`.
- Row/rail buses come from the breadboard PartDef's `buses` and merge nets via `busesFor` (already supported by the DSU engine).
- Boards are **sticky**: parts seated on a breadboard move with it. Wire ends may plug directly into holes (wire-end = male pin), Fritzing-style.
- Bendable **legs** (`legs` in PartDef): leg endpoint drags independently of the body, rendered as a curved leg path; the pin position for netting is the leg tip. Body drag keeps seated leg tips anchored (rubber-band), matching Fritzing.

### 7.4 Wiring

Keep the current gesture set (it's already Fritzing-grade): click-pin → click-pin/hole/wire-body with orthogonal preview; Shift = straight/diagonal; click = bend while drawing; Esc cancels. Selected-wire editing: segment squares (perpendicular drag), bend circles, endpoint rings; double-click adds/removes bends. Junction taps clamp onto the host segment and store `{wire, t}`.

---

## 8. Schematic view — "looks like CircuitLab"

CircuitLab's editor reads as: white/paper background, fine grid, **black ink symbols and wires**, blue accents for selection/probes, value+refdes text next to every part, ground/named-net symbols instead of long wires, Build/Simulate modes on a bottom toolbar. That's the target ("CircuitLab skin" over our engine).

### 8.1 Look

- Canvas: `--bg` paper surface (light in light theme; dark theme uses ink-on-charcoal, staying within tinyStudio tokens), 4.8/9.6 px grid dots.
- Symbols: 2 px ink strokes, standard symbol library (IEEE-style zigzag resistor by default; IEC rectangle later as a setting — Fritzing offers both). Text: refdes above-left, value below-right by default, per-instance draggable (anchors in PartDef `labels`).
- Wires: 2 px ink, strictly orthogonal (no `d` moves in sch), solder dots at T-junctions; 4-way crossings never auto-join (must offset or dot deliberately — classic schematic hygiene).
- Net labels & power symbols: GND (three-bar), VCC/named flags — placeable parts (`netLabels`) that join nets by name (§8.4).

### 8.2 Ratsnest sync (the dual-view contract)

- **Either view can lead.** A part exists once; `bb` and `sch` placements are independent and each optional. Design schematic-first, breadboard-first, or mixed — the other view shows the part in its **"unplaced" tray** on the canvas edge; clicking one attaches it to the cursor for placement (better than Fritzing's pile-at-origin). The tray exists in *both* views.
- Nets connected in breadboard but not yet drawn in schematic render as light dashed **ratsnest** lines between nearest unconnected pins of the net. Drawing a real wire over a ratsnest satisfies it. Symmetrically, schematic-made connections show as ratsnest in breadboard.
- Status pill: `Nets: 9 · routed here: 6 / 9` per view.

### 8.3 Wiring

Same gesture engine as breadboard with schematic constraints: orthogonal only, wires may start/end on wire bodies (junction dot), dragging a part **drags wire ends with it and re-elbows** (absolute bendpoints already do this).

### 8.4 Net labels

A net label is a 1-pin builtin part whose net merges with every other label of the same name (`kind: ground` is just the name `GND` with the ground glyph). This gives clean schematics *and* named nets for netlists/KiCad (`GND`, `3V3`, `SDA`) — same mechanism Fritzing's SymbolPaletteItem uses.

---

## 9. ERC (lightweight, both views)

Non-blocking warnings panel + inline markers: floating pins on placed parts (info), directly shorted source terminals (error, uses `erc` pin types: `power-out` vs `power-out`), missing ground when sim requested (error — SPICE needs node 0), LED/diode with no series resistance to a source (warn, heuristic), single-pin nets with a wire (warn). Runs on the net model in a debounced worker-free pass (<5 ms typical).

---

## 10. Simulation (CircuitLab modes on ngspice-WASM)

### 10.1 Engine

- **Default: tscircuit's ngspice WASM build** (`tscircuit/ngspice`, the engine behind `tsci simulate` — MIT ecosystem, active project we want to align with). **Fallback: `eecircuit-engine`** (the original ngspice-WASM build it derives from; API: `new Simulation()` → `start()` → `setNetList(str)` → `runSim()`). Both sit behind the `SimBackend` interface; M4 opens with a 2-day bake-off (bundle size, cold-start, convergence on the golden netlists, error reporting quality) and the winner ships as default — "tscircuit if it really works well" is enforced by the abstraction. Runs in a **Web Worker** (module worker; WASM ~a few MB, lazy-loaded on first Simulate).
- **tscircuit alignment (decision):** we adopt **circuit-json as an interop layer**, not tscircuit's stack — tscircuit is code-first (TSX → auto-layouted circuit-json) with no interactive dual-view editor, so our document model stays ours. But emitting circuit-json from our net model unlocks their whole converter ecosystem (KiCad, Gerber, BOM, DSN) at near-zero cost. See §12.
- Wrap in `sim/engine.ts` with a typed protocol: `{ netlist, analyses } → { vectors | error(line, message) }`, cancellation (terminate+restart worker), and a 10 s watchdog.

### 10.2 Netlist generation (`sim/netlist.ts`)

1. Build nets (existing DSU) including implicit breadboard seats, buses, junctions, net labels.
2. Node naming: net containing a `GND` label ⇒ node `0`. Others: label name if present, else `n<index>` (stable ordering for diffable golden tests).
3. For each part with `spice.template`: substitute `{REF}`, `{pin}` → node names, `{prop}` → attr values (spice-number normalization: `220`, `4.7k`, `10u`). Collect `models` cards once per model name.
4. Emit analysis cards from `sim.analyses` (`.op` implicit for DC display; `.tran step stop`; `.dc SRC from to step`; `.ac dec points fstart fstop`).
5. Parts without spice mapping: 2-pin unknowns default to open (excluded, warn); breadboards/connectors are transparent (buses only); MCUs/boards are **excluded with an info banner** ("tinyCore is not simulated — model its pins with sources," and a pin-stub helper that lets the user pin a voltage source to a board pin). This is the seam where tinyService MCU co-sim plugs in later (§10.6).

### 10.3 Sources & instruments (builtin parts pack)

DC voltage/current source, battery, AC/sine source (amplitude, freq, phase), pulse/step source (CircuitLab's step sources), waveform generator (PWL, stretch). Probes: voltage (attach to net), current (attach through a part), differential voltage (2 pins). Probes are placeable 0/1-pin builtins rendered as CircuitLab-style flags; they populate `sim.probes`.

### 10.4 Modes & UX (mirrors CircuitLab's Build/Simulate)

- Bottom toolbar: **Build | Simulate** toggle. Simulate opens the Sim panel (docked bottom, resizable): analysis tabs (DC / DC Sweep / Transient / Frequency), parameters, **Run**.
- **DC (op):** after run, node voltages annotate the schematic next to nets (CircuitLab's killer teaching feature) and current arrows on part hover; breadboard view shows the same values on hole tooltips.
- **Transient / Sweep / AC:** plot area (uPlot — tiny, fast, MIT) with probe traces, cursors, zoom, log axes for AC (magnitude dB + phase), CSV export. Plot state (visible traces) persists in `sim`.
- Errors map back: ngspice message → offending part/net highlighted where parseable.
- Auto-rerun-on-edit toggle (debounced 500 ms) for the live-feel without a custom engine.

### 10.6 Future seam: MCU co-simulation

Out of scope, but the interface is defined now: a `SimBackend` abstraction (`spice-wasm` today). A future `tinyservice` backend can run firmware (Arduino CLI build → simavr/emulation on the service) and exchange pin states with the SPICE side per timestep. Nothing in v2 may assume "SPICE only" in UI copy or types.

---

## 11. Importers

### 11.1 Fritzing part (`.fzpz`, and bulk `fritzing-parts`)

- Shared resolver (from `fritzing-import.mjs`): fzp parse → per-view SVG → connector geometry via `svgId`/`terminalId` with full ancestor-transform accumulation → px @ 96 DPI. **Extensions (required):** `<buses>` → `buses`, connector `type` → `pinType`, `legId` → `legs`, `<use>`/`xlink:href` anchor resolution, SVG sanitize + id-namespace, ERC `etype` → pin `erc`.
- In-app: drop `.fzpz` on the palette (or File → Import Part) → unzip (`fflate`) → resolve → open in Part Editor pre-filled → save to project/user pack. `.fzpz` bundles SVGs with `svg.<view>.<name>.svg` naming — no repo layout needed.
- Bulk CLI (kept as a script) regenerates the default pack from a `fritzing-parts` checkout; `_report.json` triages coverage. Target: >90% of core breadboard parts clean; failures documented.
- Spice/kicad/wokwi mappings can't come from Fritzing — they come from a **curated overlay table** in the default pack (hand-maintained for the ~100 most-used parts; everything else imports as visual-only and still nets/exports via generated symbols + generic footprint prompt).
- Stretch: `.fzz` sketch import (instances+connects → parts+wires; per-view geometry maps cleanly — see companion doc §1.5).

### 11.2 Wokwi diagram (`diagram.json`)

- Detect by shape (`version: 1` + `parts[].type` strings). Convert: `wokwi-*`/`board-*` types via the same overlay mapping table (reverse direction), `left/top/rotate/attrs` → `bb` placement, connections → bb wires (**honor the `*` journey instruction**: pre-`*` from source, post-`*` reversed from target — B2), colors kept.
- Unmapped Wokwi types: placeholder part with correct pin names scraped from the connection list (pins at generated positions), flagged in an import report. `serialMonitor`/`dependencies` preserved in an `x-wokwi` passthrough key for later export.
- tinyStudio v1 `diagram.json` files ride this importer (plus `schematic.pos/routes` → `sch` placements).

## 12. Exporters

**Primary KiCad path (decision):** our document → **circuit-json** (`export/circuitJson.ts`) → **`circuit-json-to-kicad`** (`CircuitJsonToKicadSchConverter`, tscircuit, MIT) for `.kicad_sch`. Evaluated at M5 start; if fidelity falls short (symbol mapping, wire routing, label support), we fall back to our own writers below — the netlist writer is trivial enough to keep regardless.

### 12.1 KiCad netlist (ships first — needs only nets + refdes)

S-expression netlist (`(export (version "E") (components …) (nets …))`) with refdes, `value` from attrs, footprint from `kicad.footprint` (Inspector-overridable; unmapped → dialog with footprint field). Imports directly into pcbnew ("File → Import Netlist"). Golden-file tests against KiCad 9 import.

### 12.2 `.kicad_sch`

KiCad 8/9 s-expression schematic (dev-docs.kicad.org spec): embedded `lib_symbols` (either referenced standard symbols like `Device:R` from `kicad.symbol`, or our generated generic box symbols serialized as full symbol defs so the file is self-contained), symbol instances from `sch` placements (px → mm, snapped to 1.27 mm grid, rotation/mirror mapped), wires from routed segments, junctions, labels from netLabels, `.op`-style text notes skipped. Validation: file opens in KiCad ≥8 with zero ERC *format* errors on demo projects; electrical ERC issues are the user's circuit's business.

### 12.3 Wokwi export (lossy, for wokwi.com simulation)

Types via mapping table (parts without `wokwi.type` → error list), junction endpoints normalized to pin-anchored fan-outs, `d` segments staircased, colors kept, `x-wokwi` passthrough restored. Validated with `wokwi-cli lint` in CI.

### 12.4 Image

SVG (vector, exact scene) and PNG @2×, per view, with the tinyStudio watermark. Fixes the id-collision corruption via the namespacing done at registry time.

---

## 13. tinyStudio integration

- `EditorPanel.CircuitView` mounts `circuit/index.ts` behind a feature flag (`settings.circuitV2`, default off until M4) — old editor remains during development; the flag flips per-project once `circuit.json` exists.
- File plumbing: `useProjectFile('circuit.json', defaultDoc)` (with `diagram.json` migration probe), Redux `updateFileContent` on the debounced serializer, Code-tab `</>` deep link kept.
- AI assistant: expose a small imperative API (`getDocument()`, `applyOperations(ops[])`, `getNetlist()`) so Studio AI can read/modify circuits and reason over netlists — the current "Auto-wired by Studio AI" flow ports over.
- Web build: everything works except pack install to disk (uses IndexedDB) — ngspice-WASM is browser-native, Electron not required for sim.

## 14. Testing

- **Unit (Vitest, no DOM):** routing math (port existing behaviors as table tests), DSU nets incl. buses/junctions/labels, netlist golden files (RC divider, RC transient, RLC AC, diode+LED sweep), fzp resolver against a fixture set of ~30 real Fritzing parts (incl. transform-heavy and `<use>`-based ones), Wokwi import golden files (incl. `*` journeys), KiCad exports parsed with a minimal sexpr reader.
- **Sim integration:** run eecircuit-engine in CI (Node worker) on the golden netlists; assert vector shapes + spot values (±1%).
- **Interaction (Playwright):** draw wire, drag part with bends held, drop-to-connect on breadboard, undo/redo depth, dual-view ratsnest sync, simulate-and-plot smoke test.
- **Manual QA matrix:** the 4 demo projects rebuilt in v2, exported to KiCad and opened, exported to Wokwi and linted.

## 15. Milestones

| # | Deliverable (demoable) | Contents | Est. |
|---|---|---|---|
| **M0** | Core skeleton | `core/` model+store+commands+undo, ported routing/nets with fixes (B2, B4, B9, B10), file load/save/migration, feature-flag mount, unit test rig | 2 wk |
| **M1** | Breadboard editor parity | Canvas/camera, palette (packs read-only from bundled default), place/move/rotate/wire/junction/inspector, multi-select+clipboard+nudge, SVG/PNG export — *matches old editor, plus undo* | 3 wk |
| **M2** | Real breadboard + parts pipeline | Procedural breadboards, drop-to-connect+sticky+legs, hole tooltips; `.fzpz` drop-import; Part Editor v2 with persistence; pack manager UI + GitHub index install; default pack regenerated with buses/pinType/legs | 4 wk |
| **M3** | Schematic view | View toggle, symbol rendering, unplaced tray + ratsnest sync, net labels/ground, flip/mirror, ERC panel, refdes system | 4 wk |
| **M4** | Simulation | Sources/probes builtins, netlist gen, worker engine, Build/Simulate UI, DC annotations, transient/sweep/AC plots, error mapping. Flag default ON; old editor removed | 4 wk |
| **M5** | Interop | KiCad netlist + `.kicad_sch` export, Wokwi import/export + lint CI, curated mapping overlay (top 100 parts), `.fzz` import (stretch) | 3 wk |

Dependencies: M0→M1→M2; M3 needs M0/M1 (not M2); M4 needs M3 (probes/labels); M5's netlist exporter can start after M3. Two agents can parallelize M2 ∥ M3 after M1.

## 16. Decisions (open questions resolved 2026-07-02)

1. **Filename:** `circuit.json`; old `diagram.json` migrated on open. ✅
2. **Theme:** both views follow the tinyStudio design system / Design Guide tokens (no forced paper-white); a "paper" style is an *export* option only. ✅
3. **Symbol standard:** US/IEEE default, IEC later as a setting. ✅
4. **Default pack hosting:** new `tinyparts` repo under Mister-Industries; CI runs the bulk importer and publishes `index.json`. ✅
5. **Mapping overlay:** lives in the `tinyparts` repo, community-PR-able. ✅
6. **Licensing:** approved — ship converted CC-BY-SA Fritzing art in the default pack with a per-pack ATTRIBUTION file; behaviors (not code) ported from GPLv3 fritzing-app; tinyStudio is GPL-3.0 so either is compatible. ✅
7. **Sim engine:** **tscircuit's ngspice build is the default**, eecircuit-engine the fallback, both behind `SimBackend`, winner confirmed by the M4 bake-off (§10.1). KiCad export goes through circuit-json + `circuit-json-to-kicad` first (§12). ✅
8. **M1 look:** pixel-identical wires/canvas to the current editor — "same editor, now with undo." ✅

## 17. Risks

- **ngspice-WASM robustness** (nonconvergence on user circuits): mitigate with `.options` defaults (gmin stepping, itl bumps), watchdog, and readable error mapping. CircuitLab hides SPICE-isms well; we should crib their error copy tone.
- **Fritzing SVG variance** (transforms, `<use>`, fonts, CSS): the resolver already handles the worst; budget real time in M2 for the long tail; `_report.json` keeps it honest.
- **Scope gravity on the schematic view**: CircuitLab look is a *skin* discipline — resist rebuilding their whole parameter-expression system in v2 (plain values + spice-number parsing only).
- **Dual-view confusion** (users expect wires to teleport between views): ratsnest + status pills + a first-run tour mitigate; this is Fritzing's model and it's learnable.

---

## Appendix — External references

- Wokwi diagram format: https://docs.wokwi.com/diagram-format (journey mini-language incl. `*`)
- Wokwi elements (MIT, visuals only): https://github.com/wokwi/wokwi-elements
- eecircuit-engine (ngspice WASM): https://github.com/eelab-dev/EEcircuit-engine · demo https://eecircuit.com · alternative build https://github.com/tscircuit/ngspice
- KiCad s-expression schematic spec: https://dev-docs.kicad.org/en/file-formats/sexpr-schematic/index.html
- CircuitLab UX reference: https://www.circuitlab.com/docs/the-basics/ (Build/Simulate modes, DC/Sweep/Transient/Frequency)
- Fritzing internals + current-code bug catalogue: `docs/circuit-architecture-and-roadmap.md` (this repo)
