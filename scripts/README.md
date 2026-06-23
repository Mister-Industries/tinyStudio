# Fritzing → tinyStudio parts importer

`fritzing-import.mjs` converts Fritzing parts (`.fzp` + SVGs) into tinyStudio's
per-part JSON library, with pin coordinates in pixels @ 96 DPI so the result is
**Wokwi `diagram.json` compatible**.

## Prerequisites

- The [`fritzing-parts`](https://github.com/fritzing/fritzing-parts) repo cloned
  locally. By default the script looks for it at `../fritzing-parts` (next to
  this repo). Use `--src` to point elsewhere.
- Run from the tinyStudio repo root. No install step — it uses `@xmldom/xmldom`,
  already a dependency.

## How it works

For each part the script reads the `.fzp` (metadata + connector list) and the
referenced view SVG(s). Fritzing stores pin positions **inside the SVG**, not in
the `.fzp`, so the script resolves each connector's `terminalId` / `svgId`
element, accumulates any ancestor `transform`s, and scales the SVG's viewBox
units into pixels:

```
pin_px = (coord_vb - viewBoxMin) * (realWidthPx / viewBoxWidth)
```

Output lands in `src/renderer/src/assets/parts/`:

```
<type>.json   one flat file per part (lazy-loaded by the editor)
index.json    lightweight manifest: palette icons + family grouping
_report.json  per-part ok / partial / failed / skipped
```

(Files are flat — family grouping lives in the manifest, because Vite's dynamic
imports can only vary one path segment.)

The editor reads `index.json` for the palette and lazy-loads each part's JSON
only when it's placed — so importing the whole catalogue doesn't bloat startup.

## Usage

```bash
# See all options
node scripts/fritzing-import.mjs --help

# Test a handful first (recommended) — exact filename match, no .fzp extension
node scripts/fritzing-import.mjs --only resistor,LED-generic-5mm --views breadboard,schematic

# A curated starter set (what ships by default)
node scripts/fritzing-import.mjs --clean --views breadboard,schematic \
  --only "resistor,LED-generic-3mm,LED-generic-5mm,Pushbutton,capacitor_ceramic_100mil,capacitor_electrolytic_medium,potentiometer_rotary_16mm_5,diode_1N4001_300mil,transistor_signal_NPN_TO92_EBC,Buzzer-v15,servo,battery-AA"

# From a list file (one basename / moduleId per line)
node scripts/fritzing-import.mjs --list my-parts.txt

# The entire core library (~1,800 parts) — both views
node scripts/fritzing-import.mjs --all --views breadboard,schematic
```

### Options

| Flag | Default | Meaning |
|------|---------|---------|
| `--src <dir>` | `../fritzing-parts` | Path to the cloned fritzing-parts repo |
| `--out <dir>` | `src/renderer/src/assets/parts` | Output directory |
| `--views <list>` | `breadboard` | Views to extract: `breadboard`, `schematic` |
| `--only <list>` | — | Comma list of `.fzp` basenames / moduleIds |
| `--list <file>` | — | File with one basename / moduleId per line |
| `--all` | — | Import every `.fzp` in `<src>/core` |
| `--limit <n>` | ∞ | Stop after `n` parts (safety while testing) |
| `--clean` | merge | Wipe the output dir first instead of merging |

Notes:
- `--only` matches an **exact** filename first; if none matches it falls back to
  substring (so `--only resistor` gives just `resistor.fzp`).
- Without `--clean`, runs **merge** into the existing manifest, so you can import
  more parts incrementally.
- Parts where a pin can't be resolved are marked `partial` in `_report.json`
  (they still import — just check the flagged pins).

## After importing

Restart `npm run dev` (or rebuild). New parts appear in the Circuit view's
Components rail, grouped by family.
