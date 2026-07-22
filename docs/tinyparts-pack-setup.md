# Setting up the `tinyparts` parts-pack repo

**Audience:** Geoff, setting up GitHub distribution for circuit parts (M2 leftover, spec §5.4). The app-side pack manager (Parts Packs button in the Circuit view's Components rail) and installer logic already ship — this doc is the other half: how to host something for it to install.

**Status:** the client (`circuit/parts/packs.ts` + `circuit/views/packs/PackManager.tsx`) is done, tested, and verified end-to-end against a real local server serving real `fritzing-import.mjs` output (29/29 parts installed with zero failures). What's below is entirely repo/hosting setup on your end — no app code needed.

## Why this exists

The app already has ~29 Fritzing-derived parts bundled in (`src/renderer/src/assets/parts/`) plus whatever a user imports via `.fzpz` drag-and-drop or authors in the Parts Editor (both persist locally via IndexedDB — that part's been working since M2). What's been missing is a way to *distribute* a curated, larger catalogue without bloating the app download — exactly Arduino's "Boards Manager" pattern: a small index.json the app polls, pointing at packs it can fetch on demand.

## 1. Create the repo

```
Mister-Industries/tinyparts   (per the M2 decision log — this is the name/org the app defaults to)
```

Public repo, any license note you want at the top level (the parts themselves need their own attribution — see §4).

## 2. Layout

```
tinyparts/
  index.json                       # top-level: lists every pack
  packs/
    tinystudio-core/
      pack.json                    # this pack's manifest
      ATTRIBUTION.md                # required if it includes Fritzing CC-BY-SA art
      parts/
        resistor.json
        led-generic-5mm.json
        ...
    some-other-pack/
      pack.json
      parts/...
```

Nothing here needs a build step or CI to work — the app fetches `index.json` and each `pack.json` directly as **raw GitHub URLs**:

```
https://raw.githubusercontent.com/Mister-Industries/tinyparts/main/index.json
```

That URL is already the app's built-in default (`DEFAULT_INDEX_URL` in `circuit/parts/packs.ts`) — once it's live at that path, every install of the app picks it up automatically the next time someone opens the Parts Packs panel. No app update needed to add/update packs later.

## 3. File formats (exactly what the app expects)

**`index.json`** (repo root):

```json
{
  "schema": 1,
  "packs": [
    {
      "id": "tinystudio-core",
      "name": "tinyStudio Core Parts",
      "version": "1.0.0",
      "description": "Curated Fritzing-derived parts for breadboard + schematic.",
      "url": "packs/tinystudio-core/pack.json"
    }
  ]
}
```

`url` may be relative (resolved against `index.json`'s own URL) or absolute — relative is simplest and is what the generator script below produces.

**`packs/<id>/pack.json`**:

```json
{
  "schema": 1,
  "id": "tinystudio-core",
  "name": "tinyStudio Core Parts",
  "version": "1.0.0",
  "description": "Curated Fritzing-derived parts for breadboard + schematic.",
  "parts": [
    { "type": "resistor", "file": "parts/resistor.json" },
    { "type": "led-generic-5mm", "file": "parts/led-generic-5mm.json" }
  ]
}
```

Each `file` is a **plain `PartDef`** — literally the same JSON shape `scripts/fritzing-import.mjs` and the in-app `.fzpz` importer already produce (`{ type, label, family, icon?, views: { breadboard?, schematic? } }`). If you can drop a `.fzpz` on the canvas and see it appear, that same converted JSON is installable as a pack part with zero changes.

Bumping `version` in both `index.json` and the pack's own `pack.json` is what makes the app's Parts Packs panel show "Update" instead of "Install" — there's no other versioning magic, just a string compare.

## 4. Generating a pack from a `fritzing-parts` checkout

You already have the tool for the hard part (SVG/transform resolution) — `scripts/fritzing-import.mjs` in this repo. A new small script, `scripts/make-pack-index.mjs`, wraps its output into the pack format above:

```bash
# 1. Convert Fritzing parts the usual way (see docs/circuit-architecture-and-roadmap.md Part IV)
node scripts/fritzing-import.mjs \
  --src /path/to/fritzing-parts \
  --out /tmp/converted-parts \
  --all --views breadboard,schematic

# 2. Wrap that output into a pack, writing straight into your tinyparts checkout
node scripts/make-pack-index.mjs \
  --parts /tmp/converted-parts \
  --out   /path/to/tinyparts \
  --id    tinystudio-core \
  --name  "tinyStudio Core Parts" \
  --version 1.0.0 \
  --description "Curated Fritzing-derived parts for breadboard + schematic"

# 3. Review, commit, push
cd /path/to/tinyparts
git add -A && git commit -m "tinystudio-core 1.0.0" && git push
```

`make-pack-index.mjs` is additive and idempotent — re-running it with a bumped `--version` overwrites that pack's `pack.json` + copies the (re-converted) part files, and updates just that pack's entry in the top-level `index.json` (other packs already listed there are left alone). Running it with a new `--id` adds a second pack alongside the first.

This was smoke-tested end-to-end against the app's real bundled catalogue (`src/renderer/src/assets/parts/`, 29 parts) — served over a plain local HTTP server and installed through the actual `packs.ts` client with 0 failures — so the format round-trip is verified; the only unverified step is the real `raw.githubusercontent.com` fetch once it's actually published (can't reach the public internet from here to confirm, but it's the same `fetch()` path, just a different origin).

## 5. Trying it in the app before/without publishing

Point the Parts Packs panel (Components rail → the package icon) at anything reachable, including `http://localhost:<port>/index.json` if you serve the folder locally (`npx http-server ./tinyparts`) — handy for checking a pack before pushing. The default index URL is pre-filled, but you can add/remove index URLs freely; they persist in `localStorage` (`tinystudio.packs.indexUrls`).

## 6. Licensing (per the M0 decision log)

> Fritzing CC-BY-SA art OK with per-pack ATTRIBUTION; behaviors (not code) ported from GPLv3 fritzing-app; tinyStudio is GPL-3.0 so either is compatible.

Concretely: any pack containing Fritzing-derived SVGs needs an `ATTRIBUTION.md` alongside its `pack.json` crediting the Fritzing project (and any part-specific authors the source `.fzp` names) under CC-BY-SA. Packs you author entirely yourself don't need this.

## 7. Optional: CI validation

Not required to ship the first pack, but worth adding once there's more than one contributor: a GitHub Action that runs `node -e "JSON.parse(require('fs').readFileSync('index.json'))"` (and the same over every `pack.json`) on push, so a malformed JSON commit fails CI instead of silently breaking every user's install. `scripts/test-circuit.mjs` in this repo is a reasonable model for "zero-dependency Node script as the CI gate" if you want the same style.

## What's NOT done (be aware)

- **No signature/hash verification** on install (spec §5.4 mentions `sha256`) — the client trusts whatever the index/pack JSON says. Fine for a single maintained repo; revisit if this ever accepts third-party pack submissions.
- **No update-check-on-launch** — installing/updating is manual (open Parts Packs, click Install/Update). The panel does show "vX installed" vs. the index's version so staleness is visible, just not proactively surfaced elsewhere in the UI.
- **No zip-based hosting** — packs are raw JSON files fetched individually (one request per part on install). Fine at tens of parts; if a pack grows into the thousands, revisit (bundle as a zip + the existing `parts/zip.ts` unzip-in-renderer code, already used for `.fzpz`, could be reused).
