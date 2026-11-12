# Hardware standards: schematics, sheets and layout

How a tinyStudio KiCad export should look, and what to keep to when you finish
the board in KiCad. These are the schematic, drawing-sheet and layout
conventions of a working board-design SOP, kept general: nothing here is
tied to a company's logos, libraries, part numbers or colours.

Rules have IDs so reviews and code comments can point at them. The **Export**
column says what tinyStudio's KiCad export does for you
([kicad-export.md](kicad-export.md)); the rest is the designer's part.

## Tooling

| ID     | Rule                                                                                                | Export               |
| ------ | --------------------------------------------------------------------------------------------------- | -------------------- |
| TL-001 | KiCad 10 or later. Projects are saved in KiCad 10 format; older projects get an upgrade pass first. | Yes                  |
| TL-002 | Plot schematics and boards to PDF (Plot, not Print) for review.                                     | —                    |
| TL-003 | Run ERC and DRC before any review; fix everything possible and list each waiver with its reason.    | ERC: clean on export |

## Schematic

| ID      | Rule                                                                                                                                                                                            | Export                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| SCH-100 | 50 mil grid for everything: symbols, wire ends, labels.                                                                                                                                         | Yes                     |
| SCH-101 | Supply symbols (3V3, VCC, …) point **up**; GND points **down**. Use power symbols for supplies, not labels. On a pin that points down, add a short dog-leg so the supply arrow still points up. | Yes                     |
| SCH-102 | Signals between blocks use **global labels**, all of type `input` (a style choice, not an electrical claim), placed outside the wire end: left of left-side pins, right of right-side pins.     | Yes                     |
| SCH-103 | Pin-to-label and pin-to-component gaps on the 50 mil grid: at least 50 mil, preferably no more than 100 mil.                                                                                    | Yes (100 mil)           |
| SCH-104 | Page info filled: title, designer, company, date, and **revision = board version** with a dot (`v0.1`, `v1.0`).                                                                                 | Yes (designer: fill in) |
| SCH-105 | Value is just the value (`0.1uF`, not `0.1uF_0603_25V_20%`); every symbol has a datasheet link where one exists.                                                                                | Values: yes             |
| SCH-106 | Mounting holes are not grounded unless the design needs it.                                                                                                                                     | —                       |

### Presentation

A schematic is a document people review. Every sheet gets a presentation pass
before review.

| ID      | Rule                                                                                                                                                                                                                                                                                        | Export                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| SCH-110 | **No overlaps:** no text over text, symbols or wires; no wire through a symbol body or pin; no stray graphics.                                                                                                                                                                              | Yes                       |
| SCH-111 | **Wires make sense:** orthogonal; never over a component; no needless bends or dog-legs; junction dots only at real T-junctions; no 4-way junctions; net labels instead of long wires across blocks.                                                                                        | Yes (labels, short stubs) |
| SCH-112 | **Blocks:** every functional block has a large section title (3 mm, centred above it) and is separated from the others by **dashed lines, width 0, default colour**. Lines are straight, aligned and continuous. Components are centred under their title. Logos and holes are not a block. | Yes                       |
| SCH-113 | **Use the page:** blocks sized and arranged to fill the sheet evenly, not crowded into one corner.                                                                                                                                                                                          | Yes                       |
| SCH-114 | **Labels and spacing:** generic values that say nothing (`Conn_01x02`) may be hidden; real values (R, C, L, IC part numbers) stay visible. Reference designators and values readable, not rotated against the reader, not overlapping.                                                      | Yes                       |
| SCH-115 | **Title block:** title, designer, company, date, revision filled; nothing overlapping inside it; co-designer credits kept and placed cleanly.                                                                                                                                               | Partly                    |
| SCH-116 | **Paper:** US Letter. A design that doesn't fit gets a second sheet, not a bigger page.                                                                                                                                                                                                     | Yes (Letter when it fits) |
| SCH-117 | Notes: design notes in their own text block near the circuit they describe. Ordering instructions never go on the schematic (they belong on the PCB drawing sheet, LAY-119).                                                                                                                | —                         |

## Layout: grid, units, placement

| ID      | Rule                                                                                                                                 | Export                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| LAY-200 | Units: **inches / mils** for dimensions, grid and reports.                                                                           | —                                           |
| LAY-201 | Components on a **12.5 mil grid** (6.25 mil as the alternate).                                                                       | Placement follows the 0.1 in tinyProto grid |
| LAY-202 | Nudging to 10 / 5 / 1 mil only to make a trace straight or silkscreen line up; list every exception.                                 | —                                           |
| LAY-203 | No footprint origin finer than 0.5 mil.                                                                                              | Yes                                         |
| LAY-204 | Origin at a board corner (drill/place origin), Y up, so coordinates read cleanly.                                                    | —                                           |
| LAY-205 | Dimensions on User.Drawings, precision `0.00 in / 0 mils`; enough of them to work out any unmarked size; mounting holes dimensioned. | —                                           |
| LAY-206 | Courtyards don't overlap. Decoupling capacitors within 50 mil of their pin where the footprints allow.                               | Placement only                              |

## Layout: routing

| ID      | Rule                                                                                                                                                                                                           | Export                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| LAY-300 | Track widths: **signal 6 mil, power 10 mil, high current 22 mil, very high current 50 mil.** The board's track-width presets are exactly this set.                                                             | Presets and netclasses |
| LAY-301 | One width per net trunk. Power branches may neck down; main power tracks stay wide.                                                                                                                            | —                      |
| LAY-302 | **45° bends only, no 90° corners.**                                                                                                                                                                            | —                      |
| LAY-303 | Vias 24 mil pad / 12 mil drill.                                                                                                                                                                                | Preset                 |
| LAY-304 | Copper pours on top and bottom (GND), 8 mil clearance, thermal reliefs.                                                                                                                                        | Yes                    |
| LAY-305 | No floating or dangling tracks or vias (every via changes layer); zero unrouted nets.                                                                                                                          | —                      |
| LAY-306 | Route groups as a straight 45° bus; go straight to the target; enter pads at the centre of the pad edge; no squiggles; stitch GND with a via at component GND pads and at least two vias in every pour island. | —                      |

## Silkscreen and fab layers

| ID      | Rule                                                                                                                                                                                  | Export                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| SLK-400 | **Board name** on the board.                                                                                                                                                          | Yes                                |
| SLK-401 | Your logo(s) and the OSHW logo once (front preferred) if the design is open hardware.                                                                                                 | —                                  |
| SLK-402 | Pin labels on both sides of every header, 0.9 mm text.                                                                                                                                | Header pins: from the HAT template |
| SLK-403 | Vertical text: top of the text toward the board's left edge, on both sides (the back judged as seen from the back).                                                                   | —                                  |
| SLK-404 | Regular text 1.0 mm, minimum 0.8 mm.                                                                                                                                                  | Yes                                |
| SLK-405 | **Version text in bottom copper:** KiCad font, 1 mm / 0.25 mm, knockout.                                                                                                              | Yes                                |
| SLK-406 | Silk lines at least 0.15 mm (6 mil). **Every footprint field is hidden on silk**; Reference and Value live on F.Fab / B.Fab. Check again after Update PCB, which can show them again. | Yes                                |
| SLK-407 | Dashed silk: short dashes (about 1.6 mm dash, 0.8 mm gap at 16 mil), drawn as explicit segments.                                                                                      | —                                  |

## PCB drawing sheet

| ID      | Rule                                                                                                                                                                                                                                                                                          | Export                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| LAY-119 | **Ordering notes on the PCB sheet only:** inside the title-block area, a centred "Ordering Notes" heading, then solder mask, silkscreen colour, layers, thickness, finish / material, outer copper weight (User.Eco1). Directly above the title block, centred, the license line (User.Eco2). | —                       |
| LAY-120 | PCB title block filled to match the schematic (title, date, revision, company, designer).                                                                                                                                                                                                     | Yes (designer: fill in) |

## Checks

| ID      | Rule                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CHK-500 | ERC and DRC clean. DRC with **schematic parity** on (a plain DRC hides parity problems).                                                               |
| CHK-501 | Waivers only for known silkscreen issues, known courtyard overlaps and starved thermals on non-critical GND pins; each listed with its reason.         |
| CHK-502 | Test access: every key net reachable by a through-hole pin or a test point (1.25 / 1.0 / 0.75 / 0.5 mm, the largest that fits, at least 75 mil apart). |
