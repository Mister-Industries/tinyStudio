/**
 * circuit/views/exportImage — compose the bb scene into a standalone SVG and
 * download it as .svg or rasterized .png @2×. Part SVG ids are namespaced per
 * instance (fixes B6: two parts sharing `id="g"` corrupted exports).
 */

import { escapeXml, namespaceSvgIds, prepareSvgForEmbed, svgNs } from '../parts/svg'
import { isJunction, type CircuitDoc } from '../core/model'
import { bbBounds, bbVisual, bbWireGeometry, makeEndResolver } from './partsAdapter'

const WIRE_W = 2.8
const WIRE_OUTLINE_W = WIRE_W + 1.8

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

/** Build the standalone scene SVG (exported for tests). */
export function composeSceneSvg(doc: CircuitDoc, bg: string): string | null {
  const bounds = bbBounds(doc)
  if (!bounds) return null
  const pad = 36
  const minX = bounds.minX - pad
  const minY = bounds.minY - pad
  const maxX = bounds.maxX + pad + 60 // room for labels
  const maxY = bounds.maxY + pad + 16 // room for the watermark
  const W = Math.round(maxX - minX)
  const H = Math.round(maxY - minY)

  const geom = bbWireGeometry(doc)
  const wires = geom
    .map(({ w, pts }) => {
      if (pts.length < 2) return ''
      const core = w.color || '#2fa46a'
      const d = roundedPath(pts)
      return `<path d="${d}" fill="none" stroke="${darken(core)}" stroke-width="${WIRE_OUTLINE_W}" stroke-linejoin="round" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${core}" stroke-width="${WIRE_W}" stroke-linejoin="round" stroke-linecap="round"/>`
    })
    .join('')

  const resolve = makeEndResolver(doc)
  const dots = doc.wires
    .filter((w) => w.view === 'bb')
    .flatMap((w) =>
      [w.from, w.to].filter(isJunction).map((j) => {
        const p = resolve(j)
        return p ? `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${w.color || '#c9ced6'}"/>` : ''
      })
    )
    .join('')

  const partsSvg = doc.parts
    .map((part) => {
      if (!part.bb) return ''
      const vis = bbVisual(part.type)
      if (!vis) return ''
      const { x, y } = part.bb
      const inner = prepareSvgForEmbed(namespaceSvgIds(vis.v.svg, svgNs(part.id))).replace(
        '<svg',
        `<svg x="${x}" y="${y}" width="${vis.v.w}" height="${vis.v.h}"`
      )
      const rot = part.bb.rotate
        ? ` transform="rotate(${part.bb.rotate} ${x + vis.v.w / 2} ${y + vis.v.h / 2})"`
        : ''
      const off = part.bb.labelOffset || [0, 0]
      const labelText = String(part.attrs?.label ?? part.id)
      const label = `<text x="${x + off[0]}" y="${y + vis.v.h + 13 + off[1]}" fill="#969ba3" font-family="Plus Jakarta Sans, sans-serif" font-size="11">${escapeXml(labelText)}</text>`
      return `<g${rot}>${inner}</g>${label}`
    })
    .join('')

  const watermark = `<text x="${maxX - 10}" y="${maxY - 10}" text-anchor="end" fill="#79818c" fill-opacity="0.75" font-family="Plus Jakarta Sans, sans-serif" font-size="13" font-weight="600">tinyStudio</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="${minX} ${minY} ${W} ${H}"><rect x="${minX}" y="${minY}" width="${W}" height="${H}" fill="${bg}"/>${wires}${dots}${partsSvg}${watermark}</svg>`
}

/**
 * Inline every var(--token) with its computed value — builtin board art uses
 * design-system variables that only resolve inside the app's stylesheet, not
 * in a standalone .svg / rasterized .png.
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

export function exportSvg(doc: CircuitDoc): void {
  const bg = (getComputedStyle(document.documentElement).getPropertyValue('--bg-sunken') || '#1e1f22').trim()
  const svg = composeSceneSvg(doc, bg)
  if (!svg) return
  download(new Blob([resolveCssVars(svg)], { type: 'image/svg+xml;charset=utf-8' }), 'circuit.svg')
}

export function exportPng(doc: CircuitDoc): void {
  const bg = (getComputedStyle(document.documentElement).getPropertyValue('--bg-sunken') || '#1e1f22').trim()
  const raw = composeSceneSvg(doc, bg)
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
      if (png) download(png, 'circuit.png')
    }, 'image/png')
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    console.error('circuit PNG export: SVG failed to rasterize')
  }
  img.src = url
}
