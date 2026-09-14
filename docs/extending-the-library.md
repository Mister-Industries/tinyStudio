# Extending the library

tinyStudio is meant to grow. There are two things you'll add most often:

1. **Parts**: components that show up in the Circuit view's palette.
2. **Example projects**: ready-to-open folders in the
   [tinyStudio-examples](https://github.com/Mister-Industries/tinyStudio-examples) repo.

---

## 1. Parts

Parts don't live in this repo. They live in
**[tinyparts](https://github.com/Mister-Industries/tinyparts)**, one folder per
part:

```
tinyparts/packs/core/parts/switch-spst/
  part.json        name, category, real size, pin names
  breadboard.svg   the art (open it in Illustrator)
  schematic.svg    optional
  icon.svg         optional palette tile
```

Pins are the shapes in the SVG whose id is `pin-<NAME>`. The app reads their
positions from the art, so moving a pad moves the pin.

The quickest way to start a new part:

```bash
npm run parts:new -- my-sensor --pack core --label "My Sensor"
```

Or open the Parts editor (components rail **+**), upload an SVG, and save.
The complete guide covers where everything is, Illustrator export settings,
seeing edits live in `npm run dev`, and publishing to everyone:
**[parts-and-art.md](parts-and-art.md)**.

**The coordinate system.** Pin coordinates are **pixels at 96 DPI, measured from
the part's top-left corner**. This is the same space
[Wokwi](https://docs.wokwi.com/diagram-format) uses, which lets a part drop
straight into a `diagram.json`.

**Pin names are the contract.** A connection in `diagram.json` refers to a pin by
`partId:pinName`. Keep pin **names stable**, and the same across the breadboard
and schematic views of a part.

### From Fritzing

[`scripts/fritzing-import.mjs`](../scripts/fritzing-import.mjs) converts
[Fritzing](https://fritzing.org/) parts and resolves their pin coordinates. Turn
its output into tinyparts folders with `parts-tool explode`. See
[`scripts/README.md`](../scripts/README.md).

---

## 2. Adding an example project

An example is just a folder under `basics/` (or `advanced/`) in the
[tinyStudio-examples](https://github.com/Mister-Industries/tinyStudio-examples) repo, with a fixed
shape. tinyStudio opens any such folder with **Files → Open Folder**; add an entry to that repo's
`examples.json` to list it in the **Examples** tab.

### Folder layout

```
my-example/
  my-example.ino    ← the Arduino sketch (Arduino requires the .ino to share
                       its folder's name)
  diagram.json      ← the circuit (Circuit view)
  visual.js         ← the p5 sketch (Visual view), optional
  README.md         ← how to run it
```

The [Qwiic Joystick](https://github.com/Mister-Industries/tinyStudio-examples/tree/main/basics/qwiic-joystick)
example is a complete reference — copy it and edit. The pieces:

### `my-example.ino`

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
  omit it and tinyStudio auto-routes (see [blink-basic's diagram.json](https://github.com/Mister-Industries/tinyStudio-examples/blob/main/basics/blink-basic/diagram.json)
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
[Qwiic Joystick README](https://github.com/Mister-Industries/tinyStudio-examples/blob/main/basics/qwiic-joystick/README.md)
as a template, then add an entry to tinyStudio-examples' `examples.json`.

### Test it

`npm run dev` → **Files → Open Folder** → pick your example folder → walk the
**Code / Circuit / Visual** views, then **Verify** and **Upload** to a board.

---

## Checklist

**New part** (details in [parts-and-art.md](parts-and-art.md))

- [ ] Folder in `tinyparts/packs/<pack>/parts/<type>/` with `part.json` + `.svg` art
- [ ] Pads named `pin-<NAME>`; names match across breadboard / schematic
- [ ] Looks right and wires up in `npm run dev` with the tinyparts folder set
- [ ] `npm run parts:check` passes, then commit + push tinyparts

**New example**

- [ ] `basics/<name>/<name>.ino` in tinyStudio-examples (folder and sketch share a name)
- [ ] `diagram.json` references valid part `type`s and pin names
- [ ] `README.md` with a pin map
- [ ] (optional) `visual.js` reacting to serial via `serialEvent()`
- [ ] Entry added to tinyStudio-examples' `examples.json`
