# Parts scripts

Parts live in the [tinyparts](https://github.com/Mister-Industries/tinyparts)
repo, checked out next to this one (`../tinyparts`). The guide to where things are
and how to edit them is [docs/parts-and-art.md](../docs/parts-and-art.md).

| Command | What it does |
| --- | --- |
| `npm run parts:check` | Validate every pack in `../tinyparts` with the app's own loaders (`--fix` repairs listings and JSON formatting, `--pack <id>` checks one) |
| `npm run parts:new -- <type> --pack <id>` | Scaffold a folder part (`part.json` + starter `breadboard.svg`) |
| `node scripts/parts-tool.mjs explode --pack <id>` | Turn a pack's single-file JSON parts into editable folders (`--only a,b` for some) |
| `node scripts/parts-tool.mjs explode --from <dir> --pack <id> --new "Name"` | Build a pack from a folder of PartDef JSON (e.g. the Fritzing importer's output) |
| `npm run parts:sync` | Copy the `"bundled": true` packs into `src/renderer/src/assets/tinyparts/` (do this before a release) |

All of them take `--repo <dir>` to use a different checkout.

---

# Studio AI guide screenshots

Studio AI's `read_guide` tool returns screenshots along with the guide text
(`src/shared/agentGuides/screens/`). Re-capture them when the UI changes enough
to make them misleading:

```
npm run dev:web
npx electron scripts/capture-agent-screens.mjs http://localhost:5173
```

It drives the web build in an offscreen Electron window: the Code, Circuit and
Visual views on example projects, plus the `visual-js.md` reference sketch
rendered in the light and dark themes. Look at the images before committing;
the captions in `src/shared/agentGuides/index.ts` describe what's in each one.

# Fritzing → tinyStudio parts importer

`fritzing-import.mjs` converts Fritzing parts (`.fzp` + SVGs) into tinyStudio's
PartDef JSON, with pin coordinates in pixels @ 96 DPI so the result is
**Wokwi `diagram.json` compatible**. `parts-tool.mjs explode` then turns that
output into tinyparts folders.

## Prerequisites

- The [`fritzing-parts`](https://github.com/fritzing/fritzing-parts) repo cloned
  locally. By default the script looks for it at `../fritzing-parts` (next to
  this repo). Use `--src` to point elsewhere.
- Run from the tinyStudio repo root. No install step: it uses `@xmldom/xmldom`,
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

Output lands in `tmp/fritzing-import/` by default (git-ignored):

```
<type>.json   one file per part
index.json    manifest: palette icons + family grouping
_report.json  per-part ok / partial / failed / skipped
```

## Usage

```bash
# See all options
node scripts/fritzing-import.mjs --help

# A handful first: exact filename match, no .fzp extension
node scripts/fritzing-import.mjs --only resistor,LED-generic-5mm --views breadboard,schematic

# From a list file (one basename / moduleId per line)
node scripts/fritzing-import.mjs --list my-parts.txt

# Then into tinyparts, as editable folders
node scripts/parts-tool.mjs explode --from tmp/fritzing-import --pack core
npm run parts:check
```

### Options

| Flag | Default | Meaning |
|------|---------|---------|
| `--src <dir>` | `../fritzing-parts` | Path to the cloned fritzing-parts repo |
| `--out <dir>` | `tmp/fritzing-import` | Output directory |
| `--views <list>` | `breadboard` | Views to extract: `breadboard`, `schematic` |
| `--only <list>` | - | Comma list of `.fzp` basenames / moduleIds |
| `--list <file>` | - | File with one basename / moduleId per line |
| `--all` | - | Import every `.fzp` in `<src>/core` |
| `--limit <n>` | ∞ | Stop after `n` parts (safety while testing) |
| `--clean` | merge | Wipe the output dir first instead of merging |

Notes:
- `--only` matches an **exact** filename first; if none matches it falls back to
  substring (so `--only resistor` gives just `resistor.fzp`).
- Parts where a pin can't be resolved are marked `partial` in `_report.json`
  (they still import; just check the flagged pins).
- Fritzing parts keep **fixed** pin positions in `part.json` (their SVG ids
  aren't `pin-*`). To make one follow its art, rename its pad shapes
  `pin-<name>` and switch `pins` to a list; see
  [parts-and-art.md](../docs/parts-and-art.md#pins).
