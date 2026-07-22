/**
 * circuit/parts/svg — SVG utilities for part artwork.
 *
 * M1 ships the pieces the image exporter needs (B6 fix): id-namespacing so
 * two parts whose SVGs both define e.g. `id="g"` don't corrupt each other in
 * a composed export, plus small size/escape helpers. The full sanitizer and
 * the procedural breadboard generator land in M2 (spec §5).
 *
 * Pure string transforms — no DOM — so they run in tests, workers, exports.
 */

/**
 * Prefix every id defined in an SVG string (and every internal reference to
 * one: url(#…), href="#…", xlink:href="#…") with `ns-`. External hrefs are
 * untouched.
 */
export function namespaceSvgIds(svg: string, ns: string): string {
  const ids = new Set<string>()
  for (const m of svg.matchAll(/\bid\s*=\s*"([^"]+)"/g)) ids.add(m[1])
  for (const m of svg.matchAll(/\bid\s*=\s*'([^']+)'/g)) ids.add(m[1])
  if (ids.size === 0) return svg
  const has = (id: string): boolean => ids.has(id)

  // rewrite #id selectors inside <style> blocks first (rare but real in
  // Fritzing exports; attribute passes below don't reach CSS text)
  svg = svg.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_all, open, css, close) => {
    const fixed = css.replace(/#([A-Za-z_][\w-]*)/g, (m: string, id: string) =>
      has(id) ? `#${ns}-${id}` : m
    )
    return `${open}${fixed}${close}`
  })

  return svg
    .replace(/\bid\s*=\s*"([^"]+)"/g, (all, id) => (has(id) ? `id="${ns}-${id}"` : all))
    .replace(/\bid\s*=\s*'([^']+)'/g, (all, id) => (has(id) ? `id='${ns}-${id}'` : all))
    .replace(/url\(#([^)]+)\)/g, (all, id) => (has(id) ? `url(#${ns}-${id})` : all))
    .replace(/\b(xlink:href|href)\s*=\s*"#([^"]+)"/g, (all, attr, id) =>
      has(id) ? `${attr}="#${ns}-${id}"` : all
    )
    .replace(/\b(xlink:href|href)\s*=\s*'#([^']+)'/g, (all, attr, id) =>
      has(id) ? `${attr}='#${ns}-${id}'` : all
    )
}

/** Sanitize a part id into a token safe for use as an SVG id namespace. */
export function svgNs(partId: string): string {
  return 'p' + partId.replace(/[^A-Za-z0-9_-]/g, '_')
}

/** Strip width/height attributes off the root <svg> (the composer sizes it). */
export function stripSvgSize(svg: string): string {
  return svg
    .replace(/<svg([^>]*?)\swidth\s*=\s*"[^"]*"/i, '<svg$1')
    .replace(/<svg([^>]*?)\sheight\s*=\s*"[^"]*"/i, '<svg$1')
}

/**
 * Prepare a part's SVG for embedding as a NESTED <svg> element in a composed
 * scene: strip the XML prolog / doctype (illegal mid-document — they killed
 * the whole exported file's parse), and remove any root-level x/y/width/height
 * attributes (Fritzing exports carry x="0px" y="0px", which collided with the
 * composer's placement attributes → duplicate-attribute XML errors). The
 * root's viewBox is kept — it's what makes the injected width/height scale.
 */
export function prepareSvgForEmbed(svg: string): string {
  let s = svg
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .trim()
  const m = /<svg\b[^>]*>/i.exec(s)
  if (!m) return s
  let root = m[0]
  root = root
    .replace(/\s(?:x|y|width|height)\s*=\s*"[^"]*"/gi, '')
    .replace(/\s(?:x|y|width|height)\s*=\s*'[^']*'/gi, '')
  return s.slice(0, m.index) + root + s.slice(m.index + m[0].length)
}

/** Escape text for inclusion in generated SVG markup. */
export function escapeXml(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string
  )
}
