/**
 * DiagramEditor — renders a project's `diagram.json` as a live, editable circuit.
 * Parts come from the shared parts library (built-in tinyStudio boards + the
 * Fritzing-imported catalogue), drawn from their real SVG with a palette that
 * shows each part's icon. Draw orthogonal auto-routed wires pin-to-pin (with
 * waypoints), drag wire bends to re-route, switch breadboard/schematic views,
 * toggle a clean read-only view, and author/edit parts in the Parts Editor.
 * Every edit serializes back to the file in Wokwi `diagram.json` format.
 */

import {
  Braces,
  ChevronDown,
  ChevronRight,
  CircuitBoard,
  Grid3x3,
  Maximize,
  MousePointer2,
  Pencil,
  Plus,
  Eye,
  Spline,
  X,
  Zap,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import React from 'react'
import {
  ensureParts,
  getPart,
  loadPart,
  partsByFamily,
  registerPart,
  viewFor,
  type PartDef,
  type PartMeta,
  type ViewKind
} from '../lib/partsLibrary'
import {
  calculateOrthogonalPath,
  getWirePoints,
  instructionsFromPoints,
  moveSegment,
  ptsStr,
  simplifyWirePoints,
  type Connection,
  type PinRef,
  type Pt
} from '../lib/wireRouting'
import { PartsEditor } from './PartsEditor'

const CANVAS_W = 1100
const CANVAS_H = 640
const GRID = 9.6 // 100 mil (0.1in) at 96 DPI — the standard breadboard pitch

interface Part {
  id: string
  type: string
  left: number
  top: number
  rotate?: number // 0 | 90 | 180 | 270 (Wokwi-compatible)
  attrs?: Record<string, unknown>
}
// Per-view overrides for the schematic layout. The top-level parts/connections
// stay the Wokwi breadboard layout; the schematic view keeps its own positions
// and wire routes here so the two diagrams can diverge. A part/wire with no
// schematic entry falls back to its breadboard placement (until it's moved).
interface SchematicLayout {
  pos: Record<string, [number, number]> // partId -> [left, top]
  routes: Record<string, string[]> // connKey -> h/v instructions
}
interface Diagram {
  parts: Part[]
  connections: Connection[]
  author?: string
  schematic: SchematicLayout
}

const WIRE_COLORS = ['#36c46b', '#ff4d6d', '#00f0ff', '#f7a400', '#ffffff', '#9b6cff']

const uid = (): string => Math.random().toString(36).slice(2, 8)
const snap = (v: number): number => Math.round(v / GRID) * GRID

// read-compat: accept Wokwi left/top or the legacy x/y
function readPart(p: Record<string, unknown>): Part {
  return {
    id: String(p.id),
    type: String(p.type),
    left: Number(p.left ?? p.x ?? 0),
    top: Number(p.top ?? p.y ?? 0),
    rotate: p.rotate ? Number(p.rotate) : undefined,
    attrs: (p.attrs as Record<string, unknown>) || undefined
  }
}

// rotate a local point (px,py) around a part's centre by `deg` (CSS-rotate space)
function rotatePoint(px: number, py: number, w: number, h: number, deg: number): Pt {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = px - w / 2
  const dy = py - h / 2
  return { x: w / 2 + dx * cos - dy * sin, y: h / 2 + dx * sin + dy * cos }
}

// A small SVG thumbnail for the palette / part chips. Fritzing icon art is dark
// line-work meant for a light background, so we put it on a light chip (keeping
// its real colors) rather than flattening it to a silhouette.
function Thumb({ svg }: { svg?: string }): React.JSX.Element {
  if (!svg) return <CircuitBoard size={24} className="text-fg-2 shrink-0" />
  return (
    <div
      className="size-10 shrink-0 rounded-md bg-[#eef1f7] p-1 grid place-items-center [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export function DiagramEditor({
  content,
  onChange
}: {
  content: string
  onChange: (next: string) => void
}): React.JSX.Element {
  const diagram: Diagram = React.useMemo(() => {
    try {
      const d = JSON.parse(content || '{}')
      const sch = d.schematic || {}
      return {
        parts: (d.parts || []).map(readPart),
        connections: (d.connections || []) as Connection[],
        author: d.author,
        schematic: { pos: sch.pos || {}, routes: sch.routes || {} }
      }
    } catch {
      return { parts: [], connections: [], schematic: { pos: {}, routes: {} } }
    }
  }, [content])

  const [view, setView] = React.useState<ViewKind>('breadboard')
  const [editable, setEditable] = React.useState(false)
  const [grid, setGrid] = React.useState(true)
  const [showJson, setShowJson] = React.useState(false)
  const [editorPart, setEditorPart] = React.useState<PartDef | null | undefined>(undefined) // undefined = closed
  const [selPart, setSelPart] = React.useState<string | null>(null)
  const [selWire, setSelWire] = React.useState<number | null>(null)
  const [wireColor, setWireColor] = React.useState(WIRE_COLORS[0])
  const [armed, setArmed] = React.useState<{ from: string; points: Pt[] } | null>(null)
  const [hoverPin, setHoverPin] = React.useState<{ id: string; pin: string } | null>(null)
  const [mouse, setMouse] = React.useState<Pt>({ x: 0, y: 0 })
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  const [editPts, setEditPts] = React.useState<Pt[] | null>(null) // selected-wire editing buffer
  const [tick, force] = React.useReducer((n) => n + 1, 0)

  const viewRef = React.useRef<HTMLDivElement>(null)
  const innerRef = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<{ id: string; offX: number; offY: number } | null>(null)
  const pan = React.useRef<{ x: number; y: number } | null>(null)
  const handleDrag = React.useRef<{ idx: number } | null>(null)
  const [cam, setCam] = React.useState({ scale: 0.62, tx: 0, ty: 0 })
  const scale = cam.scale
  const didInit = React.useRef(false)

  React.useEffect(() => {
    const types = diagram.parts.map((p) => p.type).filter((t) => !getPart(t))
    if (types.length) ensureParts(types).then(force)
  }, [diagram.parts])

  const write = (d: Partial<Diagram>): void => {
    const sch = d.schematic || diagram.schematic
    const hasSch = Object.keys(sch.pos).length > 0 || Object.keys(sch.routes).length > 0
    const next = {
      version: 1,
      editor: 'tinystudio',
      author: diagram.author,
      parts: (d.parts || diagram.parts).map((p) => ({
        type: p.type,
        id: p.id,
        left: p.left,
        top: p.top,
        ...(p.rotate ? { rotate: p.rotate } : {}),
        ...(p.attrs ? { attrs: p.attrs } : {})
      })),
      connections: d.connections || diagram.connections,
      ...(hasSch ? { schematic: sch } : {})
    }
    onChange(JSON.stringify(next, null, 2))
  }

  // ── per-view layout helpers ─────────────────────────────────────────────────

  const refStr = (r: PinRef): string => (typeof r === 'string' ? r : `${r.x},${r.y}`)
  const connKey = (c: Connection): string => `${refStr(c[0])}>${refStr(c[1])}`
  // position of a part in the *current* view (schematic falls back to breadboard)
  const partXY = (part: Part): [number, number] =>
    view === 'schematic'
      ? diagram.schematic.pos[part.id] || [part.left, part.top]
      : [part.left, part.top]
  // wire route in the current view (schematic starts clean, then diverges)
  const routeFor = (c: Connection): string[] =>
    view === 'schematic' ? (diagram.schematic.routes[connKey(c)] ?? []) : c[3] || []
  const wirePts = (c: Connection): Pt[] =>
    getWirePoints([c[0], c[1], c[2], routeFor(c)] as Connection, resolve)

  // ── geometry ──────────────────────────────────────────────────────────────

  const pinAbs = (part: Part, pin: string): Pt | null => {
    const def = getPart(part.type)
    if (!def) return null
    const v = viewFor(def, view)
    const p = v?.pins[pin]
    if (!p) return null
    const [left, top] = partXY(part)
    const rp = part.rotate ? rotatePoint(p[0], p[1], v!.w, v!.h, part.rotate) : { x: p[0], y: p[1] }
    return { x: left + rp.x, y: top + rp.y }
  }
  const resolve = (ref: PinRef): Pt | null => {
    if (typeof ref === 'object') return ref
    const [id, pin] = ref.split(':')
    const part = diagram.parts.find((p) => p.id === id)
    return part ? pinAbs(part, pin) : null
  }
  const canvasPoint = (e: { clientX: number; clientY: number }): Pt => {
    const r = innerRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }
  }

  // ── camera ──────────────────────────────────────────────────────────────────

  // Fit to the actual content (parts + wires) with a little padding, not the
  // whole 1100×640 canvas — so the circuit fills the viewport instead of floating
  // tiny in the middle. Falls back to centering the canvas when empty.
  const fitView = (): void => {
    const el = viewRef.current
    if (!el) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const part of diagram.parts) {
      const def = getPart(part.type)
      const v = def && viewFor(def, view)
      if (!v) continue
      const [l, t] = partXY(part)
      minX = Math.min(minX, l)
      minY = Math.min(minY, t)
      maxX = Math.max(maxX, l + v.w)
      maxY = Math.max(maxY, t + v.h)
    }
    for (const c of diagram.connections) {
      for (const p of wirePts(c)) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
    }
    if (!isFinite(minX)) {
      // empty — center the canvas at a comfortable zoom
      const f = Math.min(el.clientWidth / CANVAS_W, el.clientHeight / CANVAS_H, 1)
      setCam({
        scale: f,
        tx: (el.clientWidth - CANVAS_W * f) / 2,
        ty: (el.clientHeight - CANVAS_H * f) / 2
      })
      return
    }
    const pad = 40
    minX -= pad
    minY -= pad
    maxX += pad
    maxY += pad
    const bw = maxX - minX
    const bh = maxY - minY
    const f = Math.max(0.25, Math.min(3, Math.min(el.clientWidth / bw, el.clientHeight / bh)))
    setCam({
      scale: f,
      tx: (el.clientWidth - bw * f) / 2 - minX * f,
      ty: (el.clientHeight - bh * f) / 2 - minY * f
    })
  }
  // initial fit, and one more once the referenced parts have loaded (so sizes are known)
  React.useEffect(() => {
    if (didInit.current) return
    if (diagram.parts.length === 0 || diagram.parts.every((p) => getPart(p.type))) {
      fitView()
      didInit.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, tick])

  const zoomAt = (factor: number, sx: number, sy: number): void => {
    setCam((c) => {
      const ns = Math.max(0.25, Math.min(3, c.scale * factor))
      const k = ns / c.scale
      return { scale: ns, tx: sx - (sx - c.tx) * k, ty: sy - (sy - c.ty) * k }
    })
  }
  const zoomCenter = (factor: number): void => {
    const el = viewRef.current
    if (el) zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2)
  }
  const onWheel = (e: React.WheelEvent): void => {
    const rect = viewRef.current!.getBoundingClientRect()
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top)
  }
  const onViewPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 1 && !(e.button === 0 && e.altKey)) return
    e.preventDefault()
    pan.current = { x: e.clientX, y: e.clientY }
    window.addEventListener('pointermove', onPanMove)
    window.addEventListener('pointerup', onPanUp)
  }
  const onPanMove = (e: PointerEvent): void => {
    const p = pan.current
    if (!p) return
    setCam((c) => ({ ...c, tx: c.tx + (e.clientX - p.x), ty: c.ty + (e.clientY - p.y) }))
    pan.current = { x: e.clientX, y: e.clientY }
  }
  const onPanUp = (): void => {
    pan.current = null
    window.removeEventListener('pointermove', onPanMove)
    window.removeEventListener('pointerup', onPanUp)
  }

  // ── part drag ─────────────────────────────────────────────────────────────

  const onPartDown = (e: React.PointerEvent, part: Part): void => {
    if (!editable || (e.target as HTMLElement).closest('.pin-hit')) return
    e.stopPropagation()
    setSelPart(part.id)
    selectWire(null)
    const r = innerRef.current!.getBoundingClientRect()
    const [left, top] = partXY(part)
    drag.current = {
      id: part.id,
      offX: (e.clientX - r.left) / scale - left,
      offY: (e.clientY - r.top) / scale - top
    }
    window.addEventListener('pointermove', onPartMove)
    window.addEventListener('pointerup', onPartUp)
  }
  const onPartMove = (e: PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const r = innerRef.current!.getBoundingClientRect()
    const nx = snap((e.clientX - r.left) / scale - d.offX)
    const ny = snap((e.clientY - r.top) / scale - d.offY)
    if (view === 'schematic') {
      // schematic moves are independent — store in the overlay, leave breadboard alone
      write({
        schematic: { ...diagram.schematic, pos: { ...diagram.schematic.pos, [d.id]: [nx, ny] } }
      })
    } else {
      write({ parts: diagram.parts.map((p) => (p.id === d.id ? { ...p, left: nx, top: ny } : p)) })
    }
  }
  const onPartUp = (): void => {
    drag.current = null
    window.removeEventListener('pointermove', onPartMove)
    window.removeEventListener('pointerup', onPartUp)
  }

  // ── wiring ──────────────────────────────────────────────────────────────────

  const selectWire = (i: number | null): void => {
    setSelWire(i)
    setEditPts(i == null ? null : wirePts(diagram.connections[i]))
  }

  const onPinClick = (e: React.MouseEvent, part: Part, pin: string): void => {
    if (!editable) return
    e.stopPropagation()
    const ref = `${part.id}:${pin}`
    const pos = pinAbs(part, pin)
    if (!pos) return
    if (!armed) {
      setArmed({ from: ref, points: [pos] })
      setSelPart(null)
      selectWire(null)
      return
    }
    if (armed.from === ref) {
      setArmed(null)
      return
    }
    // finalize using the SAME clean-entry routing the live preview showed, so the
    // committed wire matches what you saw (no L→7 mirror flip on click)
    const pts = [...armed.points]
    const last = pts[pts.length - 1]
    pts.push(...calculateOrthogonalPath(last.x, last.y, pos.x, pos.y, true).slice(1))
    const instr = instructionsFromPoints(simplifyWirePoints(pts))
    const exists = diagram.connections.some(
      (c) => (c[0] === armed.from && c[1] === ref) || (c[0] === ref && c[1] === armed.from)
    )
    if (!exists) {
      if (view === 'schematic') {
        // store the route in the schematic overlay; the breadboard route stays empty
        const conn: Connection = [armed.from, ref, wireColor]
        write({
          connections: [...diagram.connections, conn],
          schematic: {
            ...diagram.schematic,
            routes: { ...diagram.schematic.routes, [connKey(conn)]: instr }
          }
        })
      } else {
        write({ connections: [...diagram.connections, [armed.from, ref, wireColor, instr]] })
      }
    }
    setArmed(null)
  }

  const onCanvasClick = (e: React.MouseEvent): void => {
    if (armed) {
      const cp = canvasPoint(e)
      const target = { x: snap(cp.x), y: snap(cp.y) }
      const last = armed.points[armed.points.length - 1]
      const pts = [
        ...armed.points,
        ...calculateOrthogonalPath(last.x, last.y, target.x, target.y, false).slice(1)
      ]
      setArmed({ ...armed, points: pts })
      return
    }
    setSelPart(null)
    selectWire(null)
  }
  const onCanvasMove = (e: React.PointerEvent): void => {
    if (armed) setMouse(canvasPoint(e))
  }

  // ── wire editing — drag a whole segment perpendicular (Fritzing-style) ───────

  const startHandleDrag = (e: React.PointerEvent, idx: number): void => {
    if (!editable || selWire == null || !editPts) return
    e.stopPropagation()
    const wireIdx = selWire
    const original = editPts
    const horizontal = Math.abs(original[idx].y - original[idx + 1].y) < 0.001
    let live = original
    handleDrag.current = { idx }
    const move = (ev: PointerEvent): void => {
      const cp = canvasPoint(ev)
      // a horizontal segment moves in y, a vertical one in x — snapped to the grid
      const perp = horizontal ? snap(cp.y) : snap(cp.x)
      live = moveSegment(original, idx, perp)
      setEditPts(live)
    }
    const up = (): void => {
      handleDrag.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      // commit (outside any state updater): instructionsFromPoints orthogonalizes
      // any diagonal drag into clean h/v moves
      const c = diagram.connections[wireIdx]
      if (!c) return
      const instr = instructionsFromPoints(simplifyWirePoints(live))
      if (view === 'schematic') {
        write({
          schematic: {
            ...diagram.schematic,
            routes: { ...diagram.schematic.routes, [connKey(c)]: instr }
          }
        })
      } else {
        const conns = diagram.connections.slice()
        const nc = c.slice() as Connection
        nc[3] = instr
        conns[wireIdx] = nc
        write({ connections: conns })
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const rerouteWire = (i: number): void => {
    // double-click: clear the route so it auto-routes cleanly (kills loops)
    const c = diagram.connections[i]
    if (!c) return
    if (view === 'schematic') {
      const routes = { ...diagram.schematic.routes }
      delete routes[connKey(c)]
      write({ schematic: { ...diagram.schematic, routes } })
      setEditPts(wirePts([c[0], c[1], c[2]] as Connection))
    } else {
      const conns = diagram.connections.slice()
      const nc = c.slice() as Connection
      nc[3] = []
      conns[i] = nc
      write({ connections: conns })
      setEditPts(getWirePoints(nc, resolve))
    }
  }

  // keep the edit buffer in sync when the wire/route changes externally
  React.useEffect(() => {
    if (selWire != null && !handleDrag.current) {
      const c = diagram.connections[selWire]
      if (c) setEditPts(wirePts(c))
      else selectWire(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, view])

  // ── palette / add / delete ──────────────────────────────────────────────────

  const addPart = async (type: string, at?: Pt): Promise<void> => {
    const def = getPart(type) || (await loadPart(type))
    if (!def) return
    force()
    const v = viewFor(def, view)
    const w = v?.w || 80
    const h = v?.h || 40
    const left = at ? Math.round(at.x - w / 2) : Math.round(CANVAS_W / 2 - w / 2)
    const top = at ? Math.round(at.y - h / 2) : Math.round(CANVAS_H / 2 - h / 2)
    const pid = type + '_' + uid().slice(0, 3)
    const parts = [...diagram.parts, { id: pid, type, left, top }]
    // when adding in schematic view, pin its schematic position to the drop point
    write(
      view === 'schematic'
        ? {
            parts,
            schematic: {
              ...diagram.schematic,
              pos: { ...diagram.schematic.pos, [pid]: [left, top] }
            }
          }
        : { parts }
    )
    setSelPart(pid)
  }
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const type = e.dataTransfer.getData('text/tinystudio-part')
    if (type) addPart(type, canvasPoint(e))
  }

  const editExisting = async (type: string): Promise<void> => {
    const def = getPart(type) || (await loadPart(type))
    if (def) setEditorPart(def)
  }

  // rotate a part 90° (shared orientation across views); works mid-drag too
  const rotatePart = (id: string): void => {
    write({
      parts: diagram.parts.map((p) =>
        p.id === id ? { ...p, rotate: ((p.rotate || 0) + 90) % 360 } : p
      )
    })
  }

  React.useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return
      // spacebar / R rotates the dragging or selected part
      if (editable && (e.key === ' ' || e.key === 'r' || e.key === 'R')) {
        const id = drag.current?.id || selPart
        if (id) {
          e.preventDefault()
          rotatePart(id)
          return
        }
      }
      if (e.key === 'Escape') {
        setArmed(null)
        setSelPart(null)
        selectWire(null)
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return
        if (selWire != null) {
          const gone = diagram.connections[selWire]
          const routes = { ...diagram.schematic.routes }
          if (gone) delete routes[connKey(gone)]
          write({
            connections: diagram.connections.filter((_, j) => j !== selWire),
            schematic: { ...diagram.schematic, routes }
          })
          selectWire(null)
        } else if (selPart) {
          const keep = (c: Connection): boolean =>
            (typeof c[0] !== 'string' || c[0].split(':')[0] !== selPart) &&
            (typeof c[1] !== 'string' || c[1].split(':')[0] !== selPart)
          const routes = { ...diagram.schematic.routes }
          const pos = { ...diagram.schematic.pos }
          delete pos[selPart]
          diagram.connections.forEach((c) => {
            if (!keep(c)) delete routes[connKey(c)]
          })
          write({
            parts: diagram.parts.filter((p) => p.id !== selPart),
            connections: diagram.connections.filter(keep),
            schematic: { pos, routes }
          })
          setSelPart(null)
        }
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [selPart, selWire, diagram])

  const previewPts = React.useMemo((): Pt[] | null => {
    if (!armed) return null
    const last = armed.points[armed.points.length - 1]
    let target = { x: snap(mouse.x), y: snap(mouse.y) }
    let clean = false
    if (hoverPin) {
      const part = diagram.parts.find((p) => p.id === hoverPin.id)
      const pos = part && pinAbs(part, hoverPin.pin)
      if (pos) {
        target = pos
        clean = true
      }
    }
    return [
      ...armed.points,
      ...calculateOrthogonalPath(last.x, last.y, target.x, target.y, clean).slice(1)
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, mouse, hoverPin, diagram.parts, view])

  const isAI = (diagram.author || '').includes('Studio AI')
  const tool =
    'h-8 px-2.5 flex items-center gap-1.5 rounded-lg bg-navy-700/80 border border-navy-500 text-fg-2 text-xs hover:bg-navy-500 hover:text-fg-1 transition-colors'
  const families = partsByFamily()
  const isOpen = (fam: string): boolean => !collapsed.has(fam)
  const toggleFam = (fam: string): void =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(fam)) n.delete(fam)
      else n.add(fam)
      return n
    })

  return (
    <div className="size-full relative flex bg-navy-900 overflow-hidden">
      {/* components rail (edit mode only) */}
      {editable && (
        <div className="w-52 shrink-0 min-h-0 relative z-20 border-r border-navy-600 bg-navy-800 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-navy-600 shrink-0">
            <span className="text-[11px] font-semibold tracking-[0.16em] text-fg-3">
              COMPONENTS
            </span>
            <button
              className="text-fg-3 hover:text-cyan"
              title="New part…"
              onClick={() => setEditorPart(null)}
            >
              <Plus size={15} />
            </button>
          </div>
          {/* wire color — kept at the top so it's always visible */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-navy-600 shrink-0">
            <span className="text-[10px] text-fg-4 mr-1">Wire</span>
            {WIRE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setWireColor(c)}
                className="w-4 h-4 rounded-full border-2"
                style={{
                  background: c,
                  borderColor: wireColor === c ? 'var(--fg-1)' : 'transparent'
                }}
              />
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1">
            {families.map((group) => (
              <div key={group.family}>
                <button
                  className="w-full flex items-center gap-1 px-1 py-1 text-[10px] uppercase tracking-wider text-fg-4 hover:text-fg-2"
                  onClick={() => toggleFam(group.family)}
                >
                  {isOpen(group.family) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span className="truncate">{group.family}</span>
                  <span className="ml-auto text-fg-4/70">{group.parts.length}</span>
                </button>
                {isOpen(group.family) && (
                  <div className="flex flex-col gap-1 pb-1">
                    {group.parts.map((c: PartMeta) => (
                      <div
                        key={c.type}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/tinystudio-part', c.type)}
                        onDoubleClick={() => addPart(c.type)}
                        className="group flex items-center gap-2 px-2 py-1.5 rounded-lg border border-navy-600 bg-navy-700/50 hover:bg-navy-600 cursor-grab active:cursor-grabbing"
                        title={`${c.label} — drag onto the canvas (or double-click)`}
                      >
                        <Thumb svg={c.icon} />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-fg-1 truncate">{c.label}</div>
                          <div className="text-[10px] text-fg-4 truncate">{c.pins} pins</div>
                        </div>
                        <button
                          className="opacity-0 group-hover:opacity-100 text-fg-4 hover:text-cyan"
                          title="Edit this part"
                          onClick={(e) => {
                            e.stopPropagation()
                            editExisting(c.type)
                          }}
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* canvas + tools */}
      <div className="flex-1 relative min-w-0 overflow-hidden">
        <div className="absolute top-3 left-3 z-10 flex gap-1.5">
          {/* view/edit — icon-only toggle (defaults to view) */}
          <button
            className={`${tool} w-8 justify-center px-0 ${editable ? 'text-cyan border-cyan/40' : ''}`}
            onClick={() => {
              setEditable((v) => !v)
              setArmed(null)
              setSelPart(null)
              selectWire(null)
            }}
            title={editable ? 'Editing — click for view-only' : 'View-only — click to edit'}
          >
            {editable ? <Eye size={15} /> : <Pencil size={15} />}
          </button>
          {/* breadboard / schematic — icon toggle */}
          <button
            className={`${tool} w-8 justify-center px-0`}
            onClick={() => setView((v) => (v === 'breadboard' ? 'schematic' : 'breadboard'))}
            title={
              view === 'breadboard'
                ? 'Breadboard view — click for schematic'
                : 'Schematic view — click for breadboard'
            }
          >
            {view === 'breadboard' ? <CircuitBoard size={15} /> : <Spline size={15} />}
          </button>
        </div>

        <div className="absolute top-3 z-10 flex gap-1.5" style={{ right: showJson ? 374 : 14 }}>
          <button
            className={`${tool} w-8 justify-center px-0 ${grid ? 'text-cyan border-cyan/40' : ''}`}
            onClick={() => setGrid((g) => !g)}
            title="Toggle grid"
          >
            <Grid3x3 size={15} />
          </button>
          <button
            className={`${tool} ${showJson ? 'text-cyan border-cyan/40' : ''}`}
            onClick={() => setShowJson((s) => !s)}
          >
            <Braces size={15} /> JSON
          </button>
        </div>

        {/* zoom / fit — bottom-right */}
        <div className="absolute bottom-3 z-10 flex gap-1.5" style={{ right: showJson ? 374 : 14 }}>
          <button
            className={`${tool} w-8 justify-center px-0`}
            onClick={() => zoomCenter(1 / 1.15)}
            title="Zoom out"
          >
            <ZoomOut size={15} />
          </button>
          <span className={`${tool} pointer-events-none min-w-[52px] justify-center`}>
            {Math.round(scale * 100)}%
          </span>
          <button
            className={`${tool} w-8 justify-center px-0`}
            onClick={() => zoomCenter(1.15)}
            title="Zoom in"
          >
            <ZoomIn size={15} />
          </button>
          <button
            className={`${tool} w-8 justify-center px-0`}
            onClick={fitView}
            title="Fit to view"
          >
            <Maximize size={15} />
          </button>
        </div>

        <div
          ref={viewRef}
          className="size-full overflow-hidden"
          style={{
            touchAction: 'none',
            cursor: armed ? 'crosshair' : 'default',
            backgroundColor: '#1c2647',
            backgroundImage: grid
              ? 'radial-gradient(circle, rgba(255,255,255,0.10) 0.8px, transparent 1px)'
              : 'none',
            backgroundSize: `${22 * scale}px ${22 * scale}px`,
            backgroundPosition: `${cam.tx}px ${cam.ty}px`
          }}
          onWheel={onWheel}
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
              width: CANVAS_W,
              height: CANVAS_H,
              transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${scale})`,
              transformOrigin: '0 0'
            }}
          >
            {/* wires render ABOVE part bodies (zIndex 5); the svg itself ignores
                pointer events so clicks fall through to parts/pins, while each
                wire <g> and the handles opt back in */}
            <svg
              width={CANVAS_W}
              height={CANVAS_H}
              style={{
                position: 'absolute',
                inset: 0,
                overflow: 'visible',
                zIndex: 5,
                pointerEvents: 'none'
              }}
            >
              {diagram.connections.map((c, i) => {
                const pts = selWire === i && editPts ? editPts : wirePts(c)
                if (pts.length < 2) return null
                const sel = selWire === i
                // schematic wires are all white; breadboard keeps the chosen color
                const wcolor = view === 'schematic' ? '#ffffff' : (c[2] as string) || '#36c46b'
                return (
                  <g
                    key={i}
                    style={{
                      cursor: editable ? 'pointer' : 'default',
                      pointerEvents: editable ? 'stroke' : 'none'
                    }}
                    onClick={(e) => {
                      if (!editable) return
                      e.stopPropagation()
                      selectWire(i)
                      setSelPart(null)
                    }}
                    onDoubleClick={(e) => {
                      if (!editable) return
                      e.stopPropagation()
                      rerouteWire(i)
                    }}
                  >
                    {/* thinner, glossy tube: dark edge → color → soft white sheen */}
                    <polyline
                      points={ptsStr(pts)}
                      fill="none"
                      stroke="rgba(0,0,0,0.35)"
                      strokeWidth={4}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    <polyline
                      points={ptsStr(pts)}
                      fill="none"
                      stroke={wcolor}
                      strokeWidth={2.8}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    <polyline
                      points={ptsStr(pts)}
                      fill="none"
                      stroke="rgba(255,255,255,0.45)"
                      strokeWidth={0.9}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {sel && (
                      <polyline
                        points={ptsStr(pts)}
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth={1.5}
                        strokeDasharray="5 5"
                        strokeLinejoin="round"
                      />
                    )}
                  </g>
                )
              })}

              {previewPts && (
                <polyline
                  points={ptsStr(previewPts)}
                  fill="none"
                  stroke={view === 'schematic' ? '#ffffff' : wireColor}
                  strokeWidth={2.8}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={0.6}
                />
              )}

              {/* one handle per segment — drag it to slide the whole segment */}
              {editable && selWire != null && editPts && (
                <g style={{ pointerEvents: 'auto' }}>
                  {editPts.slice(0, -1).map((p, i) => {
                    const q = editPts[i + 1]
                    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
                    const horizontal = Math.abs(p.y - q.y) < 0.001
                    return (
                      <rect
                        key={`s${i}`}
                        x={m.x - (horizontal ? 6 : 3)}
                        y={m.y - (horizontal ? 3 : 6)}
                        width={horizontal ? 12 : 6}
                        height={horizontal ? 6 : 12}
                        rx={2}
                        fill="var(--cyan)"
                        stroke="#fff"
                        strokeWidth={1}
                        style={{ cursor: horizontal ? 'ns-resize' : 'ew-resize' }}
                        onPointerDown={(e) => startHandleDrag(e, i)}
                      />
                    )
                  })}
                </g>
              )}
            </svg>

            {diagram.parts.map((part) => {
              const def = getPart(part.type)
              const v = def && viewFor(def, view)
              const [pLeft, pTop] = partXY(part)
              if (!def || !v) {
                return (
                  <div
                    key={part.id}
                    style={{ position: 'absolute', left: pLeft, top: pTop, zIndex: 2 }}
                    className="px-2 py-1 rounded bg-navy-700 border border-navy-500 text-[10px] text-fg-4"
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
                    left: pLeft,
                    top: pTop,
                    width: v.w,
                    height: v.h,
                    zIndex: 2,
                    transform: part.rotate ? `rotate(${part.rotate}deg)` : undefined,
                    transformOrigin: 'center',
                    outline: selPart === part.id ? '2px solid var(--cyan)' : 'none',
                    outlineOffset: 4,
                    borderRadius: 6,
                    cursor: editable ? 'move' : 'default'
                  }}
                  onPointerDown={(e) => onPartDown(e, part)}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => {
                    if (!editable) return
                    e.preventDefault()
                    rotatePart(part.id)
                  }}
                >
                  <div
                    className="size-full [&>svg]:size-full [&>svg]:block pointer-events-none select-none"
                    dangerouslySetInnerHTML={{ __html: v.svg }}
                  />
                  {editable &&
                    Object.keys(v.pins).map((pin) => {
                      const [px, py] = v.pins[pin]
                      const on =
                        (armed && armed.from === `${part.id}:${pin}`) ||
                        (hoverPin?.id === part.id && hoverPin?.pin === pin)
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
                          onClick={(e) => onPinClick(e, part, pin)}
                        >
                          <svg width="16" height="16">
                            <circle
                              cx="8"
                              cy="8"
                              r={on ? 3 : 2.2}
                              fill={on ? 'var(--cyan)' : '#ffffff'}
                              fillOpacity={on ? 1 : 0.8}
                              stroke={on ? 'var(--cyan-bright)' : 'rgba(255,255,255,0.4)'}
                              strokeWidth="1"
                            />
                          </svg>
                        </div>
                      )
                    })}
                  <div
                    className="absolute text-[11px] text-fg-2 whitespace-nowrap pointer-events-none"
                    style={{ left: 0, top: v.h + 4 }}
                  >
                    {def.label}
                  </div>
                </div>
              )
            })}

            {diagram.parts.length === 0 && (
              <div
                className="absolute flex flex-col items-center gap-2 text-fg-4 text-sm text-center"
                style={{ left: CANVAS_W / 2 - 160, top: CANVAS_H / 2 - 40, width: 320 }}
              >
                <CircuitBoard size={42} />
                <div>
                  Drag parts from the Components rail — or double-click one to drop it here.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* footer */}
        <div className="absolute bottom-3 left-3 z-10 flex gap-2 text-[11px]">
          <span className="px-2.5 py-1 rounded-full bg-navy-700/80 border border-navy-500 font-mono text-fg-2">
            Parts: {diagram.parts.length} · Connections: {diagram.connections.length}
          </span>
          {isAI && (
            <span className="px-2.5 py-1 rounded-full bg-navy-700/80 border border-pink/40 text-pink-bright flex items-center gap-1">
              Auto-wired by Studio AI
            </span>
          )}
          {!editable ? (
            <span className="px-2.5 py-1 rounded-full bg-navy-700/80 border border-navy-500 text-fg-4 flex items-center gap-1">
              <Eye size={12} /> View-only · click Edit to make changes
            </span>
          ) : armed ? (
            <span className="px-2.5 py-1 rounded-full bg-navy-700/80 border border-cyan/40 text-cyan flex items-center gap-1">
              <Zap size={12} /> Click a pin to connect · click empty space for a bend · Esc to
              cancel
            </span>
          ) : selWire != null ? (
            <span className="px-2.5 py-1 rounded-full bg-navy-700/80 border border-cyan/40 text-cyan flex items-center gap-1">
              Drag a handle to slide that segment · double-click wire to auto-route · Del to remove
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-full bg-navy-700/80 border border-navy-500 text-fg-4 flex items-center gap-1">
              <MousePointer2 size={12} /> Scroll to zoom · middle/Alt-drag to pan · click a pin to
              wire
            </span>
          )}
        </div>

        {showJson && (
          <div className="absolute top-0 right-0 h-full w-[360px] bg-navy-1000 border-l border-navy-600 flex flex-col z-20">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-navy-600">
              <Braces size={16} className="text-cyan" />
              <span className="font-mono text-sm text-fg-1">diagram.json</span>
              <span className="text-[11px] text-fg-3">Wokwi format</span>
              <div className="flex-1" />
              <button className="text-fg-3 hover:text-fg-1" onClick={() => setShowJson(false)}>
                <X size={15} />
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-3 text-[11px] font-mono text-fg-2 whitespace-pre-wrap">
              {content}
            </pre>
          </div>
        )}
      </div>

      {editorPart !== undefined && (
        <PartsEditor
          initial={editorPart}
          onClose={() => setEditorPart(undefined)}
          onSave={(def: PartDef) => {
            registerPart(def)
            force()
            setEditorPart(undefined)
          }}
        />
      )}
    </div>
  )
}
