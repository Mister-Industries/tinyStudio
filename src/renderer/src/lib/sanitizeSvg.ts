/**
 * sanitizeSvg: clean SVG markup before it goes into the page.
 *
 * Part art comes from the tinyparts repo, pack indexes anyone can host, and
 * dropped .fzpz files, and the page it's inserted into can read and write the
 * user's project. DOMPurify's SVG profile keeps drawing markup (shapes,
 * gradients, filters, <style> blocks, ids) and strips scripts, event handlers,
 * <foreignObject> and script URLs.
 *
 * Sanitizing happens where markup is inserted, not when a part loads, so the
 * text transforms that run on part art (resistor bands, leg recolouring, symbol
 * normalisation) keep seeing the original markup. Results are cached, because
 * the canvas re-renders the same strings constantly.
 */

import DOMPurify from 'dompurify'

const MAX_CACHED = 400
const cache = new Map<string, string>()

export function sanitizeSvg(svg: string): string {
  // No DOM (node tests, workers): nothing is being inserted anywhere.
  if (!svg || !DOMPurify.isSupported) return svg
  const cached = cache.get(svg)
  if (cached !== undefined) return cached
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use']
  })
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(svg, clean)
  return clean
}
