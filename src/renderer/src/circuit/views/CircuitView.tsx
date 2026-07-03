/**
 * circuit/views/CircuitView — the v2 Circuit View shell (M0: read-only preview).
 *
 * M0 scope: prove the core end-to-end inside the real IDE window slot —
 * parse (with v1/Wokwi migration) → store → net model → render parts + wires
 * on the tinyStudio dot-grid canvas with fit/zoom/pan. NO editing yet (M1).
 * Part visuals come from the existing partsLibrary as a temporary adapter
 * until the v2 parts registry lands (M2).
 *
 * Mounted by EditorPanel behind the `tinystudio.circuitV2` flag, in the same
 * window space the legacy DiagramEditor occupies — desktop and web builds.
 */

import { CircuitBoard, Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import React from 'react'
import { ensureParts, getPart, viewFor } from '../../lib/partsLibrary'
import {
  isJunction,
  splitPinRef,
  type CircuitDoc,
  type CircuitWire,
  type Pt,
  type WireEnd
} from '../core/model'
import { pinWorld } from '../core/geometry'
import { buildNets } from '../core/nets'
import { pointAtT, wirePoints } from '../core/routing'
import { CircuitStore } from '../core/store'

const WIRE_W = 2.8
const WIRE_OUTLINE_W = WIRE_W + 1.8

function darken(hex: string, f = 0.55): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return 'rgba(0,0,0,0.45)'
  const n = parseInt(m[1], 16)
  return `rgb(${Math.round(((n >> 16) & 255) * f)}, ${Math.round(((n >> 8) & 255) * f)}, ${Math.round((n & 255) * f)})`
}

function roundedPath(points: Pt[], r = 4): string {
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

/** Resolve a wire endpoint to a world point using the legacy parts adapter. */
function makeResolver(doc: CircuitDoc): (end: WireEnd, seen?: Set<string>) => Pt | null {
  const wireById = new Map(doc.wires.map((w) => [w.id, w]))
  const resolve = (end: WireEnd, seen: Set<string> = new Set()): Pt | null => {
    if (isJunction(end)) {
      // pending v1-migrated junction carries raw coords
      const raw = end as unknown as { x?: number; y?: number; wire: string; t: number }
      if (end.wire === '' && raw.x !== undefined) return { x: raw.x!, y: raw.y! }
      if (seen.has(end.wire)) return null
      seen.add(end.wire)
      const host = wireById.get(end.wire)
      if (!host) return null
      const pts = resolveWire(host, seen)
      return pts ? pointAtT(pts, end.t) : null
    }
    const { part: partId, pin } = splitPinRef(end)
    const part = doc.parts.find((p) => p.id === partId)
    if (!part?.bb) return null
    const def = getPart(part.type)
    const v = def && viewFor(def, 'breadboard')
    const local = v?.pins[pin]
    if (!v || !local) return null
    return pinWorld(local, part.bb, v.w, v.h, part.bb.legs?.[pin])
  }
  const resolveWire = (w: CircuitWire, seen: Set<string>): Pt[] | null => {
    const s = resolve(w.from, seen)
    const t = resolve(w.to, seen)
    if (!s || !t) return null
    return wirePoints(s, t, w.route)
  }
  return resolve
}

export function CircuitViewV2({ content }: { content: string }): React.JSX.Element {
  const [{ store, migrated, warnings }] = React.useState(() => CircuitStore.fromFile(content))
  const revision = React.useSyncExternalStore(store.subscribe, store.getRevision)
  const doc = store.getDoc()
  const [, force] = React.useReducer((n: number) => n + 1, 0)
  const [cam, setCam] = React.useState({ scale: 1, tx: 40, ty: 40 })
  const viewRef = React.useRef<HTMLDivElement>(null)
  const pan = React.useRef<Pt | null>(null)
  const didFit = React.useRef(false)

  // adopt external content changes (Code tab)
  React.useEffect(() => {
    store.replaceFromFile(content)
  }, [content, store])

  // lazy-load part defs through the legacy adapter
  React.useEffect(() => {
    const missing = doc.parts.map((p) => p.type).filter((t) => !getPart(t))
    if (missing.length) ensureParts(missing).then(force)
  }, [doc.parts])

  const resolve = React.useMemo(() => makeResolver(doc), [doc, revision])
  const nets = React.useMemo(() => buildNets(doc), [doc])

  const wireGeom = React.useMemo(() => {
    return doc.wires
      .filter((w) => w.view === 'bb')
      .map((w) => {
        const s = resolve(w.from)
        const t = resolve(w.to)
        return { w, pts: s && t ? wirePoints(s, t, w.route) : [] }
      })
  }, [doc, resolve])

  const fit = React.useCallback((): void => {
    const el = viewRef.current
    if (!el) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const part of doc.parts) {
      if (!part.bb) continue
      const def = getPart(part.type)
      const v = def && viewFor(def, 'breadboard')
      if (!v) continue
      minX = Math.min(minX, part.bb.x)
      minY = Math.min(minY, part.bb.y)
      maxX = Math.max(maxX, part.bb.x + v.w)
      maxY = Math.max(maxY, part.bb.y + v.h)
    }
    for (const { pts } of wireGeom)
      for (const p of pts) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
    if (!isFinite(minX)) return
    const pad = 48
    const bw = maxX - minX + pad * 2
    const bh = maxY - minY + pad * 2
    const f = Math.max(0.25, Math.min(3, Math.min(el.clientWidth / bw, el.clientHeight / bh)))
    setCam({
      scale: f,
      tx: (el.clientWidth - bw * f) / 2 - (minX - pad) * f,
      ty: (el.clientHeight - bh * f) / 2 - (minY - pad) * f
    })
  }, [doc, wireGeom])

  React.useEffect(() => {
    if (didFit.current) return
    if (doc.parts.length === 0 || doc.parts.every((p) => getPart(p.type))) {
      fit()
      didFit.current = true
    }
  })

  const zoomAt = (factor: number, sx: number, sy: number): void =>
    setCam((c) => {
      const ns = Math.max(0.25, Math.min(3, c.scale * factor))
      const k = ns / c.scale
      return { scale: ns, tx: sx - (sx - c.tx) * k, ty: sy - (sy - c.ty) * k }
    })

  const tool =
    'tactile-bordered h-8 px-2.5 flex items-center gap-1.5 rounded-md bg-surface-card text-text-muted text-xs hover:text-text-body active:translate-y-px'

  return (
    <div className="size-full relative overflow-hidden bg-bg-sunken">
      {/* v2 badge + status */}
      <div className="absolute top-3 left-3 z-10 flex gap-1.5 items-center">
        <span className="px-2.5 py-1 rounded-full bg-surface-card border border-brand/40 text-brand text-[11px] font-semibold">
          Circuit v2 preview
        </span>
        {migrated && (
          <span className="px-2.5 py-1 rounded-full bg-surface-card border border-border-default text-text-muted text-[11px]">
            migrated from diagram.json (in memory)
          </span>
        )}
      </div>
      <div className="absolute bottom-3 right-3.5 z-10 flex gap-1.5">
        <button className={`${tool} w-8 justify-center px-0`} onClick={() => {
          const el = viewRef.current
          if (el) zoomAt(1 / 1.15, el.clientWidth / 2, el.clientHeight / 2)
        }} title="Zoom out">
          <ZoomOut size={15} />
        </button>
        <span className={`${tool} pointer-events-none min-w-[52px] justify-center`}>
          {Math.round(cam.scale * 100)}%
        </span>
        <button className={`${tool} w-8 justify-center px-0`} onClick={() => {
          const el = viewRef.current
          if (el) zoomAt(1.15, el.clientWidth / 2, el.clientHeight / 2)
        }} title="Zoom in">
          <ZoomIn size={15} />
        </button>
        <button className={`${tool} w-8 justify-center px-0`} onClick={fit} title="Fit to view">
          <Maximize size={15} />
        </button>
      </div>
      <div className="absolute bottom-3 left-3 z-10 flex gap-2 text-[11px]">
        <span className="px-2.5 py-1 rounded-full bg-surface-card border border-border-default text-text-body">
          Parts: {doc.parts.length} · Wires: {doc.wires.length} · Nets: {nets.meaningful}
        </span>
        {warnings.length > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-surface-card border border-status-warning/40 text-status-warning" title={warnings.join('\n')}>
            {warnings.length} migration note{warnings.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div
        ref={viewRef}
        className="size-full"
        style={{
          touchAction: 'none',
          backgroundImage: 'radial-gradient(var(--dot-color) 1.1px, transparent 1.1px)',
          backgroundSize: `${9.6 * cam.scale}px ${9.6 * cam.scale}px`,
          backgroundPosition: `${cam.tx}px ${cam.ty}px`
        }}
        onWheel={(e) => {
          const r = viewRef.current!.getBoundingClientRect()
          zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top)
        }}
        onPointerDown={(e) => {
          if (e.button !== 1 && !(e.button === 0 && e.altKey) && e.button !== 0) return
          pan.current = { x: e.clientX, y: e.clientY }
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const p = pan.current
          if (!p) return
          setCam((c) => ({ ...c, tx: c.tx + (e.clientX - p.x), ty: c.ty + (e.clientY - p.y) }))
          pan.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={() => (pan.current = null)}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.scale})`,
            transformOrigin: '0 0'
          }}
        >
          {/* parts */}
          {doc.parts.map((part) => {
            if (!part.bb) return null
            const def = getPart(part.type)
            const v = def && viewFor(def, 'breadboard')
            if (!v) {
              return (
                <div
                  key={part.id}
                  style={{ position: 'absolute', left: part.bb.x, top: part.bb.y }}
                  className="px-2 py-1 rounded bg-surface-card border border-border-default text-[10px] text-text-faint"
                >
                  {part.type}…
                </div>
              )
            }
            return (
              <div
                key={part.id}
                style={{
                  position: 'absolute',
                  left: part.bb.x,
                  top: part.bb.y,
                  width: v.w,
                  height: v.h,
                  transform: part.bb.rotate ? `rotate(${part.bb.rotate}deg)` : undefined,
                  transformOrigin: 'center'
                }}
              >
                <div
                  className="size-full [&>svg]:size-full [&>svg]:block pointer-events-none select-none"
                  dangerouslySetInnerHTML={{ __html: v.svg }}
                />
                <div
                  className="absolute text-[11px] whitespace-nowrap select-none text-text-muted"
                  style={{ left: 0, top: v.h + 4 }}
                >
                  {part.id}
                </div>
              </div>
            )
          })}

          {/* wires */}
          <svg style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
            {wireGeom.map(({ w, pts }) => {
              if (pts.length < 2) return null
              const core = w.color || '#2fa46a'
              const d = roundedPath(pts)
              return (
                <g key={w.id}>
                  <path d={d} fill="none" stroke={darken(core)} strokeWidth={WIRE_OUTLINE_W} strokeLinejoin="round" strokeLinecap="round" />
                  <path d={d} fill="none" stroke={core} strokeWidth={WIRE_W} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              )
            })}
            {/* junction dots */}
            {doc.wires.flatMap((w) =>
              [w.from, w.to]
                .filter(isJunction)
                .map((j, i) => {
                  const p = resolve(j)
                  return p ? <circle key={`${w.id}j${i}`} cx={p.x} cy={p.y} r={3} fill={w.color || 'var(--text-strong)'} /> : null
                })
            )}
          </svg>

          {doc.parts.length === 0 && (
            <div className="absolute flex flex-col items-center gap-2 text-text-faint text-sm text-center" style={{ left: 200, top: 160, width: 320 }}>
              <CircuitBoard size={42} />
              <div>Circuit v2 — empty document. Editing lands in M1.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
