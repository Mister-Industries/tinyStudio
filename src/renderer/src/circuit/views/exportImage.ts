/**
 * circuit/views/exportImage — compose a scene (breadboard OR schematic) into a
 * standalone SVG and download it as .svg or rasterized .png @2×. Part SVG ids
 * are namespaced per instance (fixes B6). Schematic wires are single ink
 * strokes; net labels are rendered from their glyphs.
 */

import { isBreadboard } from '../parts/breadboard'
import { netLabelVisualOf } from '../parts/netLabels'
import { escapeXml, namespaceSvgIds, prepareSvgForEmbed, svgNs } from '../parts/svg'
import { isJunction, type CircuitDoc, type ViewId } from '../core/model'
import { makeEndResolver, partArtFor, viewBounds, visualFor, wireGeometry } from './partsAdapter'

const WIRE_W = 2.8
const WIRE_OUTLINE_W = WIRE_W + 1.8
const WIRE_SCH_W = 1
const INK = 'var(--text-strong)'

function darken(hex: string, f = 0.55): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return 'rgba(0,0,0,0.45)'
  const n = parseInt(m[1], 16)
  return `rgb(${Math.round(((n >> 16) & 255) * f)}, ${Math.round(((n >> 8) & 255) * f)}, ${Math.round((n & 255) * f)})`
}

function roundedPath(points: { x: number; y: number }[], r = 4): string {
  if (points.length < 2) return ''
  if (points.length === 2) return `M${points[0].x} ${points[0].y} L${points[1].x} ${points[1].y}`
  let d = `M${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1]
    const c = points[i]
    const n = points[i + 1]
    const d1 = Math.hypot(c.x - p.x, c.y - p.y) || 1
    const d2 = Math.hypot(n.x - c.x, n.y - c.y) || 1
    const rr = Math.max(0, Math.min(r, d1 / 2, d2 / 2))
    const a = { x: c.x - ((c.x - p.x) / d1) * rr, y: c.y - ((c.y - p.y) / d1) * rr }
    const b = { x: c.x + ((n.x - c.x) / d2) * rr, y: c.y + ((n.y - c.y) / d2) * rr }
    d += ` L${a.x} ${a.y} Q${c.x} ${c.y} ${b.x} ${b.y}`
  }
  const last = points[points.length - 1]
  d += ` L${last.x} ${last.y}`
  return d
}

/** Embed one part/label svg at a placement, ids namespaced, rotate+flip applied. */
function embed(
  svg: string,
  ns: string,
  x: number,
  y: number,
  w: number,
  h: number,
  rotate?: number,
  flip?: boolean
): string {
  const inner = prepareSvgForEmbed(namespaceSvgIds(svg, svgNs(ns))).replace(
    '<svg',
    `<svg x="${x}" y="${y}" width="${w}" height="${h}"`
  )
  const cx = x + w / 2
  const cy = y + h / 2
  let tf = ''
  if (rotate) tf += `rotate(${rotate} ${cx} ${cy}) `
  if (flip) tf += `translate(${2 * cx} 0) scale(-1 1) `
  return tf ? `<g transform="${tf.trim()}">${inner}</g>` : `<g>${inner}</g>`
}

/** Build the standalone scene SVG for a view (exported for tests; default bb). */
export function composeSceneSvg(doc: CircuitDoc, bg: string, view: ViewId = 'bb'): string | null {
  const bounds = viewBounds(doc, view)
  if (!bounds) return null
  const sch = view === 'sch'
  const pad = 36
  const minX = bounds.minX - pad
  const minY = bounds.minY - pad
  const maxX = bounds.maxX + pad + 60
  const maxY = bounds.maxY + pad + 48 // room for the larger watermark
  const W = Math.round(maxX - minX)
  const H = Math.round(maxY - minY)

  const wires = wireGeometry(doc, view)
    .map(({ w, pts }) => {
      if (pts.length < 2) return ''
      const d = roundedPath(pts)
      if (sch)
        return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${WIRE_SCH_W}" stroke-linejoin="round" stroke-linecap="round"/>`
      const core = w.color || '#2fa46a'
      return `<path d="${d}" fill="none" stroke="${darken(core)}" stroke-width="${WIRE_OUTLINE_W}" stroke-linejoin="round" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${core}" stroke-width="${WIRE_W}" stroke-linejoin="round" stroke-linecap="round"/>`
    })
    .join('')

  const resolve = makeEndResolver(doc, undefined, view)
  const dots = doc.wires
    .filter((w) => w.view === view)
    .flatMap((w) =>
      [w.from, w.to].filter(isJunction).map((j) => {
        const p = resolve(j)
        return p
          ? `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${sch ? INK : w.color || '#c9ced6'}"/>`
          : ''
      })
    )
    .join('')

  const partSvg = (part: (typeof doc.parts)[number]): string => {
    const pl = part[view]
    if (!pl) return ''
    if (sch && isBreadboard(part.type)) return '' // breadboards are transparent in sch
    const vis = visualFor(part.type, view)
    if (!vis) return ''
    const art = partArtFor(part, vis, view)
    const g = embed(art, part.id, pl.x, pl.y, vis.v.w, vis.v.h, pl.rotate, sch && pl.flip)
    const off = pl.labelOffset || [0, 0]
    const labelText = String(part.attrs?.label ?? part.id)
    const label = `<text x="${pl.x + off[0]}" y="${pl.y + vis.v.h + 13 + off[1]}" fill="#969ba3" font-family="Plus Jakarta Sans, sans-serif" font-size="11">${escapeXml(labelText)}</text>`
    return `${g}${label}`
  }
  // boards paint first — under the wires and every other part
  const boardsSvg = doc.parts.filter((p) => isBreadboard(p.type)).map(partSvg).join('')
  const partsSvg = doc.parts.filter((p) => !isBreadboard(p.type)).map(partSvg).join('')

  const labelsSvg = sch
    ? (doc.netLabels ?? [])
        .map((label) => {
          const v = netLabelVisualOf(label)
          return embed(v.svg, label.id, label.sch.x, label.sch.y, v.w, v.h, label.sch.rotate)
        })
        .join('')
    : ''

  const watermark = `<text x="${maxX - 14}" y="${maxY - 16}" text-anchor="end" fill="#79818c" fill-opacity="0.4" font-family="Plus Jakarta Sans, sans-serif" font-size="46" letter-spacing="-1"><tspan font-weight="300">tiny</tspan><tspan font-weight="800">Studio</tspan></text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="${minX} ${minY} ${W} ${H}"><rect x="${minX}" y="${minY}" width="${W}" height="${H}" fill="${bg}"/>${boardsSvg}${wires}${dots}${partsSvg}${labelsSvg}${watermark}</svg>`
}

/**
 * Inline every var(--token) with its computed value — builtin art and schematic
 * ink use design-system variables that only resolve inside the app stylesheet.
 */
function resolveCssVars(svg: string): string {
  const cs = getComputedStyle(document.documentElement)
  return svg.replace(/var\((--[A-Za-z0-9_-]+)\)/g, (all, name) => {
    const v = cs.getPropertyValue(name).trim()
    return v || all
  })
}

function download(blob: Blob, name: string): void {
  const a = document.createElement('a')
  const href = URL.createObjectURL(blob)
  a.href = href
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

function bgFor(view: ViewId): string {
  const token = view === 'sch' ? '--bg' : '--bg-sunken'
  return (getComputedStyle(document.documentElement).getPropertyValue(token) || '#1e1f22').trim()
}

export function exportSvg(doc: CircuitDoc, view: ViewId = 'bb'): void {
  const svg = composeSceneSvg(doc, bgFor(view), view)
  if (!svg) return
  const name = view === 'sch' ? 'circuit-schematic.svg' : 'circuit.svg'
  download(new Blob([resolveCssVars(svg)], { type: 'image/svg+xml;charset=utf-8' }), name)
}

export function exportPng(doc: CircuitDoc, view: ViewId = 'bb'): void {
  const raw = composeSceneSvg(doc, bgFor(view), view)
  if (!raw) return
  const svg = resolveCssVars(raw)
  const m = /width="(\d+)" height="(\d+)"/.exec(svg)
  const W = m ? parseInt(m[1], 10) : 800
  const H = m ? parseInt(m[2], 10) : 600
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  const img = new Image()
  img.onload = () => {
    const sf = 2
    const canvas = document.createElement('canvas')
    canvas.width = W * sf
    canvas.height = H * sf
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      URL.revokeObjectURL(url)
      return
    }
    ctx.scale(sf, sf)
    ctx.drawImage(img, 0, 0)
    URL.revokeObjectURL(url)
    canvas.toBlob((png) => {
      if (png) download(png, view === 'sch' ? 'circuit-schematic.png' : 'circuit.png')
    }, 'image/png')
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    console.error('circuit PNG export: SVG failed to rasterize')
  }
  img.src = url
}
