// Regenerates the tinyStudio app icons.
//
// The monogram letterforms are the real Plus Jakarta Sans (ExtraBold) glyph
// outlines — the app's UI font — converted to vector paths so the icon has no
// runtime font dependency. The composed master is written to build/icon.svg,
// then rasterized to the platform icons electron-builder consumes from build/.
//
//   npm i -D sharp png2icons fontkit   # author-time only, not app deps
//   node scripts/gen-icon.mjs
//
// Requires the Plus Jakarta Sans variable TTF at the path in FONT below
// (download once from github.com/google/fonts ofl/plusjakartasans).

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const req = createRequire(import.meta.url)
let sharp, png2icons, fontkit
try {
  sharp = req('sharp')
  png2icons = req('png2icons')
  fontkit = req('fontkit')
} catch {
  console.error('Missing tooling. Run:  npm i -D sharp png2icons fontkit')
  process.exit(1)
}

const FONT = process.env.JAKARTA_TTF || 'C:/Users/Geoff McIntyre/AppData/Local/Temp/icongen/jakarta.ttf'
const buildDir = resolve(process.cwd(), 'build')

// --- letterforms: real Plus Jakarta Sans ExtraBold glyph outlines ---------
if (!existsSync(FONT)) {
  console.error(`Font not found: ${FONT}\nSet JAKARTA_TTF to the Plus Jakarta Sans variable TTF.`)
  process.exit(1)
}
const font = fontkit.openSync(FONT).getVariation({ wght: 800 })
const upm = font.unitsPerEm

function glyph(ch) {
  const run = font.layout(ch)
  const g = run.glyphs[0]
  const b = g.bbox // font units, y-up
  return { path: g.path, bbox: b, advance: g.advanceWidth }
}

const t = glyph('t')
const S = glyph('S')

// Lay the two glyphs on a shared baseline (y=0), t then S, with a small gap.
const GAP = 20 // font units between t's advance and S's start
const tX = 0
const sX = t.advance + GAP
// Combined ink bounds across both glyphs (font units, y-up).
const minX = Math.min(tX + t.bbox.minX, sX + S.bbox.minX)
const maxX = Math.max(tX + t.bbox.maxX, sX + S.bbox.maxX)
const minY = Math.min(t.bbox.minY, S.bbox.minY)
const maxY = Math.max(t.bbox.maxY, S.bbox.maxY)
const inkW = maxX - minX
const inkH = maxY - minY

// Target: letters ~60% of the 1024 tile height (slightly larger than before).
const CANVAS = 1024
const targetH = CANVAS * 0.6
const scale = targetH / inkH
// Center the ink box in the canvas (slight upward optical nudge).
const drawW = inkW * scale
const drawH = inkH * scale
const offX = (CANVAS - drawW) / 2
const offY = (CANVAS - drawH) / 2 - 8

// SVG transform from glyph space (y-up) into canvas: flip Y, scale, place.
// canvasX = offX + (gx - minX) * scale ; canvasY = offY + (maxY - gy) * scale
function place(g, gx) {
  const tr = `translate(${offX + (gx - minX) * scale} ${offY + maxY * scale}) scale(${scale} ${-scale})`
  return `<path transform="${tr}" d="${g.path.toSVG()}"/>`
}

const svg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="brand" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%"  stop-color="#22D3EE"/>
      <stop offset="48%" stop-color="#7C7CF0"/>
      <stop offset="100%" stop-color="#E0219B"/>
    </linearGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="#262C42"/>
      <stop offset="100%" stop-color="#171B2B"/>
    </linearGradient>
  </defs>

  <!-- rounded-square tile (Apple-ish ~22% radius) -->
  <rect x="0" y="0" width="1024" height="1024" rx="228" ry="228" fill="url(#tile)"/>

  <!-- monogram: Plus Jakarta Sans ExtraBold "tS" outlines -->
  <g fill="#C9D3E6">${place(t, tX)}</g>
  <g fill="url(#brand)">${place(S, sX)}</g>
</svg>`

writeFileSync(resolve(buildDir, 'icon.svg'), svg + '\n')

// --- rasterize -------------------------------------------------------------
const png1024 = await sharp(Buffer.from(svg)).resize(1024, 1024).png().toBuffer()
writeFileSync(resolve(buildDir, 'icon.png'), png1024)
writeFileSync(resolve(buildDir, 'icon.ico'), png2icons.createICO(png1024, png2icons.BICUBIC, 0, false))
writeFileSync(resolve(buildDir, 'icon.icns'), png2icons.createICNS(png1024, png2icons.BICUBIC, 0))

console.log('wrote build/icon.svg, icon.png, icon.ico, icon.icns')
