/**
 * circuit/views/canvas/Canvas: the interactive breadboard scene (M1).
 *
 * Owns: camera (zoom/pan/fit), pointer routing, selection + marquee, wire
 * drawing/editing state machines, part drag with frozen-bend reroutes, and
 * the keyboard. Drawing is delegated to layers that only render what they
 * are handed: WireLayer, PartLayer, NetLabelLayer (schematic) and Overlays.
 * The gesture set is a 1:1 port of DiagramEditor's editor behaviors, re-said
 * as Commands against the CircuitStore: same editor, now with undo.
 *
 * Document mutations ONLY go through store.dispatch(command). Ephemeral state
 * (camera, hover, armed wire, marquee, edit buffer) never touches the doc.
 */

import { drawingPath } from '../../core/autoroute'
import type { LedState } from '../../core/liveState'
import type { Operable } from './PartLayer'
import { Zap } from 'lucide-react'
import React from 'react'
import { matches } from '../../../lib/shortcuts'
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
  type WireEnd,
  type WireSide,
  wireSide
} from '../../core/model'
import type { NetModel } from '../../core/nets'
import { isHoleBoard } from '../../parts/breadboard'
import { netLabelVisualOf, snapNetLabel } from '../../parts/netLabels'
import { INK } from '../../parts/style'
import {
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
  ROTATE_STEP,
  drawingWalls,
  rotateNetLabelCmd,
  schematicJunctions,
  seatedPartsOn,
  snapBB,
  viewBounds,
  pinWorldOf,
  visualFor,
  wireGeometry,
  type FrozenWire,
  type RatsnestSegment,
  type Seat
} from '../partsAdapter'
import { emptySel, type Selection } from './selection'
import { NetLabelLayer } from './NetLabelLayer'
import { SolderLayer } from './SolderLayer'
import { solderJoints } from '../solder'
import { isTinyHeaderBoard } from '../../parts/boardSymbols'
import { Overlays } from './Overlays'
import { PartLayer } from './PartLayer'
import type { Armed, HandleKind } from './types'
import { WireLayer } from './WireLayer'

export type { Selection } from './selection'

export interface Cam {
  scale: number
  tx: number
  ty: number
}

/**
 * A placed measurement tag, already resolved to this view's world coordinates
 * by the shell (which owns pin geometry). `ax/ay` is the node it reads:
 * where the leader line starts; `x/y` is where the label sits, which is the
 * part the user drags.
 */
export interface ProbeTag {
  id: string
  ax: number
  ay: number
  x: number
  y: number
  label: string
  /** last measured value, when the run produced a single number */
  value?: string
  kind: 'voltage' | 'current' | 'diff'
}

export interface CanvasHandle {
  fit: () => void
  zoomCenter: (factor: number) => void
  /** World coordinate at the viewport centre (palette double-click drops). */
  centerWorld: () => Pt
}

export function Canvas({
  store,
  doc,
  view,
  side = 'front',
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
  fitOnMount = true,
  handleRef,
  onDropPart,
  onDropNetLabel,
  onImportFiles,
  annotations,
  simVoltageForNet,
  pickNets = false,
  onPickNet,
  probes,
  onMoveProbe,
  onDeleteProbe,
  onRequestEdit,
  onPartClick,
  onPartDoubleClick,
  onPartPress,
  operable,
  leds
}: {
  store: CircuitStore
  doc: CircuitDoc
  view: ViewId
  /**
   * Breadboard view only: which face of the board is shown. 'back' mirrors the
   * view left-right (the board turned over) and new wires go on the back.
   */
  side?: WireSide
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
  /** fit the scene on first render; false when a remembered camera is restored */
  fitOnMount?: boolean
  handleRef: React.Ref<CanvasHandle>
  onDropPart: (type: string, at: Pt) => void
  onDropNetLabel: (kind: NetLabelKind, name: string, at: Pt) => void
  /** dropped OS files (.fzpz part import) */
  onImportFiles?: (files: File[], at: Pt) => void
  /** world-anchored value chips (DC sim annotations) */
  annotations?: { x: number; y: number; lx?: number; ly?: number; text: string }[]
  /** DC (.op) net voltage lookup, for the breadboard hole tooltip */
  simVoltageForNet?: (netIdx: number) => string | undefined
  /**
   * Sim output picking (spec §10.4, CircuitLab-style): while on, a click on a
   * wire or a pin toggles that net as an analysis output instead of selecting
   * it. Works in view-only mode too: picking what to measure is not editing.
   */
  pickNets?: boolean
  /** a pick: the net that was hit, and where on the sheet it was clicked */
  onPickNet?: (netIndex: number, at: Pt) => void
  /** placed measurement tags for this view, already resolved to world coords */
  probes?: ProbeTag[]
  /**
   * A tag was dragged. `at` is its new world position; `netIndex` is set only
   * when the drop landed squarely on a wire or pin, which re-anchors it.
   */
  onMoveProbe?: (id: string, at: Pt, netIndex?: number) => void
  onDeleteProbe?: (id: string) => void
  /** tray "attach to cursor" placement: id being placed + drop callback */
  /** double-clicking a component asks the shell to enter edit mode */
  onRequestEdit: () => void
  /** a plain click on a part (Simulate: press a button, flip a switch) */
  onPartClick?: (partId: string) => void
  onPartDoubleClick?: (partId: string, at: { x: number; y: number }) => void
  /** Simulate: a momentary part held down (true) and let go (false) */
  onPartPress?: (partId: string, down: boolean) => void
  /** Simulate: which parts can be operated, and how */
  operable?: (partId: string) => Operable | null
  /** Simulate: each LED's live state, by part id */
  leds?: Map<string, LedState> | null
}): React.JSX.Element {
  const scale = cam.scale
  // Back (solder side): the breadboard view mirrored left-right, as the board
  // looks turned over. Only the camera mirrors (world x maps to tx - scale*x);
  // the document never changes, so every pointer position goes through
  // canvasPoint and every pointer delta through flipX.
  const mirror = view === 'bb' && side === 'back'
  const flipX = mirror ? -1 : 1
  // Pin targets stay at least 12 screen px wide however far the view zooms out.
  const pinHit = Math.max(16, 12 / scale)
  // schematic wires bend on the fine grid; parts still snap pins to major
  const wireGrid = view === 'sch' ? GRID_SCH : GRID_BB
  const snap = (v: number): number => Math.round(v / wireGrid) * wireGrid
  // schematic wires are drawn in the symbols' own ink, so a wire reads as the
  // continuation of the lead it ends on (and matches the image export)
  const ink = INK
  const viewRef = React.useRef<HTMLDivElement>(null)
  const innerRef = React.useRef<HTMLDivElement>(null)

  const [armed, setArmed] = React.useState<Armed | null>(null)
  // part bodies a wire being drawn bends around (core/autoroute.drawingPath);
  // only needed while one is being drawn
  const walls = React.useMemo(
    () => (armed ? drawingWalls(doc, view) : { walls: [], soft: [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, view, !!armed, defsTick]
  )
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
    /** set once the pointer actually displaces; distinguishes board-hole clicks */
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
  const geomAll = React.useMemo(
    () => wireGeom.filter((g) => g.pts.length >= 2).map((g) => ({ id: g.w.id, points: g.pts })),
    [wireGeom]
  )
  // what clicks, hovers and junction drops can hit: in the breadboard view only
  // the wires on the face being shown (the other face's are drawn faintly)
  const geomForHit = React.useMemo(
    () =>
      view === 'bb'
        ? wireGeom
            .filter((g) => g.pts.length >= 2 && wireSide(g.w) === side)
            .map((g) => ({ id: g.w.id, points: g.pts }))
        : geomAll,
    [wireGeom, geomAll, view, side]
  )

  /** A pointer position in world coordinates (mirror-aware, see `mirror`). */
  const canvasPoint = (e: { clientX: number; clientY: number }): Pt => {
    const r = viewRef.current!.getBoundingClientRect()
    return {
      x: (flipX * (e.clientX - r.left - cam.tx)) / scale,
      y: (e.clientY - r.top - cam.ty) / scale
    }
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
        const others = geomAll.filter((g) => g.id !== w.id)
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
  }, [doc, geomAll, store, defsTick])

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
      // mirrored, the scene's left edge (minX) is on the right of the window
      tx: mirror
        ? (el.clientWidth + bw * f) / 2 + (b.minX - pad) * f
        : (el.clientWidth - bw * f) / 2 - (b.minX - pad) * f,
      ty: (el.clientHeight - bh * f) / 2 - (b.minY - pad) * f
    })
  }, [doc, setCam, view, mirror])

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
          x: (flipX * (el.clientWidth / 2 - cam.tx)) / scale,
          y: (el.clientHeight / 2 - cam.ty) / scale
        }
      }
    }),
    [fit, cam, scale, flipX]
  )

  const didFit = React.useRef(!fitOnMount)
  React.useEffect(() => {
    if (didFit.current) return
    if (doc.parts.length === 0 || doc.parts.every((p) => !p[view] || visualFor(p.type, view))) {
      fit()
      didFit.current = true
    }
  })

  // Turning the board over keeps whatever is in the middle of the window in the
  // middle: with the camera mirrored, the same world point sits at width - tx.
  // A half-drawn wire is dropped (it was being drawn on the other face).
  const lastFace = React.useRef({ view, mirror })
  React.useEffect(() => {
    const prev = lastFace.current
    lastFace.current = { view, mirror }
    if (prev.view !== view || prev.mirror === mirror) return
    setArmed(null)
    const el = viewRef.current
    if (el) setCam((c) => ({ ...c, tx: el.clientWidth - c.tx }))
  }, [view, mirror, setCam])

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
      view === 'bb' && part && isHoleBoard(part.type)
        ? [partId, ...seatedPartsOn(partId, seats)]
        : [partId]
    const moveIds = sel.parts.has(partId) ? [...sel.parts] : stickyIds
    if (!sel.parts.has(partId)) setSel({ parts: new Set([partId]), wires: new Set() })

    const grabbedPl = placementOf(partId)
    if (!grabbedPl) return
    const at = canvasPoint(e)
    const orig = new Map<string, Placement>()
    for (const id of moveIds) {
      const pl = doc.parts.find((p) => p.id === id)?.[view]
      if (pl) orig.set(id, pl)
    }
    partDrag.current = {
      ids: [...orig.keys()],
      grabbed: partId,
      offX: at.x - grabbedPl.x,
      offY: at.y - grabbedPl.y,
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
    const at = canvasPoint(e)
    const grabbedOrig = d.orig.get(d.grabbed)!
    const part = doc.parts.find((p) => p.id === d.grabbed)
    if (!part) return
    const raw: Placement = {
      ...grabbedOrig,
      x: at.x - d.offX,
      y: at.y - d.offY
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
      if (part && isHoleBoard(part.type)) {
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

  // drag a bendable leg tip (LED/resistor class parts, breadboard view only;
  // M2 leftover, spec §6.2/§7.4). `base` is the pin's leg offset at grab time
  // ([0,0] if it was resting). Live-dispatches like onLabelDown (merged
  // commands per move) so wires re-anchor to the tip in real time without a
  // separate dragOverrides path; nothing else needs to know this isn't a
  // normal edit. A real (>=3px) drag suppresses the trailing click so it
  // doesn't also arm/complete a wire from this pin.
  const beginLegDrag = (
    e: React.PointerEvent,
    partId: string,
    pin: string,
    base: [number, number]
  ): void => {
    const startClient = { x: e.clientX, y: e.clientY }
    let moved = false
    const move = (ev: PointerEvent): void => {
      const dxs = (flipX * (ev.clientX - startClient.x)) / scale
      const dys = (ev.clientY - startClient.y) / scale
      if (!moved && Math.hypot(dxs, dys) < 3) return
      moved = true
      const cur = doc.parts.find((p) => p.id === partId)?.[view]
      if (!cur) return
      // legOffset is added to the local pin coord BEFORE rotate/flip
      // (core/geometry pinWorld); invert that so dragging the tip on
      // screen moves it the direction the user is actually dragging.
      const rad = (-(cur.rotate ?? 0) * Math.PI) / 180
      let ldx = dxs * Math.cos(rad) - dys * Math.sin(rad)
      const ldy = dxs * Math.sin(rad) + dys * Math.cos(rad)
      if (cur.flip) ldx = -ldx
      const next: [number, number] = [
        Math.round((base[0] + ldx) * 100) / 100,
        Math.round((base[1] + ldy) * 100) / 100
      ]
      store.dispatch(
        cmd.placePart(
          partId,
          view,
          { ...cur, legs: { ...(cur.legs ?? {}), [pin]: next } },
          [],
          true
        )
      )
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) suppressClick.current = true
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
    else pts.push(...drawingPath(last, target, walls.walls, wireGrid, clean, walls.soft).slice(1))
    return { pts: simplifyWirePoints(pts), str }
  }

  const commitWire = (from: WireEnd, to: WireEnd, pts: Pt[], str: boolean): void => {
    // a schematic wire drawn pin to pin with no bends stays automatic: it
    // leaves each pin outward and follows its parts when they move
    const auto = view === 'sch' && armed?.points.length === 1 && typeof to === 'string'
    store.dispatch(
      cmd.addWire({
        from,
        to,
        view,
        ...(view === 'bb' ? { color: wireColor } : {}), // schematic wires are ink
        ...(mirror ? { side: 'back' as const } : {}), // drawn on the back, it runs on the back
        ...(auto ? {} : { route: journeyFromPoints(pts, str) })
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

  /** Output picking: resolve a click to its net and hand it to the shell,
   * along with the point clicked; that is where the tag lands. */
  const pickNetOf = (key: string, from: 'pin' | 'wire', at: Pt): boolean => {
    if (!pickNets) return false
    const idx = from === 'pin' ? netModel.pinToNet.get(key) : netModel.wireToNet.get(key)
    if (idx == null) return false
    onPickNet?.(idx, at)
    return true
  }

  /** The net under a world point, if the point is on a wire or a pin. */
  const netAtWorld = (wx: number, wy: number): number | undefined => {
    const pin = pinAtWorld(doc, wx, wy, 10 / scale, view)
    if (pin) return netModel.pinToNet.get(`${pin.id}:${pin.pin}`)
    const hit = hitWire(wx, wy, geomForHit, scale)
    if (hit) return netModel.wireToNet.get(hit.id)
    return undefined
  }

  const onPinClick = (e: React.MouseEvent, partId: string, pin: string): void => {
    const ref = `${partId}:${pin}`
    if (pickNets) {
      e.stopPropagation()
      pickNetOf(ref, 'pin', resolve(ref) ?? canvasPoint(e))
      return
    }
    if (!editable) return
    e.stopPropagation()
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
        : drawingPath(last, target, walls.walls, wireGrid, false, walls.soft)
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
    return null // v2 has no free-point endpoints; caller reverts
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
    if (pickNets) {
      pickNetOf(wireId, 'wire', canvasPoint(e))
      return
    }
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
        if (!rect) return // plain click; onCanvasClick handles deselect
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
    const files = Array.from(e.dataTransfer.files ?? []).filter((f) => /\.fzpz$/i.test(f.name))
    if (files.length && onImportFiles) {
      onImportFiles(files, canvasPoint(e))
      return
    }
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
      const c = rotateBoardAssemblyCmd(doc, boardId, seats, ROTATE_STEP / 90)
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
      isHoleBoard(doc.parts.find((p) => p.id === ids[0])?.type ?? '')
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
      const next = (((((cur.rotate ?? 0) + ROTATE_STEP) % 360) + 360) % 360) as 0 | 90 | 180 | 270
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
      // Bindings live in lib/shortcuts (the Keyboard Shortcuts dialog reads
      // the same list). Space = straight-wire modifier (Shift is reserved for
      // shift-select).
      if (matches(e, 'circuit.straightWire')) {
        setStraight(true)
        e.preventDefault()
        return
      }
      if (matches(e, 'circuit.cancel')) {
        setArmed(null)
        setSel(emptySel())
        return
      }
      if (!editable) return
      if (matches(e, 'circuit.undo')) {
        e.preventDefault()
        store.undo()
        return
      }
      if (matches(e, 'circuit.redo') || matches(e, 'circuit.redoAlt')) {
        e.preventDefault()
        store.redo()
        return
      }
      if (matches(e, 'circuit.copy')) {
        void copySelection()
        return
      }
      if (matches(e, 'circuit.cut')) {
        void copySelection().then((ok) => {
          if (ok) deleteSelection()
        })
        return
      }
      if (matches(e, 'circuit.paste')) {
        void navigator.clipboard.readText().then((text) => {
          const payload = parseClipboard(text)
          if (payload) pastePayload(payload)
        })
        return
      }
      if (matches(e, 'circuit.duplicate')) {
        e.preventDefault()
        const payload = buildClipboard(doc, sel.parts, sel.wires)
        if (payload) pastePayload(payload)
        return
      }
      if (matches(e, 'circuit.rotate')) {
        if (sel.parts.size) {
          e.preventDefault()
          rotateSelection()
        }
        return
      }
      if (matches(e, 'circuit.flip') && view === 'sch' && sel.parts.size) {
        // horizontal mirror, schematic only (spec §6.3 / B13)
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
      if (matches(e, 'circuit.delete')) {
        deleteSelection()
        return
      }
      const big = matches(e, 'circuit.nudgeBig')
      if ((big || matches(e, 'circuit.nudge')) && sel.parts.size) {
        e.preventDefault()
        const step = (view === 'sch' ? GRID_SCH : GRID_BB) * (big ? 5 : 1)
        const d = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step]
        }[e.key]
        // mirrored, the arrow keys still move things the way they point on screen
        if (d) nudgeSelection(flipX * d[0], d[1])
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
    nudgeSelection,
    flipX
  ])

  const isPartDragging = (): boolean => partDrag.current !== null

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
      ...drawingPath(last, target, walls.walls, wireGrid, clean, walls.soft).slice(1)
    ]
  }, [armed, mouse, hoverPin, hoverHole, straight, resolve, walls, wireGrid])

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
    // schematic: a dot wherever three or more conductors of one net meet
    if (view === 'sch') {
      const have = new Set(out.map((d) => `${d.pt.x},${d.pt.y}`))
      for (const pt of schematicJunctions(doc, wireGeom)) {
        if (have.has(`${pt.x},${pt.y}`)) continue
        out.push({ key: `t:${pt.x},${pt.y}`, pt, color: ink })
      }
    }
    return out
  }, [doc, resolve, wireGeom, view, ink])

  // ── probe tags ──────────────────────────────────────────────────────────────
  // A tag is dragged by its label. Dropping it on a wire or a pin re-anchors it
  // to that node; dropping it anywhere else just moves the label.

  const probeDrag = React.useRef<{ id: string; offX: number; offY: number } | null>(null)
  const [draggingProbe, setDraggingProbe] = React.useState<string | null>(null)

  const onProbeDown = (e: React.PointerEvent, tag: ProbeTag): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const start = canvasPoint(e)
    const d = { id: tag.id, offX: tag.x - start.x, offY: tag.y - start.y }
    probeDrag.current = d
    setDraggingProbe(tag.id)
    const move = (ev: PointerEvent): void => {
      if (!probeDrag.current) return
      const p = canvasPoint(ev)
      suppressClick.current = true
      onMoveProbe?.(d.id, { x: p.x + d.offX, y: p.y + d.offY })
    }
    const up = (ev: PointerEvent): void => {
      probeDrag.current = null
      setDraggingProbe(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const p = canvasPoint(ev)
      onMoveProbe?.(d.id, { x: p.x + d.offX, y: p.y + d.offY }, netAtWorld(p.x, p.y))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Contextual hint only while actively wiring/editing; no idle 'scroll to
  // zoom' / 'view-only' bubbles cluttering the canvas.
  // Simulate needs no instructions bar: the crosshair cursor says "click to
  // measure", and the tags explain themselves
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

  // The front of the breadboard is drawn in depth (PartLayer): wires lie on
  // the board under the parts standing on it, show through them faintly, and
  // are solid again where they cross a connection point. The schematic is
  // flat ink, and from the back every wire is on the near side: one layer.
  const layered = view === 'bb' && side === 'front'
  const joints = React.useMemo(
    () => (view === 'bb' ? solderJoints(doc, seats) : []),
    [view, doc, seats]
  )
  const soldered = React.useMemo(() => new Set(joints.map((j) => j.key)), [joints])
  const connPts = React.useMemo(() => {
    if (!layered) return []
    const out: { key: string; pt: Pt }[] = joints.map((j) => ({ key: j.key, pt: j.pos }))
    for (const p of doc.parts) {
      // boards sit under the wires already; their holes aren't crossings
      if (!p.bb || isHoleBoard(p.type) || isTinyHeaderBoard(p.type)) continue
      const vis = visualFor(p.type, 'bb')
      if (!vis) continue
      for (const pin of Object.keys(vis.v.pins)) {
        const pt = pinWorldOf(p, pin)
        if (pt) out.push({ key: `${p.id}:${pin}`, pt })
      }
    }
    return out
    // defsTick: a part's geometry arrives after its def loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layered, doc, joints, defsTick])

  return (
    <div className="flex-1 relative min-w-0 overflow-hidden">
      <div
        ref={viewRef}
        className="size-full overflow-hidden"
        style={{
          touchAction: 'none',
          cursor: armed || pickNets ? 'crosshair' : 'default',
          // the schematic is a sheet of paper with a faint square grid on the
          // pin pitch (CircuitLab); the breadboard keeps its dot grid
          backgroundColor: view === 'sch' ? 'var(--sch-paper)' : 'var(--bg-sunken)',
          backgroundImage: !grid
            ? 'none'
            : view === 'sch'
              ? 'linear-gradient(var(--sch-grid) 1px, transparent 1px), linear-gradient(90deg, var(--sch-grid) 1px, transparent 1px)'
              : 'radial-gradient(var(--dot-color) 1.1px, transparent 1.1px)',
          backgroundSize: `${GRID_BB * scale}px ${GRID_BB * scale}px`,
          // on the grid points themselves: a schematic line is the first
          // pixel of its cell (centred on the point by -0.5 px), a breadboard
          // dot sits mid-cell (pulled back half a cell). Uncorrected, the dots
          // fell between the holes and the lines half a pixel off every pin.
          backgroundPosition:
            view === 'sch'
              ? `${cam.tx - 0.5}px ${cam.ty - 0.5}px`
              : `${cam.tx - (GRID_BB * scale) / 2}px ${cam.ty - (GRID_BB * scale) / 2}px`
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
            transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${flipX * scale}, ${scale})`,
            transformOrigin: '0 0'
          }}
        >
          {layered && (
            <WireLayer
              mode="base"
              view={view}
              side={side}
              editable={editable}
              pickNets={pickNets}
              scale={scale}
              ink={ink}
              wireColor={wireColor}
              sel={sel}
              netModel={netModel}
              highlightNet={highlightNet}
              rats={rats}
              wireGeom={wireGeom}
              soloWire={soloWire}
              editPts={editPts}
              junctionDots={junctionDots}
              previewPts={previewPts}
              seats={seats}
              hoverHole={hoverHole}
              marquee={marquee}
              setHoverWire={setHoverWire}
              onWireClick={onWireClick}
              onWireDoubleClick={onWireDoubleClick}
              startHandleDrag={startHandleDrag}
            />
          )}

          <WireLayer
            mode={layered ? 'top' : 'all'}
            connPts={layered ? connPts : undefined}
            soldered={soldered}
            view={view}
            side={side}
            editable={editable}
            pickNets={pickNets}
            scale={scale}
            ink={ink}
            wireColor={wireColor}
            sel={sel}
            netModel={netModel}
            highlightNet={highlightNet}
            rats={rats}
            wireGeom={wireGeom}
            soloWire={soloWire}
            editPts={editPts}
            junctionDots={junctionDots}
            previewPts={previewPts}
            seats={seats}
            hoverHole={hoverHole}
            marquee={marquee}
            setHoverWire={setHoverWire}
            onWireClick={onWireClick}
            onWireDoubleClick={onWireDoubleClick}
            startHandleDrag={startHandleDrag}
          />

          <PartLayer
            store={store}
            doc={doc}
            view={view}
            backside={mirror}
            editable={editable}
            pickNets={pickNets}
            scale={scale}
            pinHit={pinHit}
            sel={sel}
            netModel={netModel}
            highlightNet={highlightNet}
            armed={armed}
            hoverPin={hoverPin}
            placementOf={placementOf}
            canvasPoint={canvasPoint}
            isPartDragging={isPartDragging}
            suppressClick={suppressClick}
            setHoverHole={setHoverHole}
            setHoverPin={setHoverPin}
            onPartDown={onPartDown}
            onLabelDown={onLabelDown}
            onPinClick={onPinClick}
            beginLegDrag={beginLegDrag}
            rotateBoardAssembly={rotateBoardAssembly}
            onRequestEdit={onRequestEdit}
            onPartClick={onPartClick}
            onPartDoubleClick={onPartDoubleClick}
            onPartPress={onPartPress}
            operable={operable}
            leds={leds}
          />

          {view === 'bb' && <SolderLayer doc={doc} seats={seats} zIndex={4} />}

          <NetLabelLayer
            doc={doc}
            view={view}
            editable={editable}
            pinHit={pinHit}
            sel={sel}
            netModel={netModel}
            armed={armed}
            hoverPin={hoverPin}
            dragOverrides={dragOverrides}
            setHoverPin={setHoverPin}
            onNetLabelDown={onNetLabelDown}
            onPinClick={onPinClick}
            onRequestEdit={onRequestEdit}
          />

          <Overlays
            scale={scale}
            flipX={flipX}
            netModel={netModel}
            hoverHole={hoverHole}
            simVoltageForNet={simVoltageForNet}
            annotations={annotations}
            probes={probes}
            draggingProbe={draggingProbe}
            onProbeDown={onProbeDown}
            onDeleteProbe={onDeleteProbe}
          />
        </div>
      </div>

      {/* Empty sheet: a note fixed to the middle of the window (not the
          panned/zoomed world), gone once the first part is placed. */}
      {doc.parts.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6">
          <p className="max-w-[340px] text-center text-sm text-[var(--text-muted)]">
            {editable
              ? 'Drag parts from the components rail, or double-click one to drop it here.'
              : 'Empty circuit. Click Edit to start placing parts.'}
          </p>
        </div>
      )}

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
