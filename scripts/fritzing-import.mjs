#!/usr/bin/env node
/**
 * fritzing-import.mjs — convert Fritzing parts (.fzp + SVGs) into tinyStudio's
 * per-part JSON library (Wokwi-pixel compatible).
 *
 * What it does
 * ------------
 * For each Fritzing part it reads the .fzp (metadata + connector list) and the
 * referenced view SVG(s). Fritzing does NOT store pin coordinates in the .fzp —
 * it only names an svgId / terminalId. We resolve the real X/Y *inside the SVG*,
 * accumulating ancestor transforms, then scale viewBox units into pixels at
 * 96 DPI (the Wokwi convention) so the output drops straight into diagram.json.
 *
 *   pin_px = (coord_vb - viewBoxMin) * (realWidthPx / viewBoxWidth)
 *   realWidthPx = toPx(svg width attr):  in*96 · mm*3.7795 · cm*37.795 · pt*1.333 · px*1
 *
 * Output (default → src/renderer/src/assets/parts):
 *   <out>/<family>/<type>.json   one file per part   (lazy-loaded by the editor)
 *   <out>/index.json             lightweight manifest (palette + grouping)
 *   <out>/_report.json           per-part ok / partial / failed / skipped
 *
 * Usage — see `node scripts/fritzing-import.mjs --help`.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOMParser } from '@xmldom/xmldom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, '..')

const PX_PER_MM = 96 / 25.4 // 3.7795 — 96 DPI

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = { views: ['breadboard'], only: null, list: null, all: false, limit: Infinity }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    const next = () => argv[++i]
    if (t === '--help' || t === '-h') a.help = true
    else if (t === '--src') a.src = next()
    else if (t === '--out') a.out = next()
    else if (t === '--only')
      a.only = next()
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    else if (t === '--list') a.list = next()
    else if (t === '--all') a.all = true
    else if (t === '--views')
      a.views = next()
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    else if (t === '--limit') a.limit = parseInt(next(), 10)
    else if (t === '--clean') a.clean = true
    else console.warn(`Unknown arg: ${t}`)
  }
  return a
}

const HELP = `
fritzing-import — Fritzing parts → tinyStudio JSON library

  node scripts/fritzing-import.mjs [options]

Options
  --src <dir>     Path to the cloned fritzing-parts repo
                  (default: ../fritzing-parts next to tinyStudio)
  --out <dir>     Output directory
                  (default: src/renderer/src/assets/parts)
  --views <list>  Comma list of views to extract: breadboard,schematic
                  (default: breadboard)
  --only <list>   Comma list of .fzp basenames or moduleIds to import
                  e.g. --only resistor,LED-generic-5mm
  --list <file>   Text file with one .fzp basename / moduleId per line
  --all           Import every .fzp in <src>/core
  --limit <n>     Stop after n parts (safety while testing)
  --clean         Start a fresh manifest instead of merging with existing
  -h, --help      Show this help

Examples
  # Test a handful first (recommended)
  node scripts/fritzing-import.mjs --only resistor,LED-generic-5mm,arduino_Uno

  # Both views for the test set
  node scripts/fritzing-import.mjs --only resistor --views breadboard,schematic

  # The whole core library
  node scripts/fritzing-import.mjs --all --views breadboard,schematic
`

// ── small utilities ──────────────────────────────────────────────────────────

const slug = (s) =>
  (s || '')
    .normalize('NFKD')
    .replace(/ModuleID$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'part'

/** Convert an SVG length attr (with unit) to pixels @ 96 DPI. */
function toPx(value) {
  if (value == null) return null
  const m = String(value)
    .trim()
    .match(/^(-?[\d.]+)\s*(px|pt|pc|mm|cm|in)?$/)
  if (!m) return null
  const n = parseFloat(m[1])
  switch (m[2]) {
    case 'in':
      return n * 96
    case 'mm':
      return n * PX_PER_MM
    case 'cm':
      return n * PX_PER_MM * 10
    case 'pt':
      return n * (96 / 72)
    case 'pc':
      return n * 16
    default:
      return n // px or unitless
  }
}

// ── transform matrix math (a b c d e f) ──────────────────────────────────────
// point map: x' = a*x + c*y + e ; y' = b*x + d*y + f

const IDENT = [1, 0, 0, 1, 0, 0]
function matMul(m, n) {
  // returns m · n
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ]
}
function applyMat(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}
function parseTransform(str) {
  let m = IDENT
  if (!str) return m
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  let r
  while ((r = re.exec(str))) {
    const fn = r[1]
    const args = r[2]
      .split(/[\s,]+/)
      .map(parseFloat)
      .filter((n) => !Number.isNaN(n))
    let t = IDENT
    if (fn === 'matrix' && args.length === 6) t = args
    else if (fn === 'translate') t = [1, 0, 0, 1, args[0] || 0, args[1] || 0]
    else if (fn === 'scale')
      t = [args[0] || 1, 0, 0, args.length > 1 ? args[1] : args[0] || 1, 0, 0]
    else if (fn === 'rotate') {
      const rad = ((args[0] || 0) * Math.PI) / 180
      const cos = Math.cos(rad),
        sin = Math.sin(rad)
      const rot = [cos, sin, -sin, cos, 0, 0]
      if (args.length >= 3) {
        const cx = args[1],
          cy = args[2]
        t = matMul(matMul([1, 0, 0, 1, cx, cy], rot), [1, 0, 0, 1, -cx, -cy])
      } else t = rot
    } else if (fn === 'skewX') t = [1, 0, Math.tan(((args[0] || 0) * Math.PI) / 180), 1, 0, 0]
    else if (fn === 'skewY') t = [1, Math.tan(((args[0] || 0) * Math.PI) / 180), 0, 1, 0, 0]
    m = matMul(m, t)
  }
  return m
}

/** Cumulative transform matrix from <svg> root down to (and including) el. */
function ctmFor(el) {
  const chain = []
  let n = el
  while (n && n.nodeType === 1) {
    chain.push(n)
    n = n.parentNode
  }
  // chain is el → root; compose root-first so outer transforms wrap inner ones
  let m = IDENT
  for (let i = chain.length - 1; i >= 0; i--) {
    const tf = chain[i].getAttribute && chain[i].getAttribute('transform')
    if (tf) m = matMul(m, parseTransform(tf))
  }
  return m
}

// ── SVG geometry helpers ─────────────────────────────────────────────────────

function* walk(node) {
  if (node.nodeType === 1) yield node
  for (let c = node.firstChild; c; c = c.nextSibling) yield* walk(c)
}
function getById(root, id) {
  for (const el of walk(root)) if (el.getAttribute && el.getAttribute('id') === id) return el
  return null
}

/** Local-space anchor point of a shape element (before transforms). */
function localAnchor(el) {
  const tag = (el.localName || el.nodeName || '').toLowerCase()
  const num = (a) => parseFloat(el.getAttribute(a))
  if (tag === 'rect') {
    const x = num('x') || 0,
      y = num('y') || 0,
      w = num('width') || 0,
      h = num('height') || 0
    return { x: x + w / 2, y: y + h / 2 }
  }
  if (tag === 'circle' || tag === 'ellipse') return { x: num('cx') || 0, y: num('cy') || 0 }
  if (tag === 'line') {
    // free end = endpoint farther from the element's own midpoint origin; caller
    // re-resolves against viewBox centre, so just return the bbox centre here.
    const x1 = num('x1') || 0,
      y1 = num('y1') || 0,
      x2 = num('x2') || 0,
      y2 = num('y2') || 0
    return {
      x: (x1 + x2) / 2,
      y: (y1 + y2) / 2,
      line: [
        { x: x1, y: y1 },
        { x: x2, y: y2 }
      ]
    }
  }
  if (tag === 'polygon' || tag === 'polyline') {
    const pts = (el.getAttribute('points') || '')
      .trim()
      .split(/[\s,]+/)
      .map(parseFloat)
    if (pts.length >= 2) return bboxCenter(chunk(pts))
  }
  if (tag === 'path') {
    const nums = (el.getAttribute('d') || '').match(/-?[\d.]+(?:e-?\d+)?/gi)
    if (nums && nums.length >= 2) return bboxCenter(chunk(nums.map(parseFloat)))
  }
  if (tag === 'g') {
    // group wrapper (e.g. <g id=connectorNterminal><rect/></g>): use first child shape
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) {
        const a = localAnchor(c)
        if (a) {
          const m = parseTransform(c.getAttribute('transform'))
          return applyMat(m, a.x, a.y)
        }
      }
    }
  }
  return null
}
function chunk(arr) {
  const out = []
  for (let i = 0; i + 1 < arr.length; i += 2) out.push({ x: arr[i], y: arr[i + 1] })
  return out
}
function bboxCenter(pts) {
  let minx = Infinity,
    miny = Infinity,
    maxx = -Infinity,
    maxy = -Infinity
  for (const p of pts) {
    minx = Math.min(minx, p.x)
    miny = Math.min(miny, p.y)
    maxx = Math.max(maxx, p.x)
    maxy = Math.max(maxy, p.y)
  }
  return { x: (minx + maxx) / 2, y: (miny + maxy) / 2 }
}

// ── fzp parsing ──────────────────────────────────────────────────────────────

function text(el, tag) {
  const n = el.getElementsByTagName(tag)[0]
  return n && n.textContent ? n.textContent.trim() : ''
}

function parseFzp(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const mod = doc.getElementsByTagName('module')[0]
  if (!mod) throw new Error('no <module>')

  const props = {}
  const propsEl = mod.getElementsByTagName('properties')[0]
  if (propsEl)
    for (const p of Array.from(propsEl.getElementsByTagName('property')))
      props[(p.getAttribute('name') || '').toLowerCase()] = (p.textContent || '').trim()

  // view → svg image path
  const viewImage = {}
  for (const vname of ['breadboardView', 'schematicView', 'iconView', 'pcbView']) {
    const v = mod.getElementsByTagName(vname)[0]
    if (!v) continue
    const layers = v.getElementsByTagName('layers')[0]
    if (layers) viewImage[vname] = layers.getAttribute('image')
  }

  // connectors → per-view svgId / terminalId
  const connectors = []
  const connsEl = mod.getElementsByTagName('connectors')[0]
  if (connsEl) {
    for (const c of Array.from(connsEl.getElementsByTagName('connector'))) {
      const id = c.getAttribute('id')
      const name = c.getAttribute('name') || id
      const views = {}
      for (const vname of ['breadboardView', 'schematicView']) {
        const v = c.getElementsByTagName(vname)[0]
        if (!v) continue
        const p = v.getElementsByTagName('p')[0]
        if (!p) continue
        views[vname] = {
          svgId: p.getAttribute('svgId'),
          terminalId: p.getAttribute('terminalId'),
          legId: p.getAttribute('legId')
        }
      }
      connectors.push({ id, name, views })
    }
  }

  return {
    moduleId: mod.getAttribute('moduleId') || '',
    title: text(mod, 'title'),
    label: text(mod, 'label'),
    description: text(mod, 'description'),
    family: props.family || '',
    props,
    viewImage,
    connectors
  }
}

// ── per-view SVG extraction ──────────────────────────────────────────────────

const VIEW_TAG = { breadboard: 'breadboardView', schematic: 'schematicView' }
const VIEW_DIR = { breadboard: 'breadboard', schematic: 'schematic' }

function extractView(fzp, view, srcRoot) {
  const tag = VIEW_TAG[view]
  const rel = fzp.viewImage[tag]
  if (!rel) return { skip: 'no view image' }

  // image path is like "breadboard/foo.svg" — resolve under svg/<section>/
  // Try core first, then user/contrib/obsolete sections.
  const candidates = ['core', 'user', 'contrib', 'obsolete'].map((sec) =>
    join(srcRoot, 'svg', sec, rel)
  )
  const svgPath = candidates.find((p) => existsSync(p))
  if (!svgPath) return { skip: `svg not found: ${rel}` }

  let doc
  try {
    doc = new DOMParser().parseFromString(readFileSync(svgPath, 'utf8'), 'image/svg+xml')
  } catch (e) {
    return { skip: `svg parse error: ${e.message}` }
  }
  const svg = doc.getElementsByTagName('svg')[0]
  if (!svg) return { skip: 'no <svg> root' }

  // viewBox + real size → unit scale
  let vb = (svg.getAttribute('viewBox') || '')
    .trim()
    .split(/[\s,]+/)
    .map(parseFloat)
  const wPx = toPx(svg.getAttribute('width'))
  const hPx = toPx(svg.getAttribute('height'))
  if (vb.length !== 4 || vb.some(Number.isNaN)) {
    // synthesize viewBox from width/height if missing
    if (wPx != null && hPx != null) vb = [0, 0, wPx, hPx]
    else return { skip: 'no viewBox/size' }
  }
  const [vbx, vby, vbw, vbh] = vb
  const sx = wPx != null && vbw ? wPx / vbw : 1
  const sy = hPx != null && vbh ? hPx / vbh : sx
  const center = { x: vbx + vbw / 2, y: vby + vbh / 2 }
  const toCanvas = (p) => ({ x: (p.x - vbx) * sx, y: (p.y - vby) * sy })

  // resolve each connector's pin point
  const pins = {}
  const legPins = []
  const unresolved = []
  const usedNames = new Set()
  for (const c of fzp.connectors) {
    const cv = c.views[tag]
    if (!cv) {
      unresolved.push(c.id)
      continue
    }
    // prefer terminal (precise), then svg pin element
    const ids = view === 'schematic' ? [cv.terminalId, cv.svgId] : [cv.svgId, cv.terminalId]
    let pt = null
    for (const id of ids) {
      if (!id) continue
      const el = getById(svg, id)
      if (!el) continue
      let local = localAnchor(el)
      if (!local) continue
      const m = ctmFor(el)
      // for lines: pick the end farther from drawing centre (the free/wire end)
      if (local.line) {
        const ends = local.line.map((p) => applyMat(m, p.x, p.y))
        pt = ends.reduce((far, e) =>
          (e.x - center.x) ** 2 + (e.y - center.y) ** 2 >
          (far.x - center.x) ** 2 + (far.y - center.y) ** 2
            ? e
            : far
        )
      } else {
        pt = applyMat(m, local.x, local.y)
      }
      break
    }
    if (!pt) {
      unresolved.push(c.id)
      continue
    }
    const canvas = toCanvas(pt)
    // unique, human pin name
    let name = c.name || c.id
    let n = name,
      i = 2
    while (usedNames.has(n)) n = `${name}.${i++}`
    usedNames.add(n)
    pins[n] = [round(canvas.x), round(canvas.y)]
    // bendable rubber-band leg (LED/resistor class parts, breadboard view
    // only — cv.legId is only ever set there): tag the pin so the editor
    // knows it can be dragged independent of the part body (Placement.legs).
    if (cv.legId) legPins.push(n)
  }

  // normalize the SVG for inline rendering: strip width/height, keep viewBox
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', vb.join(' '))
  const svgStr = svg.toString().replace(/\s+xmlns:[a-z]+="[^"]*"/g, (m) => m) // keep ns

  return {
    svg: svgStr,
    w: round(wPx != null ? wPx : vbw * sx),
    h: round(hPx != null ? hPx : vbh * sy),
    pins,
    legs: legPins.length ? legPins : undefined,
    unresolved
  }
}

const round = (n) => Math.round(n * 100) / 100

/** Strip XML decl / DOCTYPE / comments and collapse inter-tag whitespace. */
function minifySvg(str) {
  return str
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .trim()
}

/** Extract a normalized, minified icon SVG (iconView) for palette thumbnails. */
function extractIcon(fzp, srcRoot) {
  const rel = fzp.viewImage.iconView
  if (!rel) return null
  const svgPath = ['core', 'user', 'contrib', 'obsolete']
    .map((sec) => join(srcRoot, 'svg', sec, rel))
    .find((p) => existsSync(p))
  if (!svgPath) return null
  let svg
  try {
    const doc = new DOMParser().parseFromString(readFileSync(svgPath, 'utf8'), 'image/svg+xml')
    svg = doc.getElementsByTagName('svg')[0]
  } catch {
    return null
  }
  if (!svg) return null
  const w = toPx(svg.getAttribute('width'))
  const h = toPx(svg.getAttribute('height'))
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (!svg.getAttribute('viewBox') && w != null && h != null) {
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  }
  return minifySvg(svg.toString())
}

// ── main ─────────────────────────────────────────────────────────────────────

function resolveTargets(args, coreDir) {
  let names = null
  if (args.list) {
    names = readFileSync(args.list, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  } else if (args.only) {
    names = args.only
  }
  const all = readdirSync(coreDir).filter((f) => f.toLowerCase().endsWith('.fzp'))
  if (args.all || !names) return all
  // Per term: prefer an exact basename match; if none, fall back to substring.
  // (so `--only resistor` gives just resistor.fzp, not every *resistor* variant)
  const bases = all.map((f) => ({ f, base: f.replace(/\.fzp$/i, '').toLowerCase() }))
  const picked = new Set()
  for (const n of names) {
    const w = n.replace(/\.fzp$/i, '').toLowerCase()
    const exact = bases.filter((b) => b.base === w)
    const matches = exact.length ? exact : bases.filter((b) => b.base.includes(w))
    if (!matches.length) console.warn(`  (no match for "${n}")`)
    for (const m of matches) picked.add(m.f)
  }
  return all.filter((f) => picked.has(f))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP)
    return
  }

  const srcRoot = resolve(args.src || resolve(REPO, '..', 'fritzing-parts'))
  const outRoot = resolve(args.out || join(REPO, 'src', 'renderer', 'src', 'assets', 'parts'))
  const coreDir = join(srcRoot, 'core')

  if (!existsSync(coreDir)) {
    console.error(`✗ Fritzing core not found at ${coreDir}\n  Pass --src <path to fritzing-parts>.`)
    process.exit(1)
  }
  if (args.clean && existsSync(outRoot)) rmSync(outRoot, { recursive: true, force: true })
  mkdirSync(outRoot, { recursive: true })

  const targets = resolveTargets(args, coreDir).slice(0, args.limit)
  if (targets.length === 0) {
    console.error('✗ No matching parts. Check --only / --list values.')
    process.exit(1)
  }

  console.log(`Source : ${srcRoot}`)
  console.log(`Output : ${outRoot}`)
  console.log(`Views  : ${args.views.join(', ')}`)
  console.log(`Parts  : ${targets.length}\n`)

  // merge with existing manifest unless --clean
  const indexPath = join(outRoot, 'index.json')
  const manifest = new Map()
  if (!args.clean && existsSync(indexPath)) {
    try {
      for (const e of JSON.parse(readFileSync(indexPath, 'utf8')).parts || [])
        manifest.set(e.type, e)
    } catch {
      /* ignore corrupt index */
    }
  }

  const report = { ok: [], partial: [], failed: [], skipped: [] }

  for (const file of targets) {
    let fzp
    try {
      fzp = parseFzp(readFileSync(join(coreDir, file), 'utf8'))
    } catch (e) {
      report.failed.push({ file, error: e.message })
      continue
    }
    // Filename is the human-stable identity in Fritzing core; moduleId is often
    // a random hash. Prefer the filename for `type`, keep moduleId in source.
    const type = slug(file.replace(/\.fzp$/i, ''))
    const family = slug(fzp.family) || 'misc'

    const def = {
      type,
      label: fzp.title || fzp.label || type,
      family: fzp.family || 'Misc',
      description: fzp.description || undefined,
      source: { fzp: file, moduleId: fzp.moduleId },
      views: {}
    }
    let anyView = false
    let anyUnresolved = false

    for (const view of args.views) {
      if (!VIEW_DIR[view]) continue
      const res = extractView(fzp, view, srcRoot)
      if (res.skip) continue
      def.views[view] = {
        svg: minifySvg(res.svg),
        w: res.w,
        h: res.h,
        pins: res.pins,
        ...(res.legs ? { legs: res.legs } : {})
      }
      anyView = true
      if (res.unresolved && res.unresolved.length) anyUnresolved = true
    }

    if (!anyView) {
      report.skipped.push({ file, reason: 'no usable view (missing svg or pins)' })
      continue
    }

    // palette thumbnail: Fritzing iconView, else a small breadboard SVG fallback
    const bb = def.views.breadboard?.svg || def.views.schematic?.svg || ''
    def.icon = extractIcon(fzp, srcRoot) || (bb.length < 4000 ? bb : null) || undefined

    // write per-part file — flat directory (Vite dynamic-import variables only
    // support a single path segment, so family lives in the manifest, not dirs)
    writeFileSync(join(outRoot, `${type}.json`), JSON.stringify(def, null, 2))

    manifest.set(type, {
      type,
      label: def.label,
      family: def.family,
      familySlug: family,
      views: Object.keys(def.views),
      pins: Object.keys(def.views[Object.keys(def.views)[0]].pins).length,
      icon: def.icon,
      file: `${type}.json`
    })
    ;(anyUnresolved ? report.partial : report.ok).push(type)
    process.stdout.write(anyUnresolved ? '~' : '.')
  }

  // write manifest + report
  const parts = Array.from(manifest.values()).sort(
    (a, b) => a.family.localeCompare(b.family) || a.label.localeCompare(b.label)
  )
  writeFileSync(
    indexPath,
    JSON.stringify({ version: 1, generated: new Date().toISOString(), parts }, null, 2)
  )
  writeFileSync(join(outRoot, '_report.json'), JSON.stringify(report, null, 2))

  console.log('\n')
  console.log(`✓ ok       ${report.ok.length}`)
  console.log(`~ partial  ${report.partial.length}  (some pins unresolved — see _report.json)`)
  console.log(`✗ failed   ${report.failed.length}`)
  console.log(`· skipped  ${report.skipped.length}`)
  console.log(`\nManifest : ${indexPath}  (${parts.length} parts total)`)
  if (report.failed.length)
    console.log(
      'Failures :',
      report.failed
        .slice(0, 8)
        .map((f) => f.file)
        .join(', ')
    )
}

main()
