/**
 * bin-icons — pull the tab artwork for a parts bin out of fritzing-parts.
 *
 * The palette's vertical rail draws one square per bin. Packs that ship no
 * artwork fall back to a two-letter monogram ("AR", "SN"), which is legible but
 * tells you nothing — and Fritzing already drew proper icons for most of these
 * bins. They sit in `fritzing-parts/bins/more/` beside the `.fzb` files:
 *
 *   more/arduino.fzb        <module icon="arduino.png">
 *   more/arduino.png        32×32 RGBA, ~1 KB
 *   more/arduino-mono.png   the same mark, flat black
 *
 * Three shapes turn up in that `icon` attribute and all three are handled:
 *
 *  1. A PNG filename — the common case. Inlined as a data URI so a pack stays
 *     one JSON file with no second request.
 *  2. Nothing at all — every SparkFun sub-bin. Their PNGs are there, just not
 *     referenced, so the `.fzb` basename is tried as a filename.
 *  3. An entire SVG document, XML-escaped into the attribute
 *     (voltage_regulators.fzb does this). Passed through as-is; the palette
 *     renders an SVG string inline.
 *
 * A few bins name a PNG that isn't in the repo (Lilypad.png, PICAXE.png).
 * Those return undefined and keep their monogram — better a monogram than a
 * broken image.
 *
 * The colour icon is preferred over `-mono`: the rail sits on a light or a dark
 * chrome depending on the theme, and flat black artwork disappears on one of
 * them.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

/** XML entity decode, enough for what Fritzing escapes into an attribute. */
function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&amp;/g, '&')
}

const IMG_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }

function dataUri(path) {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  const mime = IMG_EXT[ext]
  if (!mime) return undefined
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`
}

/**
 * Read every `.fzb` under `binRoot` (and `binRoot/more`) and return
 * `fzbBasename → icon`, where icon is a data URI or a raw SVG string.
 *
 * Bins whose artwork can't be resolved are simply absent from the map.
 */
export function readBinIcons(binRoot) {
  const icons = new Map()
  for (const dir of [binRoot, join(binRoot, 'more')]) {
    if (!existsSync(dir)) continue
    const files = readdirSync(dir)
    for (const f of files) {
      if (!f.endsWith('.fzb')) continue
      // the attribute is in the <module> element, a couple of lines in
      const head = readFileSync(join(dir, f), 'utf8').slice(0, 4096)
      const attr = /<module[^>]*\sicon="([^"]*)"/.exec(head)?.[1]
      const decoded = attr ? unescapeXml(attr).trim() : ''

      if (decoded.startsWith('<')) {
        icons.set(f, decoded)
        continue
      }

      // an explicit filename, else the bin's own name — SparkFun's sub-bins
      // ship the PNG without ever referencing it
      const candidates = [decoded, `${basename(f, '.fzb')}.png`].filter(Boolean)
      for (const name of candidates) {
        const path = join(dir, name)
        if (!existsSync(path)) continue
        const uri = dataUri(path)
        if (uri) {
          icons.set(f, uri)
          break
        }
      }
    }
  }
  return icons
}

/**
 * `packId → icon`, given the .fzb→pack mapping the splitter already maintains.
 *
 * SparkFun's sub-bins aren't in that mapping — they're classified off the part
 * filenames rather than bin membership — but their `.fzb` basename *is* the
 * pack id, so they're matched by name as well.
 */
export function packIcons(binRoot, binToPack = {}) {
  const byFzb = readBinIcons(binRoot)
  const out = {}
  for (const [fzb, icon] of byFzb) {
    const id = binToPack[fzb] ?? basename(fzb, '.fzb')
    if (!(id in out)) out[id] = icon
  }
  return out
}
