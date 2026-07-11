/**
 * circuit/views/canvas/Canvas — the interactive breadboard scene (M1).
 *
 * Owns: camera (zoom/pan/fit), pointer routing, selection + marquee, wire
 * drawing/editing state machines, part drag with frozen-bend reroutes, and
 * rendering (parts, glossy-tube wires, junction dots, handles, preview).
 * The gesture set is a 1:1 port of DiagramEditor's editor behaviors, re-said
 * as Commands against the CircuitStore — same editor, now with undo.
 *
 * Document mutations ONLY go through store.dispatch(command). Ephemeral state
 * (camera, hover, armed wire, marquee, edit buffer) never touches the doc.
 */

import { CircuitBoard, Zap } from 'lucide-react'
import React from 'react'
import { buildClipboard, materializePaste, parseClipboard } from '../../core/clipboard'
import * as cmd from '../../core/commands'
import {
  GRID_BB,
  GRID_SCH,
  isJunction,
  isPendingJunction,
  type CircuitDoc,
  type NetLabelKind,
  type Placement,
  type Pt,
  type ViewId,
  type WireEnd
} from '../../core/model'
import { describeNet, type NetModel } from '../../core/nets'
import { isBreadboard } from '../../parts/breadboard'
import { netLabelVisualOf, snapNetLabel } from '../../parts/netLabels'
import {
  calculateOrthogonalPath,
  clampOntoSegment,
  dragSegment,
  hitWire,
  isStraightRoute,
  journeyFromPoints,
  simplifyWirePoints,
  tAtPoint,
  vertexDrag,
  type WireHit
} from '../../core/routing'
import type { CircuitStore } from '../../core/store'
import {
  collectFrozen,
  freePasteOffset,
  holeAt,
  makeEndResolver,
  pinAtWorld,
  reroutesFor,
  rotateBoardAssemblyCmd,
  rotateNetLabelCmd,
  seatedPartsOn,
  snapBB,
  viewBounds,
  visualFor,
  wireGeometry,
  type FrozenWire,
  type RatsnestSegment,
  type Seat
} from '../partsAdapter'

// wire look (identical to DiagramEditor / tinySchematic)
const WIRE_W = 2.8
const WIRE_SCH_W = 1 // schematic ink: thin single stroke (no outline/glow)
const WIRE_OUTLINE_W = WIRE_W + 1.8
const WIRE_GLOW_W = WIRE_W + 5
const WIRE_CORNER = 4
const NET_GLOW = 'rgba(243, 203, 0, 0.30)'

export interface Selection {
  parts: Set<string>
  wires: Set<string>
  /** selected net-label ids (schematic) */
  labels?: Set<string>
}
export const emptySel = (): Selection => ({
  parts: new Set(),
  wires: new Set(),
  labels: new Set()
})

export interface Cam {
  scale: number
  tx: number
  ty: number
}

export interface CanvasHandle {
  fit: () => void
  zoomCenter: (factor: number) => void
  /** World coordinate at the viewport centre (palette double-click drops). */
  centerWorld: () => Pt
}

type HandleKind = 'vertex' | 'edge' | 'endpoint'

interface Armed {
  from: string // "part:pin" — drawing always starts on a pin
  points: Pt[]
  straight: boolean
}

function darken(hex: string, f = 0.55): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return 'rgba(0,0,0,0.45)'
  const n = parseInt(m[1], 16)
  return `rgb(${Math.round(((n >> 16) & 255) * f)}, ${Math.round(((n >> 8) & 255) * f)}, ${Math.round((n & 255) * f)})`
}

function roundedPath(points: Pt[], r = WIRE_CORNER): string {
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

export function Canvas({
  store,
  doc,
  view,
  editable,
  grid,
  sel,
  setSel,
  wireColor,
  netModel,
  seats,
  rats,
  defsTick,
  cam,
  setCam,
  handleRef,
  onDropPart,
  onDropNetLabel,
  onRequestEdit
}: {
  store: CircuitStore
  doc: CircuitDoc
  view: ViewId
  editable: boolean
  grid: boolean
  sel: Selection
  setSel: (s: Selection) => void
  wireColor: string
  netModel: NetModel
  /** derived breadboard seating (drop-to-connect), for seat marks + sticky */
  seats: Seat[]
  /** unrouted-in-this-view net bridges (dashed guidance lines) */
  rats: RatsnestSegment[]
  /** bumps when lazy part defs finish loading (geometry depends on them) */
  defsTick: number
  cam: Cam
  setCam: React.Dispatch<React.SetStateAction<Cam>>
  handleRef: React.Ref<CanvasHandle>
  onDropPart: (type: string, at: Pt) => void
  onDropNetLabel: (kind: NetLabelKind, name: string, at: Pt) => void
  /** tray "attach to cursor" placement: id being placed + drop callback */
  /** double-clicking a component asks the shell to enter edit mode */
  onRequestEdit: () => void
}): React.JSX.Element {
  const scale = cam.scale
  // schematic wires bend on the fine grid; parts still snap pins to major
  const wireGrid = view === 'sch' ? GRID_SCH : GRID_BB
  const snap = (v: number): number => Math.round(v / wireGrid) * wireGrid
  const ink = 'var(--text-strong)'
  const viewRef = React.useRef<HTMLDivElement>(null)
  const innerRef = React.useRef<HTMLDivElement>(null)

  const [armed, setArmed] = React.useState<Armed | null>(null)
  const [straight, setStraight] = React.useState(false)
  const [hoverPin, setHoverPin] = React.useState<{ id: string; pin: string } | null>(null)
  const [hoverHole, setHoverHole] = React.useState<{ id: string; pin: string; pos: Pt } | null>(
    null
  )
  const [hoverWire, setHoverWire] = React.useState<string | null>(null)
  const [mouse, setMouse] = React.useState<Pt>({ x: 0, y: 0 })
  const [editPts, setEditPts] = React.useState<Pt[] | null>(null)
  const [marquee, setMarquee] = React.useState<{ a: Pt; b: Pt } | null>(null)
  // live placement overrides while a part drag is in flight (render source)
  const [dragOverrides, setDragOverrides] = React.useState<Map<string, Placement> | null>(null)

  const pan = React.useRef<Pt | null>(null)
  const partDrag = React.useRef<{
    ids: string[]
    grabbed: string
    offX: number
    offY: number
    orig: Map<string, Placement>
    frozen: FrozenWire[]
    /** set once the pointer actually displaces — distinguishes board-hole clicks */
    moved: boolean
  } | null>(null)
  const handleDrag = React.useRef<{ kind: HandleKind } | null>(null)
  const labelDrag = React.useRef<{ id: string; ox: number; oy: number } | null>(null)
  const netLabelDrag = React.useRef<{
    id: string
    offX: number
    offY: number
    frozen: FrozenWire[]
    moved: boolean
  } | null>(null)
  const suppressClick = React.useRef(false)

  // ── geometry ────────────────────────────────────────────────────────────────

  const resolve = React.useMemo(
    () => makeEndResolver(doc, dragOverrides ?? undefined, view),
    [doc, dragOverrides, defsTick, view]
  )
  const wireGeom = React.useMemo(
    () => wireGeometry(doc, view, dragOverrides ?? undefined),
    [doc, dragOverrides, defsTick, view]
  )
  const geomForHit = React.useMemo(
    () => wireGeom.filter((g) => g.pts.length >= 2).map((g) => ({ id: g.w.id, points: g.pts })),
    [wireGeom]
  )

  const canvasPoint = (e: { clientX: number; clientY: number }): Pt => {
    const r = innerRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }
  }
  const placementOf = (id: string): Placement | undefined =>
    dragOverrides?.get(id) ?? doc.parts.find((p) => p.id === id)?.[view]

  // selected wire edit buffer stays in sync with the doc (undo, external edits)
  const soloWire = sel.wires.size === 1 && sel.parts.size === 0 ? [...sel.wires][0] : null
  React.useEffect(() => {
    if (handleDrag.current) return
    if (!soloWire) {
      setEditPts(null)
      return
    }
    const g = wireGeom.find((x) => x.w.id === soloWire)
    setEditPts(g && g.pts.length >= 2 ? g.pts : null)
  }, [soloWire, wireGeom])

  // resolve v1-migrated *pending junctions* once geometry exists (M0 gap)
  const pendingDone = React.useRef(false)
  React.useEffect(() => {
    if (view !== 'bb') return // v1 migration produced bb wires only
    if (pendingDone.current) return
    const pending = doc.wires.filter((w) => isPendingJunction(w.from) || isPendingJunction(w.to))
    if (pending.length === 0) {
      pendingDone.current = true
      return
    }
    if (doc.parts.some((p) => p.bb && !visualFor(p.type, 'bb'))) return // defs still loading
    const fixes: cmd.Command[] = []
    for (const w of pending) {
      const fix = (end: WireEnd): WireEnd => {
        if (!isPendingJunction(end)) return end
        const others = geomForHit.filter((g) => g.id !== w.id)
        const hit = hitWire(end.x, end.y, others, 0.75) // 8 world px tolerance
        if (!hit) return end // stays pending; renders at its raw coordinate
        const host = others.find((g) => g.id === hit.id)!
        return { wire: hit.id, t: tAtPoint(host.points, { x: end.x, y: end.y }) }
      }
      const from = fix(w.from)
      const to = fix(w.to)
      if (from !== w.from || to !== w.to) fixes.push(cmd.setWireEnds(w.id, from, to))
    }
    pendingDone.current = true
    if (fixes.length) store.dispatch(cmd.composite('Resolve migrated junctions', fixes))
  }, [doc, geomForHit, store, defsTick])

  // ── net highlight ───────────────────────────────────────────────────────────

  const highlightNet = React.useMemo(() => {
    if (hoverPin) {
      const i = netModel.pinToNet.get(`${hoverPin.id}:${hoverPin.pin}`)
      if (i != null) return i
    }
    const wid = hoverWire ?? soloWire
    if (wid != null) {
      const i = netModel.wireToNet.get(wid)
      if (i != null) return i
    }
    return -1
  }, [hoverPin, hoverWire, soloWire, netModel])

  // ── camera ──────────────────────────────────────────────────────────────────

  const fit = React.useCallback((): void => {
    const el = viewRef.current
    if (!el) return
    const b = viewBounds(doc, view)
    if (!b) return
    const pad = 48
    const bw = b.maxX - b.minX + pad * 2
    const bh = b.maxY - b.minY + pad * 2
    const f = Math.max(0.25, Math.min(3, Math.min(el.clientWidth / bw, el.clientHeight / bh)))
    setCam({
      scale: f,
      tx: (el.clientWidth - bw * f) / 2 - (b.minX - pad) * f,
      ty: (el.clientHeight - bh * f) / 2 - (b.minY - pad) * f
    })
  }, [doc, setCam, view])

  const zoomAt = (factor: number, sx: number, sy: number): void =>
    setCam((c) => {
      const ns = Math.max(0.25, Math.min(3, c.scale * factor))
      const k = ns / c.scale
      return { scale: ns, tx: sx - (sx - c.tx) * k, ty: sy - (sy - c.ty) * k }
    })

  React.useImperativeHandle(
    handleRef,
    () => ({
      fit,
      zoomCenter: (factor: number) => {
        const el = viewRef.current
        if (el) zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2)
      },
      centerWorld: () => {
        const el = viewRef.current
        if (!el) return { x: 0, y: 0 }
        return {
          x: (el.clientWidth / 2 - cam.tx) / scale,
          y: (el.clientHeight / 2 - cam.ty) / scale
        }
      }
    }),
    [fit, cam, scale]
  )

  const didFit = React.useRef(false)
  React.useEffect(() => {
    if (didFit.current) return
    if (doc.parts.length === 0 || doc.parts.every((p) => !p[view] || visualFor(p.type, view))) {
      fit()
      didFit.current = true
    }
  })

  // ── part drag (frozen bends; multi-select moves together) ───────────────────

  const onPartDown = (e: React.PointerEvent, partId: string): void => {
    if ((e.target as HTMLElement).closest('.pin-hit')) return
    e.stopPropagation()
    if (!editable) {
      setSel({ parts: new Set([partId]), wires: new Set() })
      return
    }
    if (e.shiftKey) {
      const parts = new Set(sel.parts)
      if (parts.has(partId)) parts.delete(partId)
      else parts.add(partId)
      setSel({ parts, wires: new Set() })
      return
    }
    const part = doc.parts.find((p) => p.id === partId)
    // sticky boards: dragging a breadboard takes its seated parts along (bb)
    const stickyIds =
      view === 'bb' && part && isBreadboard(part.type)
        ? [partId, ...seatedPartsOn(partId, seats)]
        : [partId]
    const moveIds = sel.parts.has(partId) ? [...sel.parts] : stickyIds
    if (!sel.parts.has(partId)) setSel({ parts: new Set([partId]), wires: new Set() })

    const grabbedPl = placementOf(partId)
    if (!grabbedPl) return
    const r = innerRef.current!.getBoundingClientRect()
    const orig = new Map<string, Placement>()
    for (const id of moveIds) {
      const pl = doc.parts.find((p) => p.id === id)?.[view]
      if (pl) orig.set(id, pl)
    }
    partDrag.current = {
      ids: [...orig.keys()],
      grabbed: partId,
      offX: (e.clientX - r.left) / scale - grabbedPl.x,
      offY: (e.clientY - r.top) / scale - grabbedPl.y,
      orig,
      frozen: collectFrozen(doc, new Set(orig.keys()), view),
      moved: false
    }
    window.addEventListener('pointermove', onPartMove)
    window.addEventListener('pointerup', onPartUp)
  }

  const onPartMove = (e: PointerEvent): void => {
    const d = partDrag.current
    if (!d) return
    const r = innerRef.current!.getBoundingClientRect()
    const grabbedOrig = d.orig.get(d.grabbed)!
    const part = doc.parts.find((p) => p.id === d.grabbed)
    if (!part) return
    const raw: Placement = {
      ...grabbedOrig,
      x: (e.clientX - r.left) / scale - d.offX,
      y: (e.clientY - r.top) / scale - d.offY
    }
    const snapped = snapBB(part.type, raw, view)
    const delta = { x: snapped.x - grabbedOrig.x, y: snapped.y - grabbedOrig.y }
    if (delta.x !== 0 || delta.y !== 0) d.moved = true
    if (!d.moved) return

    const placements = new Map<string, Placement>()
    for (const [id, pl] of d.orig) {
      placements.set(id, { ...pl, x: pl.x + delta.x, y: pl.y + delta.y })
    }
    setDragOverrides(placements)

    const reroutes = reroutesFor(doc, d.frozen, placements, delta, view)
    const cmds = [...placements.entries()].map(([id, pl], i) =>
      cmd.placePart(id, view, pl, i === 0 ? reroutes : [])
    )
    store.dispatch(
      cmd.composite(
        d.ids.length === 1 ? `Move ${d.grabbed}` : `Move ${d.ids.length} parts`,
        cmds,
        `move:${view}:${d.ids.slice().sort().join(',')}`
      )
    )
  }

  const onPartUp = (e: PointerEvent): void => {
    const d = partDrag.current
    partDrag.current = null
    setDragOverrides(null)
    window.removeEventListener('pointermove', onPartMove)
    window.removeEventListener('pointerup', onPartUp)
    // a press on a breadboard that never displaced = a hole interaction
    if (d && !d.moved && editable && view === 'bb') {
      const part = doc.parts.find((p) => p.id === d.grabbed)
      if (part && isBreadboard(part.type)) {
        const cp = canvasPoint(e)
        const hole = holeAt(doc, d.grabbed, cp.x, cp.y, 8 / scale)
        if (hole) pinInteract(`${d.grabbed}:${hole.pin}`, hole.pos)
      }
    }
  }

  // drag a part's title label (offset stored on the bb placement)
  const onLabelDown = (e: React.PointerEvent, partId: string): void => {
    if (!editable) return
    e.stopPropagation()
    setSel({ parts: new Set([partId]), wires: new Set() })
    const start = canvasPoint(e)
    const pl = placementOf(partId)
    if (!pl) return
    const off = pl.labelOffset || [0, 0]
    labelDrag.current = { id: partId, ox: off[0] - start.x, oy: off[1] - start.y }
    const move = (ev: PointerEvent): void => {
      const ld = labelDrag.current
      if (!ld) return
      const cur = doc.parts.find((p) => p.id === ld.id)?.[view]
      if (!cur) return
      const cp = canvasPoint(ev)
      const offset: [number, number] = [Math.round(ld.ox + cp.x), Math.round(ld.oy + cp.y)]
      store.dispatch(cmd.placePart(ld.id, view, { ...cur, labelOffset: offset }, [], true))
    }
    const up = (): void => {
      labelDrag.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // drag / select a schematic net label (moves its sch placement + reroutes wires)
  const onNetLabelDown = (e: React.PointerEvent, id: string): void => {
    if ((e.target as HTMLElement).closest('.pin-hit')) return
    e.stopPropagation()
    if (!editable) {
      setSel({ parts: new Set(), wires: new Set(), labels: new Set([id]) })
      return
    }
    if (e.shiftKey) {
      const labels = new Set(sel.labels ?? [])
      if (labels.has(id)) labels.delete(id)
      else labels.add(id)
      setSel({ parts: new Set(), wires: new Set(), labels })
      return
    }
    setSel({ parts: new Set(), wires: new Set(), labels: new Set([id]) })
    const label = doc.netLabels?.find((l) => l.id === id)
    if (!label) return
    const start = canvasPoint(e)
    netLabelDrag.current = {
      id,
      offX: start.x - label.sch.x,
      offY: start.y - label.sch.y,
      frozen: collectFrozen(doc, new Set([id]), 'sch'),
      moved: false
    }
    const move = (ev: PointerEvent): void => {
      const d = netLabelDrag.current
      if (!d) return
      const cur = doc.netLabels?.find((l) => l.id === d.id)
      if (!cur) return
      const cp = canvasPoint(ev)
      const snapped = snapNetLabel(cur.kind, cur.name, {
        ...cur.sch,
        x: cp.x - d.offX,
        y: cp.y - d.offY
      })
      if (snapped.x !== cur.sch.x || snapped.y !== cur.sch.y) d.moved = true
      const overrides = new Map<string, Placement>([[d.id, snapped]])
      setDragOverrides(overrides)
      const reroutes = reroutesFor(doc, d.frozen, overrides, { x: 0, y: 0 }, 'sch')
      store.dispatch(cmd.moveNetLabel(d.id, snapped, reroutes, true))
    }
    const up = (): void => {
      netLabelDrag.current = null
      setDragOverrides(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ── wire drawing ────────────────────────────────────────────────────────────

  const finalizeSegment = (target: Pt, clean: boolean): { pts: Pt[]; str: boolean } => {
    const pts = [...armed!.points]
    const last = pts[pts.length - 1]
    const str = view === 'bb' && (armed!.straight || straight) // sch: orthogonal only
    if (str) pts.push(target)
    else pts.push(...calculateOrthogonalPath(last.x, last.y, target.x, target.y, clean).slice(1))
    return { pts: simplifyWirePoints(pts), str }
  }

  const commitWire = (from: WireEnd, to: WireEnd, pts: Pt[], str: boolean): void => {
    store.dispatch(
      cmd.addWire({
        from,
        to,
        view,
        ...(view === 'bb' ? { color: wireColor } : {}), // schematic wires are ink
        route: journeyFromPoints(pts, str)
      })
    )
  }

  /** Shared pin gesture: arm on first pin, finalize on second (also used by
   * breadboard holes, which have no per-pin hit divs). */
  const pinInteract = (ref: string, pos: Pt): void => {
    if (!armed) {
      setArmed({ from: ref, points: [pos], straight: false })
      setSel(emptySel())
      return
    }
    if (armed.from === ref) {
      setArmed(null)
      return
    }
    const { pts, str } = finalizeSegment(pos, true)
    commitWire(armed.from, ref, pts, str)
    setArmed(null)
  }

  const onPinClick = (e: React.MouseEvent, partId: string, pin: string): void => {
    if (!editable) return
    e.stopPropagation()
    const ref = `${partId}:${pin}`
    const pos = resolve(ref)
    if (pos) pinInteract(ref, pos)
  }

  // tap a junction onto an existing wire at the click point → {wire, t}
  const tapJunction = (hit: WireHit): void => {
    const host = geomForHit.find((g) => g.id === hit.id)
    if (!host || !armed) return
    const jp = clampOntoSegment(hit.p1, hit.p2, snap(mouse.x), snap(mouse.y))
    const t = tAtPoint(host.points, jp)
    const { pts, str } = finalizeSegment(jp, false)
    commitWire(armed.from, { wire: hit.id, t }, pts, str)
    setArmed(null)
  }

  const onCanvasClick = (e: React.MouseEvent): void => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (armed) {
      const cp = canvasPoint(e)
      const hit = hitWire(cp.x, cp.y, geomForHit, scale)
      if (hit) {
        setMouse(cp)
        tapJunction(hit)
        return
      }
      const target = { x: snap(cp.x), y: snap(cp.y) }
      const last = armed.points[armed.points.length - 1]
      const seg = straight
        ? [last, target]
        : calculateOrthogonalPath(last.x, last.y, target.x, target.y, false)
      setArmed({
        ...armed,
        points: [...armed.points, ...seg.slice(1)],
        straight: armed.straight || straight
      })
      return
    }
    if (!e.shiftKey) setSel(emptySel())
  }

  // ── selected-wire editing (segment / vertex / endpoint handles) ─────────────

  const resolveEndpointTarget = (wx: number, wy: number, selfId: string): WireEnd | null => {
    const pin = pinAtWorld(doc, wx, wy, 8 / scale, view)
    if (pin) return `${pin.id}:${pin.pin}`
    const others = geomForHit.filter((g) => g.id !== selfId)
    const hit = hitWire(wx, wy, others, scale)
    if (hit) {
      const host = others.find((g) => g.id === hit.id)!
      const jp = clampOntoSegment(hit.p1, hit.p2, snap(wx), snap(wy))
      return { wire: hit.id, t: tAtPoint(host.points, jp) }
    }
    return null // v2 has no free-point endpoints — caller reverts
  }

  const startHandleDrag = (
    e: React.PointerEvent,
    kind: HandleKind,
    idx: number,
    end?: 0 | 1
  ): void => {
    if (!editable || !soloWire || !editPts) return
    e.stopPropagation()
    const wireId = soloWire
    const wire = doc.wires.find((w) => w.id === wireId)
    if (!wire) return
    const orig = editPts
    const str = isStraightRoute(wire.route)
    const axis: 'horizontal' | 'vertical' =
      kind === 'edge' && Math.abs(orig[idx].y - orig[idx + 1].y) < 0.001 ? 'horizontal' : 'vertical'
    const endIdx = end === 0 ? 0 : orig.length - 1
    let live = orig
    let lastWorld = { x: 0, y: 0 }
    handleDrag.current = { kind }
    const move = (ev: PointerEvent): void => {
      const cp = canvasPoint(ev)
      if (kind === 'vertex') {
        live = vertexDrag(orig, idx, snap(cp.x), snap(cp.y))
      } else if (kind === 'edge') {
        live = dragSegment(orig, idx, axis, snap(cp.x), snap(cp.y))
      } else {
        lastWorld = cp
        const p = { x: snap(cp.x), y: snap(cp.y) }
        live = orig.map((pt, k) => (k === endIdx ? p : pt))
      }
      setEditPts(live)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      handleDrag.current = null
      if (kind === 'endpoint') {
        const tgt = resolveEndpointTarget(lastWorld.x, lastWorld.y, wireId)
        const origEnd = end === 0 ? wire.from : wire.to
        const finalEnd = tgt ?? origEnd // no valid target → endpoint stays put
        const rp = resolve(finalEnd)
        if (rp) live = live.map((pt, k) => (k === endIdx ? rp : pt))
        store.dispatch(
          cmd.setWireEnds(
            wireId,
            end === 0 ? finalEnd : undefined,
            end === 1 ? finalEnd : undefined,
            journeyFromPoints(simplifyWirePoints(live), str)
          )
        )
      } else {
        store.dispatch(cmd.rerouteWire(wireId, journeyFromPoints(simplifyWirePoints(live), str)))
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onWireDoubleClick = (e: React.MouseEvent, wireId: string): void => {
    if (!editable) return
    e.stopPropagation()
    const g = wireGeom.find((x) => x.w.id === wireId)
    if (!g || g.pts.length < 2) return
    const str = isStraightRoute(g.w.route)
    const cp = canvasPoint(e)
    const handleR = 7 / scale
    for (let k = 1; k < g.pts.length - 1; k++) {
      if (Math.hypot(g.pts[k].x - cp.x, g.pts[k].y - cp.y) < handleR) {
        const next = simplifyWirePoints(g.pts.filter((_, j) => j !== k))
        store.dispatch(cmd.rerouteWire(wireId, journeyFromPoints(next, str)))
        setEditPts(next)
        return
      }
    }
    const hit = hitWire(cp.x, cp.y, [{ id: wireId, points: g.pts }], scale)
    if (hit) {
      const next = g.pts.slice()
      next.splice(hit.segmentIndex + 1, 0, { x: snap(cp.x), y: snap(cp.y) })
      store.dispatch(cmd.rerouteWire(wireId, journeyFromPoints(next, str)))
      setSel({ parts: new Set(), wires: new Set([wireId]) })
      setEditPts(next)
    }
  }

  const onWireClick = (e: React.MouseEvent, wireId: string): void => {
    e.stopPropagation()
    if (armed) {
      const cp = canvasPoint(e)
      setMouse(cp)
      const hit = hitWire(
        cp.x,
        cp.y,
        geomForHit.filter((g) => g.id === wireId),
        scale
      )
      if (hit) tapJunction(hit)
      return
    }
    if (e.shiftKey && editable) {
      const wires = new Set(sel.wires)
      if (wires.has(wireId)) wires.delete(wireId)
      else wires.add(wireId)
      setSel({ parts: sel.parts, wires })
      return
    }
    setSel({ parts: new Set(), wires: new Set([wireId]) })
  }

  // ── background: pan / marquee ───────────────────────────────────────────────

  const onViewPointerDown = (e: React.PointerEvent): void => {
    const panButton =
      e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && !editable)
    if (panButton) {
      e.preventDefault()
      pan.current = { x: e.clientX, y: e.clientY }
      const move = (ev: PointerEvent): void => {
        const p = pan.current
        if (!p) return
        setCam((c) => ({ ...c, tx: c.tx + (ev.clientX - p.x), ty: c.ty + (ev.clientY - p.y) }))
        pan.current = { x: ev.clientX, y: ev.clientY }
        suppressClick.current = true
      }
      const up = (): void => {
        pan.current = null
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      return
    }
    // left-drag on empty canvas in edit mode (not while drawing) = marquee.
    // Parts/pins/wires/handles all stopPropagation, so reaching here on the
    // view div (or the zero-size scene div) means the press hit empty canvas.
    if (e.button === 0 && editable && !armed) {
      const start = canvasPoint(e)
      const additive = e.shiftKey
      let rect: { a: Pt; b: Pt } | null = null
      const move = (ev: PointerEvent): void => {
        rect = { a: start, b: canvasPoint(ev) }
        setMarquee(rect)
      }
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setMarquee(null)
        if (!rect) return // plain click — onCanvasClick handles deselect
        const x0 = Math.min(rect.a.x, rect.b.x)
        const y0 = Math.min(rect.a.y, rect.b.y)
        const x1 = Math.max(rect.a.x, rect.b.x)
        const y1 = Math.max(rect.a.y, rect.b.y)
        if (x1 - x0 < 3 && y1 - y0 < 3) return
        suppressClick.current = true
        const parts = new Set(additive ? sel.parts : [])
        for (const part of doc.parts) {
          const pl = part[view]
          if (!pl) continue
          const vis = visualFor(part.type, view)
          if (!vis) continue
          if (pl.x < x1 && pl.x + vis.v.w > x0 && pl.y < y1 && pl.y + vis.v.h > y0)
            parts.add(part.id)
        }
        const wires = new Set(additive ? sel.wires : [])
        for (const g of wireGeom) {
          if (g.pts.some((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)) wires.add(g.w.id)
        }
        const labels = new Set(additive ? (sel.labels ?? []) : [])
        if (view === 'sch') {
          for (const label of doc.netLabels ?? []) {
            const pl = label.sch
            const v = netLabelVisualOf(label)
            if (pl.x < x1 && pl.x + v.w > x0 && pl.y < y1 && pl.y + v.h > y0) labels.add(label.id)
          }
        }
        setSel({ parts, wires, labels })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
  }

  const onCanvasMove = (e: React.PointerEvent): void => {
    if (armed) setMouse(canvasPoint(e))
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const type = e.dataTransfer.getData('text/tinystudio-part')
    if (type) {
      onDropPart(type, canvasPoint(e))
      return
    }
    const nl = e.dataTransfer.getData('text/tinystudio-netlabel')
    if (nl && view === 'sch') {
      const idx = nl.indexOf(':')
      onDropNetLabel(nl.slice(0, idx) as NetLabelKind, nl.slice(idx + 1), canvasPoint(e))
    }
  }

  // ── keyboard: undo/redo, delete, rotate, nudge, clipboard, Esc, Shift ───────

  /**
   * Rotate a breadboard as a rigid assembly (bb only): the board, its seated
   * parts, and the wires between them all turn 90 deg about the board's centre,
   * so the whole layout is preserved rather than the wires rerouting. Seating is
   * grid-aligned, so a 90 deg turn about centre maps holes->holes and pins re-seat.
   */
  const rotateBoardAssembly = React.useCallback(
    (boardId: string): void => {
      const c = rotateBoardAssemblyCmd(doc, boardId, seats)
      if (c) store.dispatch(c)
    },
    [doc, store, seats]
  )

  const rotateSelection = React.useCallback((): void => {
    const ids = [...sel.parts]
    if (!ids.length) {
      // schematic: R rotates selected net labels (90° steps, wires reroute)
      if (view !== 'sch') return
      const cmds: cmd.Command[] = []
      for (const id of sel.labels ?? []) {
        const c = rotateNetLabelCmd(doc, id)
        if (c) cmds.push(c)
      }
      if (cmds.length)
        store.dispatch(cmds.length === 1 ? cmds[0] : cmd.composite('Rotate labels', cmds))
      return
    }
    // a lone breadboard rotates as a rigid assembly (carries seated parts + wires)
    if (
      view === 'bb' &&
      ids.length === 1 &&
      isBreadboard(doc.parts.find((p) => p.id === ids[0])?.type ?? '')
    ) {
      rotateBoardAssembly(ids[0])
      return
    }
    const frozen = collectFrozen(doc, new Set(ids), view)
    const placements = new Map<string, Placement>()
    const cmds: cmd.Command[] = []
    for (const id of ids) {
      const cur = doc.parts.find((p) => p.id === id)?.[view]
      if (!cur) continue
      const next = (((((cur.rotate ?? 0) + 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270
      placements.set(id, { ...cur, rotate: next || undefined })
    }
    const reroutes = reroutesFor(doc, frozen, placements, { x: 0, y: 0 }, view)
    let first = true
    for (const [id, pl] of placements) {
      cmds.push(cmd.placePart(id, view, pl, first ? reroutes : []))
      first = false
    }
    if (cmds.length)
      store.dispatch(
        cmd.composite(`Rotate ${ids.length > 1 ? `${ids.length} parts` : ids[0]}`, cmds)
      )
  }, [doc, sel, store, view, rotateBoardAssembly])

  const nudgeSelection = React.useCallback(
    (dx: number, dy: number): void => {
      const ids = [...sel.parts]
      if (!ids.length) return
      const frozen = collectFrozen(doc, new Set(ids), view)
      const placements = new Map<string, Placement>()
      for (const id of ids) {
        const cur = doc.parts.find((p) => p.id === id)?.[view]
        if (cur) placements.set(id, { ...cur, x: cur.x + dx, y: cur.y + dy })
      }
      const reroutes = reroutesFor(doc, frozen, placements, { x: dx, y: dy }, view)
      let first = true
      const cmds: cmd.Command[] = []
      for (const [id, pl] of placements) {
        cmds.push(cmd.placePart(id, view, pl, first ? reroutes : []))
        first = false
      }
      if (cmds.length)
        store.dispatch(cmd.composite('Nudge', cmds, `nudge:${ids.slice().sort().join(',')}`))
    },
    [doc, sel, store, view]
  )

  const deleteSelection = React.useCallback((): void => {
    const cmds: cmd.Command[] = []
    if (sel.parts.size) cmds.push(cmd.deleteParts([...sel.parts]))
    if (sel.wires.size) cmds.push(cmd.deleteWires([...sel.wires]))
    if (sel.labels?.size) for (const id of sel.labels) cmds.push(cmd.deleteNetLabel(id))
    if (!cmds.length) return
    store.dispatch(cmds.length === 1 ? cmds[0] : cmd.composite('Delete selection', cmds))
    setSel(emptySel())
  }, [sel, store, setSel])

  const copySelection = React.useCallback(async (): Promise<boolean> => {
    const payload = buildClipboard(doc, sel.parts, sel.wires)
    if (!payload) return false
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }, [doc, sel])

  const pastePayload = React.useCallback(
    (payload: NonNullable<ReturnType<typeof parseClipboard>>): void => {
      const { parts, wires, idMap } = materializePaste(
        doc,
        payload,
        freePasteOffset(doc, payload.parts, view)
      )
      if (!parts.length && !wires.length) return
      store.dispatch(
        cmd.composite(`Paste ${parts.length} part${parts.length === 1 ? '' : 's'}`, [
          ...parts.map((p) => cmd.addPart(p)),
          ...wires.map((w) => cmd.addWire(w))
        ])
      )
      setSel({ parts: new Set(idMap.values()), wires: new Set(wires.map((w) => w.id)) })
    },
    [doc, store, setSel]
  )

  React.useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))
        return
      // Space = straight-wire modifier (Shift is reserved for shift-select).
      if (e.key === ' ') {
        setStraight(true)
        e.preventDefault()
        return
      }
      if (e.key === 'Escape') {
        setArmed(null)
        setSel(emptySel())
        return
      }
      if (!editable) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        store.redo()
        return
      }
      if (mod && (e.key === 'c' || e.key === 'C')) {
        void copySelection()
        return
      }
      if (mod && (e.key === 'x' || e.key === 'X')) {
        void copySelection().then((ok) => {
          if (ok) deleteSelection()
        })
        return
      }
      if (mod && (e.key === 'v' || e.key === 'V')) {
        void navigator.clipboard.readText().then((text) => {
          const payload = parseClipboard(text)
          if (payload) pastePayload(payload)
        })
        return
      }
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        const payload = buildClipboard(doc, sel.parts, sel.wires)
        if (payload) pastePayload(payload)
        return
      }
      if (e.key === 'r' || e.key === 'R') {
        if (sel.parts.size) {
          e.preventDefault()
          rotateSelection()
        }
        return
      }
      if ((e.key === 'f' || e.key === 'F') && view === 'sch' && sel.parts.size) {
        // horizontal mirror — schematic only (spec §6.3 / B13)
        e.preventDefault()
        const ids = [...sel.parts]
        const frozen = collectFrozen(doc, new Set(ids), view)
        const placements = new Map<string, Placement>()
        for (const id of ids) {
          const cur = doc.parts.find((p) => p.id === id)?.[view]
          if (cur) placements.set(id, { ...cur, flip: cur.flip ? undefined : true })
        }
        const reroutes = reroutesFor(doc, frozen, placements, { x: 0, y: 0 }, view)
        let first = true
        const cmds: cmd.Command[] = []
        for (const [id, pl] of placements) {
          cmds.push(cmd.placePart(id, view, pl, first ? reroutes : []))
          first = false
        }
        if (cmds.length) store.dispatch(cmd.composite('Flip', cmds))
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelection()
        return
      }
      if (e.key.startsWith('Arrow') && sel.parts.size) {
        e.preventDefault()
        const step = (view === 'sch' ? GRID_SCH : GRID_BB) * (e.shiftKey ? 5 : 1)
        const d = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step]
        }[e.key]
        if (d) nudgeSelection(d[0], d[1])
      }
    }
    const up = (e: KeyboardEvent): void => {
      if (e.key === ' ') setStraight(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [
    editable,
    sel,
    doc,
    store,
    setSel,
    view,
    copySelection,
    pastePayload,
    deleteSelection,
    rotateSelection,
    nudgeSelection
  ])

  // ── derived render bits ─────────────────────────────────────────────────────

  const previewPts = React.useMemo((): Pt[] | null => {
    if (!armed) return null
    const last = armed.points[armed.points.length - 1]
    let target = { x: snap(mouse.x), y: snap(mouse.y) }
    let clean = false
    if (hoverPin) {
      const pos = resolve(`${hoverPin.id}:${hoverPin.pin}`)
      if (pos) {
        target = pos
        clean = true
      }
    } else if (hoverHole) {
      target = hoverHole.pos
      clean = true
    }
    if (armed.straight || straight) return [...armed.points, target]
    return [
      ...armed.points,
      ...calculateOrthogonalPath(last.x, last.y, target.x, target.y, clean).slice(1)
    ]
  }, [armed, mouse, hoverPin, hoverHole, straight, resolve])

  // junction solder dots (junction endpoints take the host wire's color)
  const junctionDots = React.useMemo(() => {
    const out: { key: string; pt: Pt; color: string }[] = []
    const fallback = view === 'sch' ? ink : '#2fa46a'
    const colorOf = new Map(doc.wires.map((w) => [w.id, w.color || fallback]))
    doc.wires
      .filter((w) => w.view === view)
      .forEach((w) =>
        [w.from, w.to].forEach((end, i) => {
          if (!isJunction(end)) return
          const p = resolve(end)
          if (!p) return
          const color = isPendingJunction(end)
            ? w.color || fallback
            : colorOf.get(end.wire) || w.color || fallback
          out.push({ key: `${w.id}:${i}`, pt: p, color })
        })
      )
    return out
  }, [doc, resolve])

  // Contextual hint only while actively wiring/editing — no idle 'scroll to
  // zoom' / 'view-only' bubbles cluttering the canvas.
  const hint: { icon: React.JSX.Element | null; text: string } | null =
    editable && armed
      ? {
          icon: <Zap size={12} />,
          text: `Click a pin or wire to connect · click for a bend${view === 'bb' ? ' · hold Space for straight' : ''} · Esc to cancel`
        }
      : editable && soloWire
        ? {
            icon: null,
            text: 'Drag a handle to reshape · double-click to add/remove a bend · Del to remove'
          }
        : null

  return (
    <div className="flex-1 relative min-w-0 overflow-hidden">
      <div
        ref={viewRef}
        className="size-full overflow-hidden"
        style={{
          touchAction: 'none',
          cursor: armed ? 'crosshair' : 'default',
          // schematic reads as paper (lighter surface, finer dot grid — spec §8.1)
          backgroundColor: view === 'sch' ? 'var(--bg)' : 'var(--bg-sunken)',
          backgroundImage: grid
            ? `radial-gradient(var(--dot-color) ${view === 'sch' ? 0.9 : 1.1}px, transparent ${view === 'sch' ? 0.9 : 1.1}px)`
            : 'none',
          backgroundSize: `${(view === 'sch' ? GRID_SCH : GRID_BB) * scale}px ${(view === 'sch' ? GRID_SCH : GRID_BB) * scale}px`,
          backgroundPosition: `${cam.tx}px ${cam.ty}px`
        }}
        onWheel={(e) => {
          const r = viewRef.current!.getBoundingClientRect()
          zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top)
        }}
        onPointerDown={onViewPointerDown}
        onPointerMove={onCanvasMove}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={onDrop}
        onClick={onCanvasClick}
      >
        <div
          ref={innerRef}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${scale})`,
            transformOrigin: '0 0'
          }}
        >
          {/* wires */}
          <svg
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'visible',
              zIndex: 5,
              pointerEvents: 'none'
            }}
          >
            {/* ratsnest: connected elsewhere, not yet drawn here (spec §8.2) */}
            {rats.map((r, i) => (
              <line
                key={`rat${i}`}
                x1={r.a.x}
                y1={r.a.y}
                x2={r.b.x}
                y2={r.b.y}
                stroke="var(--text-faint)"
                strokeWidth={1.2}
                strokeDasharray="5 4"
                opacity={0.75}
              />
            ))}
            {wireGeom.map(({ w, pts: raw }) => {
              const pts = soloWire === w.id && editPts ? editPts : raw
              if (pts.length < 2) return null
              const selected = sel.wires.has(w.id)
              const onHotNet = highlightNet >= 0 && netModel.wireToNet.get(w.id) === highlightNet
              const core = view === 'sch' ? ink : w.color || '#2fa46a'
              const outline = view === 'sch' ? 'rgba(0,0,0,0.45)' : darken(w.color || '#2fa46a')
              // schematic ink is a single thin stroke — no color outline, no glow.
              const coreW = view === 'sch' ? WIRE_SCH_W : WIRE_W
              const d = roundedPath(pts)
              return (
                <g
                  key={w.id}
                  style={{ cursor: editable ? 'pointer' : 'default', pointerEvents: 'stroke' }}
                  onPointerEnter={() => setHoverWire(w.id)}
                  onPointerLeave={() => setHoverWire((h) => (h === w.id ? null : h))}
                  onClick={(e) => onWireClick(e, w.id)}
                  onDoubleClick={(e) => onWireDoubleClick(e, w.id)}
                >
                  {/* transparent fat stroke keeps thin schematic lines clickable */}
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(coreW + 10, 12)}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {onHotNet && (
                    <path
                      d={d}
                      fill="none"
                      stroke={NET_GLOW}
                      strokeWidth={view === 'sch' ? coreW + 3 : WIRE_GLOW_W}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  )}
                  {view !== 'sch' && (
                    <path
                      d={d}
                      fill="none"
                      stroke={outline}
                      strokeWidth={WIRE_OUTLINE_W}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  )}
                  <path
                    d={d}
                    fill="none"
                    stroke={core}
                    strokeWidth={coreW}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {selected && (
                    <path
                      d={d}
                      fill="none"
                      stroke="rgba(255,255,255,0.85)"
                      strokeWidth={1}
                      strokeDasharray="4 4"
                      strokeLinejoin="round"
                    >
                      <animate
                        attributeName="stroke-dashoffset"
                        from="0"
                        to="-8"
                        dur="0.5s"
                        repeatCount="indefinite"
                      />
                    </path>
                  )}
                </g>
              )
            })}

            {junctionDots.map((j) => (
              <circle key={j.key} cx={j.pt.x} cy={j.pt.y} r={3} fill={j.color} />
            ))}

            {previewPts && (
              <path
                d={roundedPath(previewPts)}
                fill="none"
                stroke={view === 'sch' ? ink : wireColor}
                strokeWidth={view === 'sch' ? WIRE_SCH_W : WIRE_W}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={0.6}
              />
            )}

            {/* handles on the solo-selected wire */}
            {editable && soloWire && editPts && (
              <g style={{ pointerEvents: 'auto' }}>
                {editPts.slice(0, -1).map((p, i) => {
                  const q = editPts[i + 1]
                  const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
                  const horizontal = Math.abs(p.y - q.y) < 0.001
                  return (
                    <rect
                      key={`s${i}`}
                      x={m.x - 3.5}
                      y={m.y - 3.5}
                      width={7}
                      height={7}
                      rx={1.5}
                      fill="var(--brand)"
                      stroke="#fff"
                      strokeWidth={1}
                      style={{ cursor: horizontal ? 'ns-resize' : 'ew-resize' }}
                      onPointerDown={(e) => startHandleDrag(e, 'edge', i)}
                    />
                  )
                })}
                {editPts.slice(1, -1).map((p, i) => (
                  <circle
                    key={`v${i}`}
                    cx={p.x}
                    cy={p.y}
                    r={4}
                    fill="var(--brand)"
                    stroke="#fff"
                    strokeWidth={1.2}
                    style={{ cursor: 'move' }}
                    onPointerDown={(e) => startHandleDrag(e, 'vertex', i + 1)}
                  />
                ))}
                {[0, 1].map((end) => {
                  const p = end === 0 ? editPts[0] : editPts[editPts.length - 1]
                  return (
                    <circle
                      key={`e${end}`}
                      cx={p.x}
                      cy={p.y}
                      r={4.5}
                      fill="var(--surface-card)"
                      stroke="var(--brand)"
                      strokeWidth={2}
                      style={{ cursor: 'grab' }}
                      onPointerDown={(e) => startHandleDrag(e, 'endpoint', 0, end as 0 | 1)}
                    />
                  )
                })}
              </g>
            )}

            {/* drop-to-connect seat marks (green) + hovered hole */}
            {editable &&
              view === 'bb' &&
              seats.map((s) => (
                <rect
                  key={`seat:${s.pin}`}
                  x={s.pos.x - 3.1}
                  y={s.pos.y - 3.1}
                  width={6.2}
                  height={6.2}
                  rx={1.2}
                  fill="none"
                  stroke="#37b26b"
                  strokeWidth={1.1}
                />
              ))}
            {hoverHole && view === 'bb' && (
              <circle
                cx={hoverHole.pos.x}
                cy={hoverHole.pos.y}
                r={4}
                fill="var(--yellow)"
                fillOpacity={0.45}
                stroke="var(--yellow)"
                strokeWidth={1}
              />
            )}

            {/* marquee */}
            {marquee && (
              <rect
                x={Math.min(marquee.a.x, marquee.b.x)}
                y={Math.min(marquee.a.y, marquee.b.y)}
                width={Math.abs(marquee.b.x - marquee.a.x)}
                height={Math.abs(marquee.b.y - marquee.a.y)}
                fill="rgba(66,165,245,0.08)"
                stroke="var(--brand)"
                strokeWidth={1 / scale}
                strokeDasharray={`${4 / scale} ${3 / scale}`}
              />
            )}
          </svg>

          {/* parts */}
          {doc.parts.map((part) => {
            const pl = placementOf(part.id)
            if (!pl) return null
            // breadboards are transparent on the schematic — their row/rail
            // buses still merge nets globally, but they render as no part here.
            if (view === 'sch' && isBreadboard(part.type)) return null
            const vis = visualFor(part.type, view)
            if (!vis) {
              return (
                <div
                  key={part.id}
                  style={{ position: 'absolute', left: pl.x, top: pl.y, zIndex: 2 }}
                  className="px-2 py-1 rounded bg-surface-card border border-border-default text-[10px] text-text-faint"
                >
                  {part.type}…
                </div>
              )
            }
            const selected = sel.parts.has(part.id)
            const labelOff = pl.labelOffset || [0, 0]
            return (
              <div
                key={part.id}
                style={{
                  position: 'absolute',
                  left: pl.x,
                  top: pl.y,
                  width: vis.v.w,
                  height: vis.v.h,
                  zIndex: 2,
                  transform:
                    pl.rotate || pl.flip
                      ? `${pl.rotate ? `rotate(${pl.rotate}deg)` : ''}${pl.flip ? ' scaleX(-1)' : ''}`
                      : undefined,
                  transformOrigin: 'center',
                  outline: selected ? '2px solid var(--brand)' : 'none',
                  outlineOffset: 4,
                  borderRadius: 6,
                  cursor: editable ? 'move' : 'default'
                }}
                onPointerDown={(e) => onPartDown(e, part.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  if (!editable) onRequestEdit()
                }}
                onPointerMove={(e) => {
                  if (!editable || view !== 'bb' || !isBreadboard(part.type) || partDrag.current)
                    return
                  const cp = canvasPoint(e)
                  const hole = holeAt(doc, part.id, cp.x, cp.y, 6 / Math.min(scale, 1))
                  setHoverHole(hole ? { id: part.id, pin: hole.pin, pos: hole.pos } : null)
                }}
                onPointerLeave={() => setHoverHole((h) => (h?.id === part.id ? null : h))}
                onClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => {
                  if (!editable) return
                  e.preventDefault()
                  // breadboards rotate as a rigid assembly (seated parts + wires
                  // turn with the board); other parts rotate in place.
                  if (view === 'bb' && isBreadboard(part.type)) {
                    rotateBoardAssembly(part.id)
                    return
                  }
                  const cur = doc.parts.find((p) => p.id === part.id)?.[view]
                  if (!cur) return
                  const next = (((((cur.rotate ?? 0) + 90) % 360) + 360) % 360) as
                    | 0
                    | 90
                    | 180
                    | 270
                  const frozen = collectFrozen(doc, new Set([part.id]), view)
                  const placements = new Map([[part.id, { ...cur, rotate: next || undefined }]])
                  store.dispatch(
                    cmd.placePart(
                      part.id,
                      view,
                      placements.get(part.id),
                      reroutesFor(doc, frozen, placements, { x: 0, y: 0 }, view)
                    )
                  )
                }}
              >
                <div
                  className="size-full [&>svg]:size-full [&>svg]:block pointer-events-none select-none"
                  dangerouslySetInnerHTML={{ __html: vis.v.svg }}
                />
                {editable &&
                  Object.keys(vis.v.pins).length <= 60 &&
                  Object.keys(vis.v.pins).map((pin) => {
                    const [px, py] = vis.v.pins[pin]
                    const armedHere = armed?.from === `${part.id}:${pin}`
                    const hovered = hoverPin?.id === part.id && hoverPin?.pin === pin
                    const netIdx = netModel.pinToNet.get(`${part.id}:${pin}`)
                    const onHotNet = highlightNet >= 0 && netIdx === highlightNet
                    // a pin sharing a net with anything else is connected — its
                    // "open lead" dot disappears (still clickable to re-wire).
                    const connected =
                      netIdx !== undefined && (netModel.nets[netIdx]?.length ?? 0) >= 2
                    const on = armedHere || hovered
                    const showDot = on || onHotNet || !connected
                    return (
                      <div
                        key={pin}
                        className="pin-hit"
                        title={pin}
                        style={{
                          position: 'absolute',
                          left: px - 8,
                          top: py - 8,
                          width: 16,
                          height: 16,
                          zIndex: 3,
                          cursor: 'crosshair'
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onPointerEnter={() => setHoverPin({ id: part.id, pin })}
                        onPointerLeave={() =>
                          setHoverPin((h) => (h?.id === part.id && h?.pin === pin ? null : h))
                        }
                        onClick={(e) => onPinClick(e, part.id, pin)}
                      >
                        <svg width="16" height="16">
                          {onHotNet && !on && (
                            <circle cx="8" cy="8" r="5.5" fill="var(--yellow)" fillOpacity={0.4} />
                          )}
                          {showDot && (
                            <circle
                              cx="8"
                              cy="8"
                              r={on ? 3.4 : 2.6}
                              fill={on || connected ? 'var(--brand)' : 'var(--yellow)'}
                              stroke={on || connected ? 'var(--brand)' : 'var(--border-strong)'}
                              strokeWidth="1"
                            />
                          )}
                        </svg>
                      </div>
                    )
                  })}
                <div
                  className="absolute text-[11px] whitespace-nowrap select-none"
                  style={{
                    left: labelOff[0],
                    top: vis.v.h + 4 + labelOff[1],
                    transform:
                      pl.rotate || pl.flip
                        ? `${pl.flip ? 'scaleX(-1) ' : ''}${pl.rotate ? `rotate(${-pl.rotate}deg)` : ''}`
                        : undefined,
                    transformOrigin: 'left top',
                    color: selected ? 'var(--brand)' : 'var(--text-muted)',
                    cursor: editable ? 'move' : 'default',
                    pointerEvents: editable ? 'auto' : 'none'
                  }}
                  onPointerDown={(e) => onLabelDown(e, part.id)}
                >
                  {String(part.attrs?.label ?? part.id)}
                </div>
              </div>
            )
          })}

          {/* schematic net labels (GND / power / named) */}
          {view === 'sch' &&
            (doc.netLabels ?? []).map((label) => {
              const pl = dragOverrides?.get(label.id) ?? label.sch
              const v = netLabelVisualOf(label)
              const selected = sel.labels?.has(label.id) ?? false
              const [px, py] = v.pins['1']
              const armedHere = armed?.from === `${label.id}:1`
              const hovered = hoverPin?.id === label.id && hoverPin?.pin === '1'
              const netIdx = netModel.pinToNet.get(`${label.id}:1`)
              const connected = netIdx !== undefined && (netModel.nets[netIdx]?.length ?? 0) >= 2
              const on = armedHere || hovered
              const showDot = on || !connected
              return (
                <div
                  key={label.id}
                  style={{
                    position: 'absolute',
                    left: pl.x,
                    top: pl.y,
                    width: v.w,
                    height: v.h,
                    zIndex: 2,
                    transform: pl.rotate ? `rotate(${pl.rotate}deg)` : undefined,
                    transformOrigin: 'center',
                    outline: selected ? '2px solid var(--brand)' : 'none',
                    outlineOffset: 3,
                    borderRadius: 4,
                    cursor: editable ? 'move' : 'default'
                  }}
                  onPointerDown={(e) => onNetLabelDown(e, label.id)}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    if (!editable) onRequestEdit()
                  }}
                >
                  <div
                    className="size-full [&>svg]:size-full [&>svg]:block pointer-events-none select-none"
                    dangerouslySetInnerHTML={{ __html: v.svg }}
                  />
                  {editable && (
                    <div
                      className="pin-hit"
                      title={label.name}
                      style={{
                        position: 'absolute',
                        left: px - 8,
                        top: py - 8,
                        width: 16,
                        height: 16,
                        zIndex: 3,
                        cursor: 'crosshair'
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerEnter={() => setHoverPin({ id: label.id, pin: '1' })}
                      onPointerLeave={() =>
                        setHoverPin((h) => (h?.id === label.id && h?.pin === '1' ? null : h))
                      }
                      onClick={(e) => onPinClick(e, label.id, '1')}
                    >
                      <svg width="16" height="16">
                        {showDot && (
                          <circle
                            cx="8"
                            cy="8"
                            r={on ? 3.4 : 2.6}
                            fill={on || connected ? 'var(--brand)' : 'var(--yellow)'}
                            stroke={on || connected ? 'var(--brand)' : 'var(--border-strong)'}
                            strokeWidth="1"
                          />
                        )}
                      </svg>
                    </div>
                  )}
                </div>
              )
            })}

          {/* hole tooltip: name + net members */}
          {hoverHole && (
            <div
              style={{
                position: 'absolute',
                left: hoverHole.pos.x + 8,
                top: hoverHole.pos.y - 10,
                zIndex: 6,
                transform: `scale(${1 / scale})`,
                transformOrigin: 'left bottom',
                pointerEvents: 'none'
              }}
              className="px-2 py-1 rounded-md bg-surface-card border border-border-default text-[11px] text-text-body whitespace-nowrap shadow"
            >
              {hoverHole.pin}
              {(() => {
                const idx = netModel.pinToNet.get(`${hoverHole.id}:${hoverHole.pin}`)
                return idx != null ? ` · net: ${describeNet(netModel, idx)}` : ''
              })()}
            </div>
          )}

          {doc.parts.length === 0 && (
            <div
              className="absolute flex flex-col items-center gap-2 text-text-faint text-sm text-center"
              style={{ left: 200, top: 160, width: 320 }}
            >
              <CircuitBoard size={42} />
              <div>
                {editable
                  ? 'Drag parts from the components rail — or double-click one to drop it here.'
                  : 'Empty circuit — click edit to start placing parts.'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* transient action hint (only while wiring/reshaping) */}
      {hint && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 hidden xl:block">
          <span className="px-2.5 py-1 rounded-full bg-surface-card border border-brand/40 text-brand text-[11px] flex items-center gap-1">
            {hint.icon} {hint.text}
          </span>
        </div>
      )}
    </div>
  )
}

export type { Armed }
