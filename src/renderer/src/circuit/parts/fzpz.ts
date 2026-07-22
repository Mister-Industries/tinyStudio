/**
 * circuit/parts/fzpz — in-app `.fzpz` drop-import (M2, spec §7).
 *
 * A .fzpz is a ZIP of one `part.<name>.fzp` (XML metadata + connector list)
 * plus its view SVGs stored flat as `svg.<view>.<name>.svg`. Fritzing does not
 * store pin coordinates in the .fzp — connectors name an svgId/terminalId and
 * the real point lives *inside* the SVG, under an arbitrary transform stack.
 * We resolve each connector by walking the SVG DOM, accumulating ancestor
 * transforms, then scaling viewBox units to pixels @ 96 DPI (Wokwi space).
 *
 * The conversion mirrors scripts/fritzing-import.mjs (the offline bulk
 * importer) — same anchors, same fallbacks — so a drop-imported part matches
 * what a regenerated default pack would produce. Uses the browser DOMParser,
 * so this module is renderer-only (don't import it from core/ or tests).
 */

import type { PartDef, PartView, ViewKind } from '../../lib/partsLibrary'
import { applyMat, matMul, minifySvg, parseTransform, toPx, type Mat, type Pt2 } from './svgUnits'
import { unzip } from './zip'

export interface FzpzResult {
  def: PartDef
  /** connector ids we could not resolve to a point, per view */
  warnings: string[]
}

interface FzpConnector {
  id: string
  name: string
  views: Partial<Record<string, { svgId?: string; terminalId?: string; legId?: string }>>
}

interface Fzp {
  moduleId: string
  title: string
  family: string
  viewImage: Partial<Record<string, string>>
  connectors: FzpConnector[]
}

const VIEW_TAG: Record<ViewKind, string> = {
  breadboard: 'breadboardView',
  schematic: 'schematicView'
}

const slug = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/ModuleID$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'part'

const round = (n: number): number => Math.round(n * 100) / 100

// ── DOM walking (browser DOM, same shape as the script's xmldom walk) ────────

function* walk(node: Element): Generator<Element> {
  yield node
  for (let c = node.firstElementChild; c; c = c.nextElementSibling) yield* walk(c)
}

function getById(root: Element, id: string): Element | null {
  for (const el of walk(root)) if (el.getAttribute('id') === id) return el
  return null
}

/** Cumulative transform matrix from the <svg> root down to (and incl.) el. */
function ctmFor(el: Element): Mat {
  const chain: Element[] = []
  let n: Element | null = el
  while (n && n.nodeType === 1) {
    chain.push(n)
    n = n.parentElement
  }
  let m: Mat = [1, 0, 0, 1, 0, 0]
  for (let i = chain.length - 1; i >= 0; i--) {
    const tf = chain[i].getAttribute('transform')
    if (tf) m = matMul(m, parseTransform(tf))
  }
  return m
}

interface Anchor extends Pt2 {
  line?: [Pt2, Pt2]
}

/** Local-space anchor point of a shape element (before transforms). */
function localAnchor(el: Element): Anchor | null {
  const tag = el.localName.toLowerCase()
  const num = (a: string): number => parseFloat(el.getAttribute(a) ?? '')
  if (tag === 'rect') {
    const x = num('x') || 0
    const y = num('y') || 0
    const w = num('width') || 0
    const h = num('height') || 0
    return { x: x + w / 2, y: y + h / 2 }
  }
  if (tag === 'circle' || tag === 'ellipse') return { x: num('cx') || 0, y: num('cy') || 0 }
  if (tag === 'line') {
    const x1 = num('x1') || 0
    const y1 = num('y1') || 0
    const x2 = num('x2') || 0
    const y2 = num('y2') || 0
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
    const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(parseFloat)
    if (pts.length >= 2) return bboxCenter(chunk(pts))
  }
  if (tag === 'path') {
    const nums = (el.getAttribute('d') || '').match(/-?[\d.]+(?:e-?\d+)?/gi)
    if (nums && nums.length >= 2) return bboxCenter(chunk(nums.map(parseFloat)))
  }
  if (tag === 'g') {
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
      const a = localAnchor(c)
      if (a) {
        const m = parseTransform(c.getAttribute('transform'))
        return applyMat(m, a.x, a.y)
      }
    }
  }
  return null
}

function chunk(arr: number[]): Pt2[] {
  const out: Pt2[] = []
  for (let i = 0; i + 1 < arr.length; i += 2) out.push({ x: arr[i], y: arr[i + 1] })
  return out
}

function bboxCenter(pts: Pt2[]): Pt2 {
  let minx = Infinity
  let miny = Infinity
  let maxx = -Infinity
  let maxy = -Infinity
  for (const p of pts) {
    minx = Math.min(minx, p.x)
    miny = Math.min(miny, p.y)
    maxx = Math.max(maxx, p.x)
    maxy = Math.max(maxy, p.y)
  }
  return { x: (minx + maxx) / 2, y: (miny + maxy) / 2 }
}

// ── fzp parsing ──────────────────────────────────────────────────────────────

function parseFzp(xml: string): Fzp {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const mod = doc.getElementsByTagName('module')[0]
  if (!mod) throw new Error('no <module> in .fzp')

  let family = ''
  const propsEl = mod.getElementsByTagName('properties')[0]
  if (propsEl) {
    for (const p of Array.from(propsEl.getElementsByTagName('property'))) {
      if ((p.getAttribute('name') || '').toLowerCase() === 'family')
        family = (p.textContent || '').trim()
    }
  }

  const viewImage: Partial<Record<string, string>> = {}
  for (const vname of ['breadboardView', 'schematicView', 'iconView']) {
    const v = mod.getElementsByTagName(vname)[0]
    if (!v) continue
    const layers = v.getElementsByTagName('layers')[0]
    if (layers) viewImage[vname] = layers.getAttribute('image') ?? undefined
  }

  const connectors: FzpConnector[] = []
  const connsEl = mod.getElementsByTagName('connectors')[0]
  if (connsEl) {
    for (const c of Array.from(connsEl.getElementsByTagName('connector'))) {
      const id = c.getAttribute('id') || ''
      const views: FzpConnector['views'] = {}
      for (const vname of ['breadboardView', 'schematicView']) {
        const v = c.getElementsByTagName(vname)[0]
        if (!v) continue
        const p = v.getElementsByTagName('p')[0]
        if (!p) continue
        views[vname] = {
          svgId: p.getAttribute('svgId') ?? undefined,
          terminalId: p.getAttribute('terminalId') ?? undefined,
          legId: p.getAttribute('legId') ?? undefined
        }
      }
      connectors.push({ id, name: c.getAttribute('name') || id, views })
    }
  }

  const title = (mod.getElementsByTagName('title')[0]?.textContent || '').trim()
  return { moduleId: mod.getAttribute('moduleId') || '', title, family, viewImage, connectors }
}

// ── per-view SVG extraction ──────────────────────────────────────────────────

function extractView(
  fzp: Fzp,
  view: ViewKind,
  svgText: string
): { view: PartView; unresolved: string[] } | null {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const svg = doc.getElementsByTagName('svg')[0]
  if (!svg) return null

  let vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(parseFloat)
  const wPx = toPx(svg.getAttribute('width'))
  const hPx = toPx(svg.getAttribute('height'))
  if (vb.length !== 4 || vb.some(Number.isNaN)) {
    if (wPx != null && hPx != null) vb = [0, 0, wPx, hPx]
    else return null
  }
  const [vbx, vby, vbw, vbh] = vb
  const sx = wPx != null && vbw ? wPx / vbw : 1
  const sy = hPx != null && vbh ? hPx / vbh : sx
  const center = { x: vbx + vbw / 2, y: vby + vbh / 2 }

  const tag = VIEW_TAG[view]
  const pins: Record<string, [number, number]> = {}
  const legPins: string[] = []
  const unresolved: string[] = []
  const usedNames = new Set<string>()
  for (const c of fzp.connectors) {
    const cv = c.views[tag]
    if (!cv) {
      unresolved.push(c.id)
      continue
    }
    // terminal is the precise wire point in schematic; pin element in breadboard
    const ids =
      view === 'schematic' ? [cv.terminalId, cv.svgId] : [cv.svgId, cv.terminalId]
    let pt: Pt2 | null = null
    for (const id of ids) {
      if (!id) continue
      const el = getById(svg, id)
      if (!el) continue
      const local = localAnchor(el)
      if (!local) continue
      const m = ctmFor(el)
      if (local.line) {
        // pick the line end farther from drawing centre (the free/wire end)
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
    let name = c.name || c.id
    let n = name
    let i = 2
    while (usedNames.has(n)) n = `${name}.${i++}`
    usedNames.add(n)
    pins[n] = [round((pt.x - vbx) * sx), round((pt.y - vby) * sy)]
    // bendable rubber-band leg (LED/resistor class parts) — see scripts/
    // fritzing-import.mjs for the matching bulk-importer half of this.
    if (cv.legId) legPins.push(n)
  }
  if (!Object.keys(pins).length) return null

  svg.removeAttribute('width')
  svg.removeAttribute('height')
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', vb.join(' '))
  const svgStr = minifySvg(new XMLSerializer().serializeToString(svg))

  return {
    view: {
      svg: svgStr,
      w: round(wPx != null ? wPx : vbw * sx),
      h: round(hPx != null ? hPx : vbh * sy),
      pins,
      ...(legPins.length ? { legs: legPins } : {})
    },
    unresolved: unresolved.map((id) => `${view}: ${id}`)
  }
}

function extractIcon(svgText: string): string | null {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const svg = doc.getElementsByTagName('svg')[0]
  if (!svg) return null
  const w = toPx(svg.getAttribute('width'))
  const h = toPx(svg.getAttribute('height'))
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (!svg.getAttribute('viewBox') && w != null && h != null)
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  return minifySvg(new XMLSerializer().serializeToString(svg))
}

// ── entry point ──────────────────────────────────────────────────────────────

/** Convert a `.fzpz` archive into a registrable PartDef. Throws with a
 * human-readable message when the archive is not a usable Fritzing part. */
export async function importFzpz(bytes: Uint8Array, fileName?: string): Promise<FzpzResult> {
  const entries = await unzip(bytes)
  const byName = new Map(entries.map((e) => [e.name, e]))

  const fzpEntry = entries.find((e) => e.name.toLowerCase().endsWith('.fzp'))
  if (!fzpEntry) throw new Error('no .fzp inside the archive — is this a Fritzing part?')
  const decoder = new TextDecoder()
  const fzp = parseFzp(decoder.decode(fzpEntry.data))

  // "part.<name>.fzp" → <name>; fall back to the dropped filename / title
  const base =
    /^part\.(.+)\.fzp$/i.exec(fzpEntry.name)?.[1] ??
    fileName?.replace(/\.fzpz$/i, '') ??
    fzp.title
  const type = slug(base)

  // view image "breadboard/foo.svg" is stored flat as "svg.breadboard.foo.svg"
  const svgTextFor = (image: string | undefined): string | null => {
    if (!image) return null
    const flat = `svg.${image.replace(/\//g, '.')}`
    const entry =
      byName.get(flat) ??
      entries.find((e) => e.name.toLowerCase() === flat.toLowerCase()) ??
      entries.find((e) => e.name.toLowerCase().endsWith(image.split('/').pop()!.toLowerCase()))
    return entry ? decoder.decode(entry.data) : null
  }

  const views: PartDef['views'] = {}
  const warnings: string[] = []
  for (const view of ['breadboard', 'schematic'] as ViewKind[]) {
    const svgText = svgTextFor(fzp.viewImage[VIEW_TAG[view]])
    if (!svgText) continue
    const res = extractView(fzp, view, svgText)
    if (!res) continue
    views[view] = res.view
    warnings.push(...res.unresolved)
  }
  if (!Object.keys(views).length)
    throw new Error('no usable view (missing SVGs or unresolvable pins)')

  const iconText = svgTextFor(fzp.viewImage.iconView)
  const icon =
    (iconText ? extractIcon(iconText) : null) ??
    (views.breadboard?.svg && views.breadboard.svg.length < 4000
      ? views.breadboard.svg
      : undefined) ??
    undefined

  const def: PartDef = {
    type,
    label: fzp.title || type,
    family: fzp.family || 'Imported',
    icon,
    views
  }
  return { def, warnings }
}
