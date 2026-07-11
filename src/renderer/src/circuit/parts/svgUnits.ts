/**
 * circuit/parts/svgUnits — pure SVG unit + transform math for the .fzpz
 * importer. Mirrors scripts/fritzing-import.mjs (the offline bulk importer);
 * keep the two in sync. No DOM here so it runs under `node --test`.
 */

export type Mat = [number, number, number, number, number, number]
export interface Pt2 {
  x: number
  y: number
}

const PX_PER_MM = 96 / 25.4 // 96 DPI, the Wokwi pixel convention

/** Convert an SVG length attribute (with unit) to pixels @ 96 DPI. */
export function toPx(value: string | null | undefined): number | null {
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

export const IDENT: Mat = [1, 0, 0, 1, 0, 0]

/** m · n — point map is x' = a·x + c·y + e ; y' = b·x + d·y + f */
export function matMul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ]
}

export function applyMat(m: Mat, x: number, y: number): Pt2 {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}

/** Parse an SVG `transform` attribute into one matrix. */
export function parseTransform(str: string | null | undefined): Mat {
  let m = IDENT
  if (!str) return m
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  let r: RegExpExecArray | null
  while ((r = re.exec(str))) {
    const fn = r[1]
    const args = r[2]
      .split(/[\s,]+/)
      .map(parseFloat)
      .filter((n) => !Number.isNaN(n))
    let t: Mat = IDENT
    if (fn === 'matrix' && args.length === 6) t = args as Mat
    else if (fn === 'translate') t = [1, 0, 0, 1, args[0] || 0, args[1] || 0]
    else if (fn === 'scale')
      t = [args[0] || 1, 0, 0, args.length > 1 ? args[1] : args[0] || 1, 0, 0]
    else if (fn === 'rotate') {
      const rad = ((args[0] || 0) * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const rot: Mat = [cos, sin, -sin, cos, 0, 0]
      if (args.length >= 3) {
        const cx = args[1]
        const cy = args[2]
        t = matMul(matMul([1, 0, 0, 1, cx, cy], rot), [1, 0, 0, 1, -cx, -cy])
      } else t = rot
    } else if (fn === 'skewX') t = [1, 0, Math.tan(((args[0] || 0) * Math.PI) / 180), 1, 0, 0]
    else if (fn === 'skewY') t = [1, Math.tan(((args[0] || 0) * Math.PI) / 180), 0, 1, 0, 0]
    m = matMul(m, t)
  }
  return m
}

/** Strip XML decl / DOCTYPE / comments and collapse inter-tag whitespace. */
export function minifySvg(str: string): string {
  return str
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .trim()
}
