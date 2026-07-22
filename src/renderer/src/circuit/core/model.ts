/**
 * circuit/core/model — the Circuit View v2 document model.
 *
 * `circuit.json` v2 schema (docs/circuit-view-tech-spec.md §4), plus parsing,
 * validation, serialization and migration from v1 `diagram.json` / Wokwi files.
 *
 * ZERO React, ZERO Node — pure TypeScript usable in renderer, web build, workers
 * and unit tests alike.
 */

// ── geometry ─────────────────────────────────────────────────────────────────

export interface Pt {
  x: number
  y: number
}

export type ViewId = 'bb' | 'sch'

/** 0.1 in at 96 DPI — breadboard hole pitch and the base grid. */
export const GRID_BB = 9.6
/** Schematic fine grid (half pitch). */
export const GRID_SCH = 4.8

// ── document types ───────────────────────────────────────────────────────────

export interface Placement {
  x: number
  y: number
  rotate?: 0 | 90 | 180 | 270
  flip?: boolean
  /** Per-pin bendable-leg tip offsets (bb only), relative to the pin's rest position. */
  legs?: Record<string, [number, number]>
  /** Label anchor offset override. */
  labelOffset?: [number, number]
}

export interface CircuitPart {
  /** Reference designator — unique, user-visible (R1, LED2, U1…). */
  id: string
  /** PartDef type resolved through the parts registry. */
  type: string
  /** Typed properties declared by the part schema (value, color…). */
  attrs?: Record<string, string | number | boolean>
  /** Breadboard placement; absent ⇒ unplaced in bb view (tray). */
  bb?: Placement
  /** Schematic placement; absent ⇒ unplaced in sch view (tray). */
  sch?: Placement
}

/** A wire endpoint: a part pin, or a junction on another wire's body. */
export type WireEnd = string | JunctionEnd // "partId:pinName"
export interface JunctionEnd {
  /** Host wire id. */
  wire: string
  /** Parametric position along the host wire's rendered polyline, 0..1 by length. */
  t: number
}

export interface CircuitWire {
  /** Stable id (nanoid-8) — selection/route identity survives reorders (fixes B4). */
  id: string
  from: WireEnd
  to: WireEnd
  /** The single view this wire lives in. Nets are shared; wires are per-view. */
  view: ViewId
  /** Wokwi-style journey, source-anchored: h<px>, v<px>, d<dx>,<dy> (bb only). */
  route?: string[]
  /** bb only — schematic wires are always ink. */
  color?: string
  /** bb only — render as a curved jumper (route stays authoritative for geometry). */
  curve?: boolean
}

export type NetLabelKind = 'ground' | 'power' | 'net'
export interface NetLabel {
  id: string
  name: string
  kind: NetLabelKind
  sch: Placement
}

export type AnalysisKind = 'op' | 'dc' | 'tran' | 'ac'
export interface Analysis {
  id: string
  kind: AnalysisKind
  enabled?: boolean
  [k: string]: unknown
}
export interface Probe {
  id: string
  kind: 'voltage' | 'current' | 'diff'
  at: string
  label?: string
  color?: string
}

export interface PackRef {
  id: string
  version?: string
  url?: string
}

export interface CircuitDoc {
  format: 'tinystudio-circuit'
  version: 2
  meta?: { author?: string; created?: string; modified?: string }
  packs?: PackRef[]
  parts: CircuitPart[]
  wires: CircuitWire[]
  netLabels?: NetLabel[]
  sim?: { analyses?: Analysis[]; probes?: Probe[] }
  camera?: Partial<Record<ViewId, { x: number; y: number; zoom: number }>>
  /**
   * Round-trip bag: every top-level key we don't model is preserved verbatim
   * (fixes B3 — never destroy foreign data like Wokwi's serialMonitor).
   */
  extra?: Record<string, unknown>
}

// ── ids ──────────────────────────────────────────────────────────────────────

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** 8-char random id (no crypto dependency; collision space 36^8 ≈ 2.8e12). */
export function newId(prefix = ''): string {
  let s = ''
  for (let i = 0; i < 8; i++) s += ID_ALPHABET[(Math.random() * ID_ALPHABET.length) | 0]
  return prefix ? `${prefix}_${s}` : s
}

export function isJunction(end: WireEnd): end is JunctionEnd {
  return typeof end === 'object' && end !== null && 'wire' in end
}

/**
 * A v1-migrated junction endpoint the editor hasn't geometrically resolved
 * yet: carries the original raw coordinate; `wire` is '' and `t` is -1 until
 * the first render (where pin geometry exists) rewrites it to a real
 * `{wire, t}` — see migrateV1 pass 2.
 */
export interface PendingJunctionEnd extends JunctionEnd {
  x: number
  y: number
}
export function isPendingJunction(end: WireEnd): end is PendingJunctionEnd {
  return isJunction(end) && end.wire === '' && (end as PendingJunctionEnd).x !== undefined
}

/** Split a "partId:pinName" pin ref. Pin names may contain ':'? No — first colon splits. */
export function splitPinRef(ref: string): { part: string; pin: string } {
  const i = ref.indexOf(':')
  return { part: ref.slice(0, i), pin: ref.slice(i + 1) }
}

// ── construction / validation ────────────────────────────────────────────────

export function emptyDoc(author?: string): CircuitDoc {
  return {
    format: 'tinystudio-circuit',
    version: 2,
    meta: { author, created: new Date().toISOString() },
    parts: [],
    wires: []
  }
}

const KNOWN_KEYS = new Set([
  'format',
  'version',
  'meta',
  'packs',
  'parts',
  'wires',
  'netLabels',
  'sim',
  'camera'
])

export interface ParseResult {
  doc: CircuitDoc
  /** True when the input was a v1/Wokwi file and got migrated. */
  migrated: boolean
  warnings: string[]
}

/**
 * Parse any supported circuit file text: v2 native, tinyStudio v1 diagram.json,
 * or a Wokwi diagram.json. Never throws on bad input — returns an empty doc
 * with warnings instead (the editor must always mount).
 */
export function parseCircuitFile(text: string): ParseResult {
  const warnings: string[] = []
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text || '{}')
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object')
  } catch (e) {
    return {
      doc: emptyDoc(),
      migrated: false,
      warnings: [`Unparseable circuit file (${(e as Error).message}); starting empty.`]
    }
  }

  if (raw.format === 'tinystudio-circuit' && raw.version === 2) {
    return { doc: normalizeV2(raw, warnings), migrated: false, warnings }
  }
  // v1 tinyStudio & plain Wokwi both look like { version: 1, parts, connections }
  if (Array.isArray(raw.parts) && Array.isArray(raw.connections)) {
    return { doc: migrateV1(raw, warnings), migrated: true, warnings }
  }
  if (Array.isArray(raw.parts) || Array.isArray(raw.wires)) {
    // half-formed v2-ish content — salvage what we can
    return { doc: normalizeV2({ format: 'tinystudio-circuit', version: 2, ...raw }, warnings), migrated: false, warnings }
  }
  return { doc: emptyDoc(), migrated: false, warnings: ['Unknown circuit file shape; starting empty.'] }
}

function normalizeV2(raw: Record<string, unknown>, warnings: string[]): CircuitDoc {
  const doc = emptyDoc()
  doc.meta = (raw.meta as CircuitDoc['meta']) ?? doc.meta
  doc.packs = raw.packs as PackRef[] | undefined
  doc.netLabels = raw.netLabels as NetLabel[] | undefined
  doc.sim = raw.sim as CircuitDoc['sim']
  doc.camera = raw.camera as CircuitDoc['camera']

  const seenPart = new Set<string>()
  for (const p of (raw.parts as unknown[]) ?? []) {
    const part = p as CircuitPart
    if (!part || typeof part.id !== 'string' || typeof part.type !== 'string') {
      warnings.push('Dropped malformed part entry.')
      continue
    }
    if (seenPart.has(part.id)) {
      warnings.push(`Duplicate part id "${part.id}" — dropped duplicate.`)
      continue
    }
    seenPart.add(part.id)
    doc.parts.push(part)
  }

  const seenWire = new Set<string>()
  for (const w of (raw.wires as unknown[]) ?? []) {
    const wire = w as CircuitWire
    if (!wire || !wire.from || !wire.to || (wire.view !== 'bb' && wire.view !== 'sch')) {
      warnings.push('Dropped malformed wire entry.')
      continue
    }
    if (!wire.id || seenWire.has(wire.id)) wire.id = newId('w')
    seenWire.add(wire.id)
    doc.wires.push(wire)
  }

  // Preserve unknown top-level keys verbatim (B3).
  for (const k of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(k)) {
      doc.extra = doc.extra || {}
      doc.extra[k] = raw[k]
    }
  }
  return doc
}

// ── v1 / Wokwi migration ─────────────────────────────────────────────────────

type V1Conn = [unknown, unknown, string?, string[]?]

/**
 * Migrate a tinyStudio v1 `diagram.json` or a plain Wokwi diagram into v2.
 *  - parts left/top → bb placement; v1 `schematic.pos` → sch placement
 *  - connections → bb wires; v1 `schematic.routes` → sch wires (same endpoints)
 *  - free {x,y} junction endpoints → resolved to {wire,t} against the *already
 *    migrated* wires where possible (B9); else dropped with a warning
 *  - part ids kept (they become refdes-ish; a later renumber can clean up)
 *  - Wokwi extras (serialMonitor, dependencies…) preserved in `extra`
 */
function migrateV1(raw: Record<string, unknown>, warnings: string[]): CircuitDoc {
  const doc = emptyDoc(typeof raw.author === 'string' ? raw.author : undefined)
  const sch = (raw.schematic as { pos?: Record<string, [number, number]>; routes?: Record<string, string[]> }) || {}

  for (const p of (raw.parts as Record<string, unknown>[]) ?? []) {
    if (!p || p.id == null || p.type == null) continue
    const part: CircuitPart = {
      id: String(p.id),
      type: String(p.type),
      bb: {
        x: Number(p.left ?? p.x ?? 0),
        y: Number(p.top ?? p.y ?? 0),
        ...(p.rotate ? { rotate: (((Number(p.rotate) % 360) + 360) % 360) as 0 | 90 | 180 | 270 } : {})
      }
    }
    const attrs = p.attrs as Record<string, string | number | boolean> | undefined
    if (attrs && Object.keys(attrs).length) {
      const { labelOffset, ...rest } = attrs as Record<string, unknown>
      if (Array.isArray(labelOffset) && part.bb) part.bb.labelOffset = labelOffset as [number, number]
      if (Object.keys(rest).length) part.attrs = rest as Record<string, string | number | boolean>
    }
    const sp = sch.pos?.[part.id]
    if (sp) part.sch = { x: sp[0], y: sp[1] }
    doc.parts.push(part)
  }

  // Pass 1: pin-to-pin wires (junction resolution needs these to exist first).
  interface Pending {
    conn: V1Conn
    key: string
  }
  const pending: Pending[] = []
  const refStr = (r: unknown): string =>
    typeof r === 'string' ? r : `${(r as Pt).x},${(r as Pt).y}`

  for (const c of (raw.connections as V1Conn[]) ?? []) {
    if (!Array.isArray(c) || c.length < 2) continue
    const key = `${refStr(c[0])}>${refStr(c[1])}`
    if (typeof c[0] === 'string' && typeof c[1] === 'string') {
      doc.wires.push({
        id: newId('w'),
        from: c[0],
        to: c[1],
        view: 'bb',
        color: typeof c[2] === 'string' ? c[2] : undefined,
        route: normalizeJourney(c[3])
      })
      const schRoute = sch.routes?.[key]
      if (schRoute) {
        doc.wires.push({ id: newId('w'), from: c[0], to: c[1], view: 'sch', route: schRoute.slice() })
      }
    } else {
      pending.push({ conn: c, key })
    }
  }

  // Pass 2: junction endpoints. v1 stored a bare {x,y}; we cannot geometrically
  // resolve it here without part pin positions (registry lives above core), so
  // we keep the coordinate as a *pending junction* the editor resolves on first
  // render (it has geometry there). Encoded as { wire: '', t: -1, x, y } via extra.
  for (const { conn } of pending) {
    const [a, b, color, route] = conn
    const fix = (r: unknown): WireEnd | null => {
      if (typeof r === 'string') return r
      if (r && typeof r === 'object' && 'x' in (r as Pt))
        return { wire: '', t: -1, ...(r as Pt) } as unknown as JunctionEnd
      return null
    }
    const from = fix(a)
    const to = fix(b)
    if (!from || !to) {
      warnings.push('Dropped a v1 connection with unusable endpoints.')
      continue
    }
    doc.wires.push({
      id: newId('w'),
      from,
      to,
      view: 'bb',
      color: typeof color === 'string' ? color : undefined,
      route: normalizeJourney(route)
    })
    warnings.push('A junction endpoint was migrated as a pending junction (resolved on first render).')
  }

  // Preserve Wokwi/foreign keys.
  for (const k of Object.keys(raw)) {
    if (!['version', 'editor', 'author', 'parts', 'connections', 'schematic'].includes(k)) {
      doc.extra = doc.extra || {}
      doc.extra[k] = raw[k]
    }
  }
  return doc
}

/**
 * Normalize a Wokwi journey to source-anchored form (fixes B2).
 * Wokwi: instructions before "*" run from the source; instructions after "*"
 * run from the TARGET in reverse order. We fold both halves into a single
 * source-anchored list by keeping the source half; the target half becomes a
 * `@` marker consumed by routing.decodeJourney (which needs live endpoints to
 * finish the fold). To stay dependency-free here we keep the raw list and let
 * routing handle "*" — this function only trims garbage.
 */
export function normalizeJourney(route: unknown): string[] | undefined {
  if (!Array.isArray(route)) return undefined
  const out = route.filter(
    (s) => typeof s === 'string' && (/^[hv]-?[\d.]+$/.test(s) || /^d-?[\d.]+,-?[\d.]+$/.test(s) || s === '*')
  ) as string[]
  return out.length ? out : undefined
}

// ── serialization ────────────────────────────────────────────────────────────

/** Stable-ordered serializer: same input ⇒ same text ⇒ clean git diffs. */
export function serializeDoc(doc: CircuitDoc): string {
  const out: Record<string, unknown> = {
    format: doc.format,
    version: doc.version,
    ...(doc.meta ? { meta: doc.meta } : {}),
    ...(doc.packs?.length ? { packs: doc.packs } : {}),
    parts: doc.parts.map(serializePart),
    wires: doc.wires.map(serializeWire),
    ...(doc.netLabels?.length ? { netLabels: doc.netLabels } : {}),
    ...(doc.sim && (doc.sim.analyses?.length || doc.sim.probes?.length) ? { sim: doc.sim } : {}),
    ...(doc.camera ? { camera: doc.camera } : {}),
    ...(doc.extra || {})
  }
  return JSON.stringify(out, null, 2) + '\n'
}

function serializePart(p: CircuitPart): Record<string, unknown> {
  return {
    id: p.id,
    type: p.type,
    ...(p.attrs && Object.keys(p.attrs).length ? { attrs: p.attrs } : {}),
    ...(p.bb ? { bb: serializePlacement(p.bb) } : {}),
    ...(p.sch ? { sch: serializePlacement(p.sch) } : {})
  }
}

function serializePlacement(pl: Placement): Record<string, unknown> {
  return {
    x: round2(pl.x),
    y: round2(pl.y),
    ...(pl.rotate ? { rotate: pl.rotate } : {}),
    ...(pl.flip ? { flip: true } : {}),
    ...(pl.legs && Object.keys(pl.legs).length ? { legs: pl.legs } : {}),
    ...(pl.labelOffset ? { labelOffset: pl.labelOffset } : {})
  }
}

function serializeWire(w: CircuitWire): Record<string, unknown> {
  return {
    id: w.id,
    from: w.from,
    to: w.to,
    view: w.view,
    ...(w.color ? { color: w.color } : {}),
    ...(w.route?.length ? { route: w.route } : {}),
    ...(w.curve ? { curve: true } : {})
  }
}

export const round2 = (n: number): number => Math.round(n * 100) / 100

// ── queries (pure helpers used by store/commands/views) ──────────────────────

export function partById(doc: CircuitDoc, id: string): CircuitPart | undefined {
  return doc.parts.find((p) => p.id === id)
}
export function wireById(doc: CircuitDoc, id: string): CircuitWire | undefined {
  return doc.wires.find((w) => w.id === id)
}
export function wiresInView(doc: CircuitDoc, view: ViewId): CircuitWire[] {
  return doc.wires.filter((w) => w.view === view)
}
/** All wires touching a part (either endpoint is one of its pins), per view. */
export function wiresTouchingPart(doc: CircuitDoc, partId: string, view?: ViewId): CircuitWire[] {
  return doc.wires.filter((w) => {
    if (view && w.view !== view) return false
    const hit = (e: WireEnd): boolean => typeof e === 'string' && splitPinRef(e).part === partId
    return hit(w.from) || hit(w.to)
  })
}
/** Wires whose junction endpoint rides on the given wire. */
export function junctionRiders(doc: CircuitDoc, hostWireId: string): CircuitWire[] {
  return doc.wires.filter(
    (w) =>
      (isJunction(w.from) && w.from.wire === hostWireId) ||
      (isJunction(w.to) && w.to.wire === hostWireId)
  )
}
