/**
 * fold-variants — decide which parts get a tile in the palette and which hide
 * behind one. Shared by `split-parts-packs.mjs` (fresh import from
 * fritzing-parts) and `refold-parts.mjs` (re-pass over an already-published
 * tinyparts repo), so both produce byte-identical grouping.
 *
 * The problem
 * -----------
 * Fritzing ships one .fzp per *PCB package*, and the package is very often the
 * only thing that differs. SparkFun titles all sixteen of its inductors
 * "Inductors"; all thirteen of its ceramic caps "Capacitor"; all eighteen
 * electrolytics "Capacitor Polarized". tinyStudio has no PCB view, so those are
 * sixteen, thirteen and eighteen indistinguishable squares in the parts bin.
 *
 * The old rule fingerprinted each part on everything the app can render
 * (family, title, per-view w/h, pin coordinates, artwork) and folded exact
 * collisions. That caught `resistor` vs `SMD_resistor_0603` — same art, same
 * pins — but missed every case where the footprint also changed the part's
 * physical size, which is most of them. Hence "a ton of duplicates".
 *
 * The rule now
 * ------------
 * Group by (pack, family, base title) — the base title being the label with
 * the generated "(package)" suffix stripped back off. One tile per group.
 *
 *   sparkfun Inductor + "Inductors"                → 1 tile, 15 variants
 *   sparkfun Cap (Polarized) + "Capacitor Polarized" → 1 tile, 17 variants
 *   Capacitor [pp] + "Film/Foil Capacitor"         → 1 tile,  6 variants
 *
 * Grouping stays inside a pack: folding a SparkFun part behind a Core one
 * would make the SparkFun pack's tile count depend on what else is installed.
 *
 * The guard
 * ---------
 * Some Fritzing families lump together parts that are NOT interchangeable —
 * SparkFun files SPDT and DPDT switches under "Switch (SPST)", and the nine
 * 7-segment displays differ by common-anode vs common-cathode, which changes
 * what the pins do. Folding those would hide a real choice behind a tile that
 * lies about it. So before folding, each member's package string is scanned for
 * tokens that mark an electrical difference (see DISTINCT_TOKENS); members with
 * different token signatures are folded separately rather than together.
 *
 * Nothing is ever dropped
 * -----------------------
 * A variant keeps its own part file, keeps its "(package)" suffix in its label,
 * and stays loadable — a saved document referencing `smd-resistor-0603` still
 * resolves, and the palette's search reaches variants even though the bin grid
 * shows only primaries. Only the square goes away.
 */

/** "0603 [SMD]" → "0603" · "cr75_v2" → "cr75 v2" · "" → null */
export function packageLabel(def) {
  const p = def.properties || {}
  const raw = p.package || p['pin spacing'] || p.spacing || p.size || ''
  const short = String(raw).split(' [')[0].trim().replace(/_+/g, ' ')
  return short && short.toLowerCase() !== 'none' ? short : null
}

const normId = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/**
 * A label with any previously-generated "(package)" suffix removed.
 *
 * `split-parts-packs` disambiguates same-titled tiles by appending either the
 * package property or the part id's unique tail, so this reverses exactly those
 * two shapes and leaves genuine parentheses alone ("Resonator (2pin)",
 * "Rotary Potentiometer (Large)", "RGB LED - (4 legs)" all survive intact).
 */
export function baseTitle(def) {
  const m = /^(.*) \(([^()]*)\)$/.exec(def.label || '')
  if (!m) return def.label || ''
  const [, base, suffix] = m
  const pkg = packageLabel(def)
  if (pkg && pkg.toLowerCase() === suffix.toLowerCase()) return base
  if (normId(suffix) && normId(def.type).endsWith(normId(suffix))) return base
  return def.label
}

/**
 * Tokens in a package string that mean "this is not the same part". Polarity,
 * pin order, pole/throw count, gender and waveform all change behaviour, so
 * they must keep their own tile even when Fritzing files them under one family
 * and one title.
 */
const DISTINCT_TOKENS =
  /\b(an|anode|cat|cathode|npn|pnp|nmos|pmos|ebc|ecb|cbe|bce|bec|ceb|n-?ch(annel)?|p-?ch(annel)?|spst|spdt|dpst|dpdt|unipolar|bipolar|rgb|rbg|grb|brg|gbr|bgr|no|nc|male|female|pwm|sawtooth|square|triangular|sine|pulse|actuator|body)\b/g

/** The set of behaviour-changing tokens in a part's package string, as a
 * stable key. Two parts with different keys never fold together. */
function distinctKey(def) {
  const hay = `${packageLabel(def) || ''} ${def.type}`.toLowerCase().replace(/[_.]+/g, '-')
  const hits = new Set()
  for (const m of hay.matchAll(DISTINCT_TOKENS)) hits.add(m[1].replace(/-?ch(annel)?$/, 'ch'))
  return [...hits].sort().join('+')
}

/**
 * A part's connection surface: the pin names it offers, across every view.
 *
 * This is the hard half of the guard, and it's not a heuristic — connections in
 * a saved circuit are keyed by pin NAME, so two parts with different pin names
 * are not substitutable no matter how alike they look. It's what keeps the
 * 2-pin and 3-pin ceramic resonators (same family, both titled "Resonator")
 * from collapsing into one tile that can only be wired one of two ways.
 */
function pinKey(def) {
  const names = new Set()
  for (const view of Object.values(def.views || {})) {
    for (const pin of Object.keys(view?.pins || {})) names.add(pin)
  }
  return [...names].sort().join(',')
}

/**
 * Which part a human would call "the" part. In order: one Fritzing curated into
 * a bin, a through-hole package over an SMD one, then the tersest id — the last
 * being a decent proxy for "the generic one" (`resistor` beats
 * `smd-resistor-1206`).
 *
 * `inBin` is a predicate rather than a lookup so both callers can supply their
 * own notion of it (the fresh import has the .fzb data; the re-pass infers it
 * from the order the previous run assigned).
 */
function primaryScore(def, inBin) {
  const pkg = String((def.properties || {}).package || '').toLowerCase()
  const fzp = String((def.source || {}).fzp || '')
  return [
    inBin(def) ? 0 : 1,
    pkg.includes('smd') || pkg.includes('smt') ? 1 : 0,
    /^smd[-_]/i.test(fzp) || /^smd-/.test(def.type) ? 1 : 0,
    def.type.length
  ]
}

/**
 * Fold every group of same-(pack, family, base title) parts down to one tile.
 *
 * `entries` is [{ packId, def }]; defs are mutated in place — `label`,
 * `variantOf` and `variants` are all (re)assigned, so calling this on already
 * folded input re-derives the grouping from scratch rather than compounding it.
 *
 * Returns { tiles, variants, groups } for the caller's log.
 */
export function foldVariants(entries, { inBin = () => false } = {}) {
  // start from a clean slate so a re-pass is idempotent
  for (const { def } of entries) {
    def.label = baseTitle(def)
    delete def.variantOf
    delete def.variants
  }

  const groups = new Map()
  for (const { packId, def } of entries) {
    const key = [
      packId,
      (def.family || '').toLowerCase(),
      def.label.toLowerCase(),
      distinctKey(def),
      pinKey(def)
    ].join(' | ')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(def)
  }

  let folded = 0
  let foldedGroups = 0
  for (const group of groups.values()) {
    if (group.length < 2) continue
    group.sort((a, b) => {
      const x = primaryScore(a, inBin)
      const y = primaryScore(b, inBin)
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]
      return a.type.localeCompare(b.type)
    })
    const [primary, ...rest] = group
    primary.variants = rest.map((d) => ({ type: d.type, package: packageLabel(d) || d.type }))
    for (const d of rest) {
      d.variantOf = primary.type
      // a variant is only ever seen in search results and the primary's
      // "also available as" line, so it keeps the package in its name
      const pkg = packageLabel(d) || d.type
      d.label = `${d.label} (${pkg})`
      folded++
    }
    foldedGroups++
  }

  return {
    tiles: entries.length - folded,
    variants: folded,
    groups: foldedGroups
  }
}

/**
 * Last-resort disambiguation: two tiles in the same pack still showing the same
 * words. After folding this only happens across *families* (Fritzing's
 * "Capacitor [pp]" vs "Capacitor [unidirectional]") or across a distinct-token
 * split (common-anode vs common-cathode), and in both cases the difference is
 * exactly what the suffix needs to name.
 */
export function disambiguateLabels(entries) {
  const groups = new Map()
  for (const { packId, def } of entries) {
    if (def.variantOf) continue
    const key = packId + ' | ' + def.label.toLowerCase()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(def)
  }

  let relabelled = 0
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const suffixes = group.map((d) => packageLabel(d))
    const usable =
      suffixes.every(Boolean) && new Set(suffixes.map((s) => s.toLowerCase())).size === group.length
    const shared = sharedPrefixLength(group.map((d) => d.type))
    group.forEach((def, i) => {
      def.label = `${def.label} (${usable ? suffixes[i] : def.type.slice(shared) || def.type})`
      relabelled++
    })
  }
  return relabelled
}

function sharedPrefixLength(ids) {
  if (ids.length < 2) return 0
  let n = 0
  while (n < ids[0].length && ids.every((s) => s[n] === ids[0][n])) n++
  const cut = ids[0].slice(0, n).lastIndexOf('-')
  return cut > 0 ? cut + 1 : 0
}
