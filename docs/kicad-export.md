# KiCad export

**Export → KiCad HAT project** in the Circuit view turns a circuit built on a
tinyCore into a KiCad 10 project for a HAT: a board that plugs onto the tinyCore
by its headers. In the desktop app the files go into a `KiCad/` folder in the
project; in the browser they download as a zip.

| File                  | What it is                                                                                                                                                                         | Written                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `<project>.kicad_sch` | The schematic: KiCad stock symbols, net labels, ground symbols, no-connect flags. The tinyCore is drawn as its three headers, J1–J3.                                               | Every export              |
| `<project>.kicad_pcb` | The blank HAT from tinyMove: octagon outline, no mounting holes, the J1–J3 headers in place on their nets and linked to their schematic symbols, tinyMove's board setup and rules. | First export only         |
| `<project>.kicad_pro` | The project, with tinyMove's design rules, pointing at this schematic.                                                                                                             | First export only         |
| `<project>.net`       | The netlist, for importing into the board without the schematic.                                                                                                                   | Every export              |
| `fp-lib-table`        | Project entries for KiCad's stock footprint libraries the parts use (`Capacitor_THT`, `Button_Switch_THT`, …).                                                                     | First export, when needed |
| `sym-lib-table`       | The same for the stock symbol libraries (`Device`, `Switch`, `power`, …).                                                                                                          | First export, when needed |
| `README.txt`          | The steps below, and any export notes.                                                                                                                                             | Every export              |

## In KiCad

1. Open `KiCad/<project>.kicad_pro`.
2. Open the schematic. Run **Inspect → Electrical Rules Checker** if you like:
   an export passes with no errors.
3. **Tools → Update PCB from Schematic → Update PCB.** Every part appears beside
   the HAT with its ratsnest to the headers.
4. Place, route, run DRC.

Exporting again after changing the circuit rewrites the schematic, netlist and
README and leaves the board, project and library tables alone. Run Update PCB
from Schematic again to bring the changes onto your layout. The symbol and
sheet UUIDs are derived from the project name and reference designators, so the
same part keeps linking to the same footprint.

## How the schematic is built

`circuit/export/kicadSch.ts`, from the same netlist the `.net` export uses
(`export/kicadNetlist.ts`), so the two always agree.

- **Symbols.** A part's KiCad symbol and footprint come from
  `export/kicadMap.ts`. The symbol definitions are copied into the file's
  `lib_symbols`, so it opens without any library installed; they live in
  `export/kicadSymbols.gen.ts`, generated from KiCad's own libraries by
  `node scripts/kicad-symbols.mjs --kicad <KiCad symbols folder>` (add a symbol
  to the script's list and re-run it). A part with no KiCad symbol gets a
  generated box with its pins, under `tinyStudio:`, and an export note.
- **Placement.** Each symbol goes where the part sits on tinyStudio's schematic
  view, scaled up to KiCad's larger symbols, snapped to the 50 mil grid and
  nudged down until it overlaps nothing. Unplaced parts form a row underneath.
  Reference and value go where KiCad's library puts them. The sheet is the
  smallest of A4–A1 that fits, portrait when the layout is tall.
- **Connections.** Every connected pin gets a short wire and a net label; KiCad
  joins pins by label name. A pin on `GND` gets a ground symbol, and one
  `PWR_FLAG` marks ground as driven (every tinyStudio pin is passive, so ERC
  would otherwise report it undriven). A pin alone on its net gets a
  no-connect flag.
- **Linking to the board.** The HAT's header footprints carry
  `(path "/<symbol uuid>")`, and the project's one top-level sheet has the
  schematic's UUID, so Update PCB from Schematic updates J1–J3 instead of
  adding a second set.

## Footprints

Most parts use SparkFun's KiCad libraries
([SparkFun-KiCad-Libraries](https://github.com/sparkfun/SparkFun-KiCad-Libraries)),
which you add to KiCad once. Parts SparkFun has no through-hole footprint for
(the 6 mm button, the radial electrolytic capacitor) use KiCad's stock
libraries, which the project's `fp-lib-table` points at through
`${KICAD10_FOOTPRINT_DIR}`.

## Tests

`circuit/__tests__/kicadSch.test.ts` and `kicadHat.test.ts`: the file is
well-formed, every label sits on the end of a wire from its pin, wires are on
the grid, the same circuit exports byte-identical files, and the headers link
to their symbols. The format itself was checked in KiCad 10.0 with the
`tinyProto_Demo` project: ERC with no errors or warnings, and Update PCB from
Schematic with no errors.
