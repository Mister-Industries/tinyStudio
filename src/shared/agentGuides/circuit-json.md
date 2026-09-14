# circuit.json — the Circuit view's file

The attached screenshot is the Circuit view: the parts rail on the left and the breadboard canvas, with a tinyCore, a resistor and an LED wired up. The Circuit view has two views of the same circuit, **breadboard** and **schematic**, plus a simulator.

**To know what's connected, call `inspect_circuit`** rather than reading the file. Parts pushed into breadboard holes are connected without any wire, and that connection is worked out from positions, so it never appears in the file.

## Format (v2)

```jsonc
{
  "format": "tinystudio-circuit",
  "version": 2,
  "parts": [
    { "id": "U1",  "type": "tinycore", "bb": { "x": 150, "y": 240 } },
    { "id": "R1",  "type": "resistor", "attrs": { "value": "220" }, "bb": { "x": 480, "y": 240, "rotate": 90 } },
    { "id": "LED1", "type": "led-generic-5mm", "bb": { "x": 364.8, "y": 144 }, "sch": { "x": 300, "y": 160 } }
  ],
  "wires": [
    { "id": "w1a2b3c4", "from": "U1:D13", "to": "R1:Pin 0", "view": "bb", "color": "#2fa46a" },
    { "id": "w5d6e7f8", "from": "R1:Pin 1", "to": "LED1:anode", "view": "bb" },
    { "id": "w9g0h1i2", "from": "LED1:cathode", "to": { "wire": "w1a2b3c4", "t": 0.5 }, "view": "sch" }
  ],
  "netLabels": [ { "id": "nl1", "name": "GND", "kind": "ground", "sch": { "x": 340, "y": 260 } } ],
  "sim": { "analyses": [], "probes": [] }
}
```

- **Parts**
  - `id` is the reference designator the user sees (`R1`, `LED2`, `U1`), unique in the file.
  - `type` must be a real part type from the library.
  - `attrs` holds the part's properties (resistor `value`, LED `color`, …).
  - `bb` / `sch` are placements in each view: `x`, `y` in px at 96 DPI (a breadboard hole every 9.6 px), plus optional `rotate` (0/90/180/270) and `flip`.
  - A part without a placement for a view sits unplaced in that view's tray.
- **Wires**
  - `from` / `to` is `"partId:pinName"`, or a junction on another wire: `{ "wire": id, "t": 0–1 }`.
  - Each wire belongs to **one** view (`"bb"` or `"sch"`); the connection it makes counts in both.
  - `route` (optional) is the drawn path; `color` and `curve` apply to breadboard wires only.
- **netLabels** (schematic only): labels with the same `name` are connected. `GND`, `3V3` and the like tie nets together without wires.
- Keys the app doesn't know are kept as-is when it saves.

## Pin names

Pin refs use the part's own pin names, which vary by part: `resistor:Pin 0`, `led-generic-5mm:anode`, `tinycore:D13`. **Never invent a part type or pin name.** Get them from `find_parts`, or from parts already in the file.

The tinyCore part (`type: "tinycore"`) names its pins:
- left header: `GND`, `3V3`, `A5`, `A4`, `A3`, `A2`, `A1`, `A0`
- right header: `D8`–`D13`, `3V3.2`, `GND.2`
- bottom header: `SCK`, `MO`, `MI`, `RX`, `TX`, `SDA`, `SCL`, `PWR` (I2C power, GPIO 6), `GND.3`

`D13` in the circuit is `13` in code, and `A0` is GPIO 18. `inspect_circuit` does this translation for you, and the full table is in `read_guide("tinycore")`.

## Editing by hand — rules

- **Prefer small, safe edits**: change `attrs` values, rename or add a wire between pins of parts that are already placed, add or rename a net label.
- **Adding parts**
  - Copy an existing part's shape, and use a type and pins from `find_parts`.
  - Give it a fresh unique `id` with the usual prefix (R, C, LED, U, SW…).
  - Either place it near related parts (on the 9.6 px grid) or leave out `bb`/`sch` so it lands in the tray.
- **New wires**
  - Need a unique 8-character `id` of lowercase letters and digits, and a `view`.
  - Leave out `route` and the editor draws a direct path the user can tidy up.
- Don't hand-compute breadboard hole positions to seat parts. Layout is the user's job: describe where things go and let them drag parts in the Circuit view.
- If the project only has a v1 `diagram.json`, don't edit it. The app converts it to `circuit.json` the first time the Circuit view opens, so ask the user to open Circuit once.
- After editing, tell the user to open the **Circuit** view to check the result. Then make sure the `.ino` pin constants match (call `inspect_circuit` again).
