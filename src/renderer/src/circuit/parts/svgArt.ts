/**
 * circuit/parts/svgArt — reading and preparing part artwork that lives as real,
 * hand-editable .svg files (tinyparts folder parts; see docs/parts-and-art.md).
 *
 * Three jobs, all DOM-free so they behave identically in the app, under
 * `node --test`, and in scripts/parts-tool.mjs:
 *
 *  1. PIN DISCOVERY. A pin is any element whose id is `pin-<NAME>` — name the
 *     object "pin-GND" in Illustrator's Layers panel and it becomes pin GND.
 *     Its position is the centre of that shape (or group), through every
 *     ancestor transform, mapped from viewBox units into the part's pixel box.
 *     Move the pad in Illustrator and the pin moves with it.
 *  2. ILLUSTRATOR TOLERANCE. Illustrator escapes characters in exported ids
 *     (`pin-3V3.2` can come back as `pin-3V3_x2E_2`), suffixes duplicate names
 *     (`pin-GND_1_`), and rewrites the root width/height. Ids are decoded, and
 *     the part box always comes from part.json when it says so.
 *  3. NAMESPACING. Every part is inlined into ONE page (canvas + palette), so
 *     two SVGs that both define `SVGID_1_` or a `.st0` class paint each other.
 *     Referenced ids and <style> classes are prefixed per part art file.
 */

import { applyMat, IDENT, matMul, parseTransform, toPx, type Mat } from './svgUnits'

// ── tokenizer ────────────────────────────────────────────────────────────────

interface Tag {
  kind: 'open' | 'close'
  /** tag name without any namespace prefix, lower-cased (`svg:rect` → `rect`) */
  name: string
  attrs: Record<string, string>
  selfClosing: boolean
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITY[e.toLowerCase()] ?? m
  })
}

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) out[m[1]] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  return out
}

const localName = (n: string): string =>
  (n.includes(':') ? n.slice(n.indexOf(':') + 1) : n).toLowerCase()

// Markup that carries no elements: comments, processing instructions and a
// DOCTYPE (with its internal subset — old Illustrator "Save As SVG" writes
// `<!DOCTYPE svg [ <!ENTITY …> ]>`). CDATA is separate: the tokenizer skips it,
// but prepareArt must keep it (it wraps <style> content).
const PROLOG = String.raw`<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^>\[]|\[[\s\S]*?\])*>`
const CDATA = String.raw`<!\[CDATA\[[\s\S]*?\]\]>`
const TAG_RE = new RegExp(
  String.raw`${PROLOG}|${CDATA}|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>`,
  'gi'
)

/** Start/end tags in document order; comments, CDATA and prolog are skipped. */
function* tags(svg: string): Generator<Tag> {
  const re = new RegExp(TAG_RE.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(svg))) {
    if (m[1]) yield { kind: 'close', name: localName(m[1]), attrs: {}, selfClosing: false }
    else if (m[2])
      yield {
        kind: 'open',
        name: localName(m[2]),
        attrs: parseAttrs(m[3] || ''),
        selfClosing: m[4] === '/'
      }
  }
}

// ── root box ─────────────────────────────────────────────────────────────────

export interface SvgRoot {
  /** [minX, minY, width, height] in user units */
  vb: [number, number, number, number]
  /** root width/height in px @ 96 DPI, when the file states a real size */
  widthPx: number | null
  heightPx: number | null
}

export function readSvgRoot(svg: string): SvgRoot {
  for (const t of tags(svg)) {
    if (t.kind !== 'open' || t.name !== 'svg') continue
    const w = toPx(t.attrs.width)
    const h = toPx(t.attrs.height)
    const parts = (t.attrs.viewBox || '')
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    const vb: [number, number, number, number] =
      parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0
        ? (parts as [number, number, number, number])
        : [0, 0, w ?? 100, h ?? 100]
    return { vb, widthPx: w, heightPx: h }
  }
  return { vb: [0, 0, 100, 100], widthPx: null, heightPx: null }
}

// ── geometry ─────────────────────────────────────────────────────────────────

type Box = [number, number, number, number] // minX, minY, maxX, maxY

const num = (v: string | undefined): number => {
  const n = parseFloat(v ?? '')
  return Number.isFinite(n) ? n : 0
}

function boxOf(xy: number[]): Box | null {
  if (xy.length < 2) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = 0; i + 1 < xy.length; i += 2) {
    x0 = Math.min(x0, xy[i])
    x1 = Math.max(x1, xy[i])
    y0 = Math.min(y0, xy[i + 1])
    y1 = Math.max(y1, xy[i + 1])
  }
  return [x0, y0, x1, y1]
}

const CMD = /[MmLlHhVvCcSsQqTtAaZz]/
const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y

/**
 * Every endpoint and control point of a path, absolute. The control-point hull
 * over-estimates a curve's true bbox, but symmetrically for the round and
 * rectangular pads pins sit on — so the centre is exact where it matters.
 */
export function pathPoints(d: string): number[] {
  const pts: number[] = []
  const n = d.length
  let i = 0
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let cmd = ''
  const sep = (): void => {
    while (i < n && /[\s,]/.test(d[i])) i++
  }
  const number = (): number | null => {
    sep()
    NUM.lastIndex = i
    const m = NUM.exec(d)
    if (!m) return null
    i += m[0].length
    return parseFloat(m[0])
  }
  const flag = (): number | null => {
    sep()
    if (d[i] === '0' || d[i] === '1') return Number(d[i++])
    return null
  }
  for (;;) {
    sep()
    if (i >= n) break
    if (CMD.test(d[i])) {
      cmd = d[i++]
      if (cmd === 'Z' || cmd === 'z') {
        x = sx
        y = sy
        continue
      }
    } else if (!cmd || cmd === 'Z' || cmd === 'z') break
    const rel = cmd !== cmd.toUpperCase()
    const C = cmd.toUpperCase()
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    if (C === 'H') {
      const v = number()
      if (v == null) break
      x = ox + v
      pts.push(x, y)
    } else if (C === 'V') {
      const v = number()
      if (v == null) break
      y = oy + v
      pts.push(x, y)
    } else if (C === 'A') {
      const args = [number(), number(), number(), flag(), flag(), number(), number()]
      if (args.some((a) => a == null)) break
      x = ox + (args[5] as number)
      y = oy + (args[6] as number)
      pts.push(x, y)
    } else {
      const pairs = C === 'C' ? 3 : C === 'S' || C === 'Q' ? 2 : 1
      let ok = true
      for (let j = 0; j < pairs; j++) {
        const px = number()
        const py = number()
        if (px == null || py == null) {
          ok = false
          break
        }
        pts.push(ox + px, oy + py)
        if (j === pairs - 1) {
          x = ox + px
          y = oy + py
        }
      }
      if (!ok) break
      if (C === 'M') {
        sx = x
        sy = y
        cmd = rel ? 'l' : 'L' // extra pairs after a moveto are linetos
      }
    }
  }
  return pts
}

/** An element's own bounding box in its local user space (null = no geometry). */
function localBox(name: string, a: Record<string, string>): Box | null {
  switch (name) {
    case 'circle': {
      const r = num(a.r)
      return [num(a.cx) - r, num(a.cy) - r, num(a.cx) + r, num(a.cy) + r]
    }
    case 'ellipse': {
      const rx = num(a.rx)
      const ry = num(a.ry)
      return [num(a.cx) - rx, num(a.cy) - ry, num(a.cx) + rx, num(a.cy) + ry]
    }
    case 'rect':
    case 'image':
    case 'foreignobject':
      return [num(a.x), num(a.y), num(a.x) + num(a.width), num(a.y) + num(a.height)]
    case 'line':
      return boxOf([num(a.x1), num(a.y1), num(a.x2), num(a.y2)])
    case 'polyline':
    case 'polygon':
      return boxOf(
        (a.points || '')
          .trim()
          .split(/[\s,]+/)
          .map(Number)
          .filter(Number.isFinite)
      )
    case 'path':
      return boxOf(pathPoints(a.d || ''))
    case 'text':
    case 'tspan': {
      const x = num((a.x || '').split(/[\s,]+/)[0])
      const y = num((a.y || '').split(/[\s,]+/)[0])
      return [x, y, x, y]
    }
    default:
      return null
  }
}

function transformBox(b: Box, m: Mat): Box {
  const c = [
    applyMat(m, b[0], b[1]),
    applyMat(m, b[2], b[1]),
    applyMat(m, b[0], b[3]),
    applyMat(m, b[2], b[3])
  ]
  return boxOf(c.flatMap((p) => [p.x, p.y]))!
}

function grow(into: { box: Box | null }, b: Box): void {
  into.box = into.box
    ? [
        Math.min(into.box[0], b[0]),
        Math.min(into.box[1], b[1]),
        Math.max(into.box[2], b[2]),
        Math.max(into.box[3], b[3])
      ]
    : b
}

// ── pins ─────────────────────────────────────────────────────────────────────

/** Undo Illustrator's id mangling: `_x2E_` escapes and `_1_` duplicate suffixes. */
export function decodeIllustratorId(id: string): string {
  return id
    .replace(/_x([0-9A-Fa-f]{2,4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/_\d+_$/, '')
}

/** `pin-GND` → `GND`; anything else → null. `pin:` is accepted too. */
export function pinNameFromId(id: string): string | null {
  const m = /^pin[-:](.+)$/.exec(decodeIllustratorId(id))
  return m ? m[1] : null
}

/** Elements whose content never renders — pins can't live inside these. */
const NON_RENDERED = new Set([
  'defs',
  'clippath',
  'mask',
  'symbol',
  'pattern',
  'marker',
  'lineargradient',
  'radialgradient',
  'filter',
  'style',
  'title',
  'desc',
  'metadata',
  'script'
])

export interface PinScan {
  /** pins in document order, px @ 96 DPI from the part box's top-left */
  pins: { name: string; at: [number, number] }[]
  /** pin names that appear on more than one element (the first one wins) */
  duplicates: string[]
  /** pin elements with no drawable geometry (an empty group, say) */
  empty: string[]
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Find every `pin-<NAME>` element and place it in a `w`×`h` px part box. The
 * art is fitted into the box the way the canvas renders it (uniform scale,
 * centred — SVG's default preserveAspectRatio), so pins land on the art even
 * when the box and the viewBox disagree on aspect.
 */
export function scanPins(svg: string, w?: number | null, h?: number | null): PinScan {
  const root = readSvgRoot(svg)
  const W = w ?? root.widthPx ?? root.vb[2]
  const H = h ?? root.heightPx ?? root.vb[3]
  const [vx, vy, vw, vh] = root.vb
  const s = Math.min(W / vw, H / vh)
  const ox = (W - vw * s) / 2
  const oy = (H - vh * s) / 2

  interface Acc {
    name: string
    box: Box | null
  }
  interface Frame {
    name: string
    m: Mat
    hidden: boolean
    pin?: Acc
  }
  const stack: Frame[] = []
  const found: Acc[] = []
  let sawRoot = false

  for (const t of tags(svg)) {
    if (t.kind === 'close') {
      // pop back to the matching open tag (tolerates sloppy nesting)
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === t.name) {
          stack.length = k
          break
        }
      }
      continue
    }
    const parent = stack[stack.length - 1]
    let m = parent ? parent.m : IDENT
    // the root <svg>'s viewBox is handled by the box fit above; a nested <svg>
    // or a <use> offsets its content by x/y
    if ((t.name === 'svg' && sawRoot) || t.name === 'use')
      m = matMul(m, [1, 0, 0, 1, num(t.attrs.x), num(t.attrs.y)])
    if (t.name === 'svg') sawRoot = true
    m = matMul(m, parseTransform(t.attrs.transform))
    const hidden = (parent?.hidden ?? false) || NON_RENDERED.has(t.name)

    let pin: Acc | undefined
    const name = !hidden && t.attrs.id ? pinNameFromId(t.attrs.id) : null
    if (name) {
      pin = { name, box: null }
      found.push(pin)
    }
    const own = hidden ? null : localBox(t.name, t.attrs)
    if (own) {
      const b = transformBox(own, m)
      if (pin) grow(pin, b)
      for (const f of stack) if (f.pin) grow(f.pin, b)
    }
    if (!t.selfClosing) stack.push({ name: t.name, m, hidden, pin })
  }

  const out: PinScan = { pins: [], duplicates: [], empty: [] }
  const seen = new Set<string>()
  for (const f of found) {
    if (!f.box) {
      out.empty.push(f.name)
      continue
    }
    if (seen.has(f.name)) {
      if (!out.duplicates.includes(f.name)) out.duplicates.push(f.name)
      continue
    }
    seen.add(f.name)
    const cx = (f.box[0] + f.box[2]) / 2
    const cy = (f.box[1] + f.box[3]) / 2
    out.pins.push({ name: f.name, at: [round2(ox + (cx - vx) * s), round2(oy + (cy - vy) * s)] })
  }
  return out
}

// ── preparing art for inlining ───────────────────────────────────────────────

/**
 * Strip what a file carries but an inlined part must not: the XML prolog,
 * DOCTYPE, comments, Illustrator's private `<i:pgf>` data blob, and the root
 * width/height (the part box sizes the art). A missing viewBox is derived from
 * the root size so the art still scales.
 */
export function prepareArt(svg: string): string {
  let s = svg
    .replace(new RegExp(PROLOG, 'gi'), '')
    .replace(/<i:pgf\b[\s\S]*?<\/i:pgf>/gi, '')
    .trim()
  s = s.replace(/<svg\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/i, (_m, attrs: string, sc: string) => {
    const a = parseAttrs(attrs)
    let rest = attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    if (!a.viewBox) {
      const w = toPx(a.width)
      const h = toPx(a.height)
      if (w && h) rest += ` viewBox="0 0 ${round2(w)} ${round2(h)}"`
    }
    if (!a.xmlns) rest += ' xmlns="http://www.w3.org/2000/svg"'
    return `<svg${rest}${sc}>`
  })
  return s
}

// ── namespacing ──────────────────────────────────────────────────────────────

/**
 * The id/class prefix for one art file of a part; `art` names its role (a view
 * kind, or "icon"). Per file, not just per type: a part's icon and views are
 * separate exports that reuse generic class names (Illustrator's `.st0`…) with
 * different styles, and inlined on one page each `<style>` would repaint the
 * other. Stable, so re-preparing the same art is a no-op.
 */
export function artPrefix(type: string, art?: string): string {
  return `p-${(art ? `${type}-${art}` : type).replace(/[^A-Za-z0-9_-]/g, '_')}-`
}

const URL_REF = /url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g
const HREF_REF = /(\s(?:xlink:)?href\s*=\s*)(["'])#(.*?)\2/g
const ID_ATTR = /(\sid\s*=\s*)(["'])(.*?)\2/g
const CLASS_ATTR = /(\sclass\s*=\s*)(["'])(.*?)\2/g
const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi
const CSS_RULE = /([^{}]*)\{([^{}]*)\}/g
const CSS_CLASS = /\.(-?[_a-zA-Z][\w-]*)/g
const CSS_ID = /#(-?[_a-zA-Z][\w-]*)/g

/**
 * Prefix every id that something references (gradients, clip paths, masks,
 * filters, <use> targets) and every class a <style> block defines. Ids nothing
 * references are left alone — pin ids, Fritzing `connectorNleg` legs and
 * resistor `band_*` hooks are looked up by name elsewhere.
 */
export function namespaceSvg(svg: string, prefix: string): string {
  const defined = new Set<string>()
  for (const m of svg.matchAll(ID_ATTR)) defined.add(m[3])
  const ids = new Set<string>()
  for (const m of svg.matchAll(URL_REF)) if (defined.has(m[2])) ids.add(m[2])
  for (const m of svg.matchAll(HREF_REF)) if (defined.has(m[3])) ids.add(m[3])
  for (const id of ids) if (id.startsWith(prefix)) ids.delete(id)

  const classes = new Set<string>()
  for (const block of svg.matchAll(STYLE_BLOCK)) {
    for (const rule of block[2].matchAll(CSS_RULE)) {
      if (rule[1].trim().startsWith('@')) continue
      for (const c of rule[1].matchAll(CSS_CLASS)) if (!c[1].startsWith(prefix)) classes.add(c[1])
    }
  }
  if (!ids.size && !classes.size) return svg

  const refUrl = (m: string, q: string, id: string): string =>
    ids.has(id) ? `url(${q}#${prefix}${id}${q})` : m
  let out = svg.replace(
    STYLE_BLOCK,
    (_m, open: string, css: string, close: string) =>
      open +
      css.replace(CSS_RULE, (_r, sel: string, body: string) => {
        const s = sel.trim().startsWith('@')
          ? sel
          : sel
              .replace(CSS_CLASS, (mm, c: string) => (classes.has(c) ? `.${prefix}${c}` : mm))
              .replace(CSS_ID, (mm, i: string) => (ids.has(i) ? `#${prefix}${i}` : mm))
        return `${s}{${body.replace(URL_REF, refUrl)}}`
      }) +
      close
  )
  out = out
    .replace(ID_ATTR, (m, a: string, q: string, id: string) =>
      ids.has(id) ? `${a}${q}${prefix}${id}${q}` : m
    )
    .replace(URL_REF, refUrl)
    .replace(HREF_REF, (m, a: string, q: string, id: string) =>
      ids.has(id) ? `${a}${q}#${prefix}${id}${q}` : m
    )
  if (classes.size)
    out = out.replace(
      CLASS_ATTR,
      (_m, a: string, q: string, v: string) =>
        `${a}${q}${v
          .split(/\s+/)
          .map((c) => (classes.has(c) ? prefix + c : c))
          .join(' ')}${q}`
    )
  return out
}
