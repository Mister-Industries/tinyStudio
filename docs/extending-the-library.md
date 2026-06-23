# Extending the library

tinyStudio is meant to grow. There are two things you'll add most often:

1. **Custom parts** — components that show up in the Circuit view's palette.
2. **Example projects** — ready-to-open folders under [`demo/`](../demo).

This guide covers both, end to end, with a worked example of each that already
lives in the repo so you can copy from a known-good starting point.

---

## 1. Adding a custom part

### How parts are stored

Every part is a single JSON file in
[`src/renderer/src/assets/parts/`](../src/renderer/src/assets/parts), plus one
lightweight entry in
[`index.json`](../src/renderer/src/assets/parts/index.json) (the "manifest").

- The **manifest** is loaded up front — it's what fills the components rail
  (label, family, palette icon, pin count).
- The **per-part file** is **lazy-loaded** only when that part is actually placed,
  so opening one family doesn't pull the SVGs for the whole catalogue.

The registry, schema, and loading logic all live in
[`src/renderer/src/lib/partsLibrary.ts`](../src/renderer/src/lib/partsLibrary.ts) —
that's the source of truth if you ever need to check a type.

> **Flat directory, on purpose.** Part files sit directly in `parts/` (no
> sub-folders). Vite's dynamic-import globbing only supports a single path
> segment, so the family grouping lives in the manifest, not in directories.

### The part schema

A part file looks like this (`PartDef`):

```jsonc
{
  "type": "switch-spst",          // unique id; matches the filename and the manifest
  "label": "Slide Switch (SPST)", // shown in the palette
  "family": "Switch",             // groups parts in the components rail
  "description": "…",             // optional
  "views": {                      // one or both of: breadboard, schematic
    "breadboard": {
      "svg": "<svg …>…</svg>",    // inline SVG, viewBox set, no width/height
      "w": 60,                    // display size in px
      "h": 40,
      "pins": {                   // pin name → [x, y] in px from the part's top-left
        "1": [12, 38],
        "2": [48, 38]
      }
    }
  }
}
```

**The coordinate system.** Pin coordinates are **pixels at 96 DPI, measured from
the part's top-left corner** — the same space [Wokwi](https://docs.wokwi.com/diagram-format)
uses. That's what lets a part drop straight into a `diagram.json` and lets wires
land exactly on the pin.

**Pin names are the contract.** A connection in `diagram.json` refers to a pin by
`partId:pinName`. Keep pin **names stable across the breadboard and schematic
views** of the same part — that's what lets a wired-up circuit survive a
view switch and stay valid.

### Worked example — a hand-authored part

The repo ships a deliberately simple, hand-written part you can copy:
[`switch-spst.json`](../src/renderer/src/assets/parts/switch-spst.json). It's a
2-pin SPST slide switch with a small inline SVG and two pins at the tips of its
legs.

To make your own from scratch:

1. **Create the file.** Copy `switch-spst.json` to
   `src/renderer/src/assets/parts/<your-type>.json` and edit it. Draw the SVG so
   `(0,0)` is the top-left and the leg tips land where wires should attach, then
   read the pin coordinates off your SVG.

2. **Register it in the manifest.** Add one entry to the `parts` array in
   [`index.json`](../src/renderer/src/assets/parts/index.json):

   ```jsonc
   {
     "type": "switch-spst",
     "label": "Slide Switch (SPST)",
     "family": "Switch",
     "familySlug": "switch",
     "views": ["breadboard"],
     "pins": 2,
     "icon": "<svg …>…</svg>",   // palette thumbnail — reuse the view SVG if small
     "file": "switch-spst.json"
   }
   ```

   The `type` must match the filename (minus `.json`) and the `type` inside the
   part file.

3. **Run it.** `npm run dev`, open the Circuit view, and your part appears under
   its family in the components rail. Drag it onto the canvas and wire it up.

### Generating parts from Fritzing

For real-world components, hand-drawing SVGs is painful. tinyStudio can import
[Fritzing](https://fritzing.org/) parts and resolve their pin coordinates for you
with [`scripts/fritzing-import.mjs`](../scripts/fritzing-import.mjs).

```bash
# 1. Clone the Fritzing parts repo next to tinyStudio
git clone https://github.com/fritzing/fritzing-parts ../fritzing-parts

# 2. Try a couple parts first (recommended)
node scripts/fritzing-import.mjs --only resistor,LED-generic-5mm --views breadboard,schematic

# 3. …or import the whole core library
node scripts/fritzing-import.mjs --all --views breadboard,schematic
```

It writes one `<type>.json` per part, **merges** the manifest (`index.json`), and
drops a `_report.json` telling you which parts imported cleanly vs. had unresolved
pins. Run `node scripts/fritzing-import.mjs --help` for all options. `_report.json`
is git-ignored — it's a per-run diagnostic, not source.

Most of the existing catalogue (resistors, LEDs, transistors, …) was produced
this way; [`led-generic-5mm.json`](../src/renderer/src/assets/parts/led-generic-5mm.json)
is a good example of the output, including both views.

### Built-in tiny\* boards

The tiny\* boards (`tinyCore`, `tinyGlow`, …) aren't JSON files — they're authored
inline in [`partsLibrary.ts`](../src/renderer/src/lib/partsLibrary.ts) via the
`board()` helper, because their artwork is generated and their accent colors use
the app's CSS variables. If you're adding a board to the **tiny\* family**, add it
to the `BUILTIN_PARTS` array there; for everything else, prefer a JSON file.

---

## 2. Adding an example project

An example is just a folder under [`demo/`](../demo) with a fixed shape. There's
nothing to register — tinyStudio opens it with **Files → Open Folder**.

### Folder layout

```
My Example/
  my_sketch/
    my_sketch.ino   ← the Arduino sketch (its OWN folder — Arduino requires the
                       .ino to live in a folder of the same name)
  diagram.json      ← the circuit (Circuit view)
  visual.js         ← the p5 sketch (Visual view), optional
  README.md         ← how to run it
```

The [Fade Example](../demo/Fade%20Example) is a complete, minimal reference —
copy it and edit. The pieces:

### `my_sketch/my_sketch.ino`

A normal Arduino sketch. If you want it to drive the Visual view, print something
parseable, one value per line:

```cpp
Serial.println(brightness);   // visual.js reads this in serialEvent()
```

### `diagram.json`

The circuit. Same Wokwi-style format the Circuit editor reads and writes:

```jsonc
{
  "version": 1,
  "editor": "tinystudio",
  "author": "tinyStudio",
  "parts": [
    { "type": "tinycore", "id": "tinycore", "left": 150, "top": 240 },
    { "type": "resistor", "id": "resistor", "left": 470, "top": 230 },
    { "type": "led-generic-5mm", "id": "led", "left": 360, "top": 140, "rotate": 0 }
  ],
  "connections": [
    ["tinycore:SIG", "resistor:Pin 0", "#36c46b"],
    ["resistor:Pin 1", "led:anode", "#36c46b"],
    ["led:cathode", "tinycore:GND", "#8b94c8"]
  ]
}
```

- **`parts[]`** — each placed part: `type` (a part id from the library), a unique
  `id`, `left`/`top` in px, and optional `rotate` (degrees).
- **`connections[]`** — each wire is `[ "fromId:pin", "toId:pin", "#color" ]`. Pin
  names come from the part's `pins` (e.g. a resistor's are `Pin 0` / `Pin 1`, an
  LED's are `anode` / `cathode`). You can append a 4th element — an array of
  `"h<dx>"` / `"v<dy>"` segments — to pin the exact wire route, but it's optional;
  omit it and tinyStudio auto-routes (see the [Blink Example](../demo/Blink%20Example/diagram.json)
  for the explicit form).

> **Easiest path:** don't write `diagram.json` by hand. Drag parts and draw wires
> in the Circuit view, and tinyStudio saves the `diagram.json` for you. Hand-edit
> only when you want precise control.

### `visual.js` (optional)

A [p5.js](https://p5js.org/) sketch with the usual `setup()` / `draw()`. tinyStudio
adds one hook: it calls **`serialEvent(line)`** for every line the board prints, so
your visual can react to the hardware:

```js
function serialEvent(line) {
  const n = parseInt(line, 10);
  if (!isNaN(n)) brightness = constrain(n, 0, 255);
}
```

Hit **Export** in the Visual view to publish it as a standalone `index.html`
(those exports are git-ignored).

### `README.md`

Explain what it does, how to wire it, and the pin map. Follow the
[Fade Example README](../demo/Fade%20Example/README.md) as a template, then add a
row to the example table in the project [README](../README.md#example-projects).

### Test it

`npm run dev` → **Files → Open Folder** → pick your example folder → walk the
**Code / Circuit / Visual** views, then **Verify** and **Upload** to a board.

---

## Checklist

**New part**

- [ ] `parts/<type>.json` created (SVG with `(0,0)` top-left, pins read off the art)
- [ ] Matching entry added to `parts/index.json`
- [ ] `type` is identical in the filename, the file, and the manifest
- [ ] Pin names match across `breadboard` / `schematic` views
- [ ] Appears in the palette and wires up cleanly in `npm run dev`

**New example**

- [ ] `demo/<Name>/<sketch>/<sketch>.ino` (sketch in its own folder)
- [ ] `diagram.json` references valid part `type`s and pin names
- [ ] `README.md` with a pin map
- [ ] (optional) `visual.js` reacting to serial via `serialEvent()`
- [ ] Row added to the example table in the project README
