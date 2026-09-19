# Hosting a parts pack

**Audience:** anyone publishing parts for tinyStudio to install. For *editing*
parts (where the art is, Illustrator, live preview), read
[parts-and-art.md](parts-and-art.md) first.

The official library is
[Mister-Industries/tinyparts](https://github.com/Mister-Industries/tinyparts),
and the app reads its `index.json` by default. Any repo or web server with the
same layout works too: add its index URL under Parts Packs → More packs.

## Layout

```
index.json
packs/
  <pack-id>/
    pack.json
    ATTRIBUTION.md          required if the pack includes Fritzing CC-BY-SA art
    parts/
      <type>/               folder part (editable)
        part.json
        breadboard.svg
        schematic.svg
        icon.svg
      <type>.json           single-file part (SVG embedded), older packs
```

## Formats

**`index.json`**

```json
{
  "schema": 1,
  "groups": ["tinyStudio", "SparkFun", "Vendors"],
  "packs": [
    {
      "id": "core",
      "name": "Core",
      "version": "2.0.0",
      "group": "tinyStudio",
      "icon": "Co",
      "bundled": true,
      "count": 29,
      "description": "Everyday components that ship with tinyStudio",
      "url": "packs/core/pack.json"
    }
  ]
}
```

`url` may be relative to the index. `bundled: true` marks packs compiled into
the app (`npm run parts:sync` copies exactly those). The installer doesn't offer
them, and they update from GitHub like any installed pack.

**`packs/<id>/pack.json`**

```json
{
  "schema": 1,
  "id": "core",
  "name": "Core",
  "version": "2.0.0",
  "sections": ["Basic", "Input"],
  "parts": [
    { "type": "resistor", "dir": "parts/resistor", "section": "Basic" },
    { "type": "old-style-part", "file": "parts/old-style-part.json", "section": "Input" }
  ]
}
```

**Palette layout.** The Circuit view's parts bin follows `pack.json`, the way
Fritzing's follows its `.fzb` bin files:

- **Order.** Parts appear in the order `parts` lists them.
- **Sections.** A part's `section` is the heading it sits under, and `sections`
  gives their order. A pack with no sections shows one grid.
- **Tabs.** Packs in the `tinyStudio` group share the Core tab, packs in the
  `SparkFun` group share a SparkFun tab (one section per pack), and any other
  pack gets its own tab once installed, with its `icon` on the tab.

The rules live in `circuit/views/palette/paletteLayout.ts`.

**`part.json`**: see the reference in [parts-and-art.md](parts-and-art.md#partjson-reference).

## Updates

Nothing needs bumping. The app compares **file contents** (git blob shas from
GitHub's tree API) with what it has. Push a change and every install downloads
exactly the changed files on its next launch. `version` is informational: the
panel shows it, and it's the fallback for packs hosted somewhere that isn't
GitHub.

For a non-GitHub index, the app can't see file hashes. It installs the files and
shows "Update" when the index's `version` string differs from the installed one.

## Before publishing

```bash
npm run parts:check -- --repo ../tinyparts        # uses the app's own loaders
npm run parts:check -- --repo ../tinyparts --fix  # repair listings, tidy JSON
```

Then commit and push. To try a pack without publishing, point tinyStudio's
Developer folder at the checkout (`npm run dev` → Parts Packs → Developer), or
serve the folder (`npx http-server ../tinyparts`) and add
`http://localhost:8080/index.json` as an index.

## Generating packs from Fritzing

```bash
node scripts/fritzing-import.mjs --src ../fritzing-parts --out tmp/fritzing-import --all --views breadboard,schematic
node scripts/parts-tool.mjs explode --from tmp/fritzing-import --pack my-pack --new "My Pack" --version 1.0.0
```

`explode --from` writes folder parts, `pack.json`, and the pack's `index.json`
row. Add an `ATTRIBUTION.md`.

## Licensing (per the M0 decision log)

> Fritzing CC-BY-SA art OK with per-pack ATTRIBUTION; behaviors (not code) ported from GPLv3 fritzing-app; tinyStudio is GPL-3.0 so either is compatible.

Any pack containing Fritzing-derived SVGs needs an `ATTRIBUTION.md` next to its
`pack.json`, crediting the Fritzing project (and any part-specific authors its
`.fzp` names) under CC-BY-SA. Packs you author entirely yourself don't need one.

## Not done yet

- **No signature verification.** The app trusts the index it's pointed at. That's
  fine for one maintained repo; revisit before accepting third-party submissions.
- **No CI in tinyparts.** A GitHub Action running `npm run parts:check` against the
  repo would stop a malformed `part.json` from reaching every install.
