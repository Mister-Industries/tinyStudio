/**
 * DiagramEditor — renders a project's `diagram.json` as a live, editable circuit
 * inside its own editor tab (not a separate window). Drag parts from the rail,
 * move them, click pins to wire them, toggle a Wokwi-style JSON view. Every edit
 * is serialized straight back to the file via onChange so it stays a normal tab
 * you can rearrange and edit alongside code.
 */

import { Braces, CircuitBoard, Grid3x3, Maximize, MousePointer2, X, Zap, ZoomIn, ZoomOut } from 'lucide-react'
import React from 'react'

const CANVAS_W = 1100
const CANVAS_H = 640

interface Part {
  id: string
  type: string
  x: number
  y: number
}
type Connection = [string, string, string?]
interface Diagram {
  parts: Part[]
  connections: Connection[]
  author?: string
}

// Part geometry: size + pin offsets (canvas units from the part's top-left).
const PART_GEO: Record<
  string,
  { w: number; h: number; label: string; sub?: string; accent?: string; pins: Record<string, [number, number]> }
> = {
  tinycore: {
    w: 150, h: 150, label: 'tinyCore', sub: 'ESP32-S3', accent: 'var(--cyan)',
    pins: { '3V3': [8, 70], GND: [8, 96], SIG: [142, 58], D3: [142, 78], D4: [142, 98], D5: [142, 118], D9: [74, 142] }
  },
  tinyglow: { w: 104, h: 104, label: 'tinyGlow', accent: 'var(--pink)', pins: { VCC: [6, 40], GND: [6, 64], DIN: [98, 52] } },
  tinyproto: { w: 120, h: 100, label: 'tinyProto', pins: { '+': [6, 30], '-': [6, 54], A: [114, 30], B: [114, 54] } },
  tinydisplay: { w: 120, h: 100, label: 'tinyDisplay', pins: { VCC: [6, 24], GND: [6, 48], SDA: [114, 24], SCL: [114, 48] } },
  tinysniff: { w: 110, h: 100, label: 'tinySniff', pins: { VCC: [6, 24], GND: [6, 48], SDA: [104, 24], SCL: [104, 48] } },
  button: { w: 70, h: 70, label: 'Push button', pins: { '1': [4, 18], '2': [66, 18] } },
  resistor: { w: 110, h: 36, label: '1 kΩ', pins: { a: [2, 18], b: [108, 18] } },
  led: { w: 52, h: 70, label: 'LED', accent: 'var(--pink)', pins: { A: [16, 66], K: [36, 66] } }
}

const PALETTE = [
  { id: 'tinycore', label: 'tinyCore', desc: 'ESP32-S3 board' },
  { id: 'tinyglow', label: 'tinyGlow', desc: 'RGB LED · WS2812' },
  { id: 'tinyproto', label: 'tinyProto', desc: 'Prototyping module' },
  { id: 'tinydisplay', label: 'tinyDisplay', desc: 'OLED · I²C' },
  { id: 'led', label: 'LED', desc: '5mm diffused' },
  { id: 'resistor', label: 'Resistor', desc: '1 kΩ' },
  { id: 'button', label: 'Push button', desc: 'Momentary' }
]

const WIRE_COLORS = ['#36c46b', '#ff4d6d', '#00f0ff', '#f7a400', '#ffffff', '#9b6cff']

function pinPos(part: Part, pin: string): [number, number] {
  const g = PART_GEO[part.type]
  if (!g || !g.pins[pin]) return [part.x, part.y]
  return [part.x + g.pins[pin][0], part.y + g.pins[pin][1]]
}
function routePts(a: [number, number], b: [number, number]): [number, number][] {
  const mx = (a[0] + b[0]) / 2
  return [a, [mx, a[1]], [mx, b[1]], b]
}
const ptsStr = (pts: [number, number][]): string => pts.map((p) => p.join(',')).join(' ')
const uid = (): string => Math.random().toString(36).slice(2, 8)

function VectorPart({ type }: { type: string }): React.JSX.Element | null {
  if (type === 'button')
    return (
      <svg width="70" height="70" viewBox="0 0 70 70">
        <rect x="8" y="8" width="54" height="54" rx="6" fill="#0e1320" stroke="#2b3346" strokeWidth="1.5" />
        <circle cx="35" cy="35" r="15" fill="#cfd6e4" stroke="#9aa3b6" strokeWidth="2" />
        <circle cx="35" cy="35" r="8" fill="#aeb7c9" />
      </svg>
    )
  if (type === 'resistor')
    return (
      <svg width="110" height="36" viewBox="0 0 110 36">
        <line x1="0" y1="18" x2="110" y2="18" stroke="#9a9a9a" strokeWidth="3" />
        <rect x="30" y="8" width="50" height="20" rx="9" fill="#d8c7a0" stroke="#b7a578" />
        <rect x="38" y="8" width="4" height="20" fill="#6b3f1d" />
        <rect x="48" y="8" width="4" height="20" fill="#111" />
        <rect x="58" y="8" width="4" height="20" fill="#c0392b" />
        <rect x="70" y="8" width="4" height="20" fill="#caa53c" />
      </svg>
    )
  if (type === 'led')
    return (
      <svg width="52" height="70" viewBox="0 0 52 70">
        <line x1="16" y1="40" x2="16" y2="68" stroke="#caa53c" strokeWidth="2.5" />
        <line x1="36" y1="40" x2="36" y2="68" stroke="#caa53c" strokeWidth="2.5" />
        <path d="M10 38 A16 16 0 0 1 42 38 L42 40 L10 40 Z" fill="#ff5a6a" opacity="0.92" />
        <circle cx="26" cy="26" r="16" fill="#ff6e7c" opacity="0.55" />
        <circle cx="26" cy="26" r="16" fill="none" stroke="#c0392b" strokeWidth="1.5" />
      </svg>
    )
  // module-style parts (tinyCore family): a labeled board
  const g = PART_GEO[type]
  if (!g) return null
  return (
    <div
      style={{
        width: g.w,
        height: g.h,
        borderRadius: 12,
        background: 'linear-gradient(160deg, var(--navy-600), var(--navy-800))',
        border: `1.5px solid ${g.accent || 'var(--navy-400)'}`,
        boxShadow: '0 8px 18px rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <CircuitBoard size={Math.min(g.w, g.h) * 0.4} color={g.accent || 'var(--fg-3)'} strokeWidth={1.25} />
    </div>
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
      return { parts: d.parts || [], connections: d.connections || [], author: d.author }
    } catch {
      return { parts: [], connections: [] }
    }
  }, [content])

  const [grid, setGrid] = React.useState(true)
  const [showJson, setShowJson] = React.useState(false)
  const [selPart, setSelPart] = React.useState<string | null>(null)
  const [armed, setArmed] = React.useState<{ id: string; pin: string } | null>(null)
  const [wireColor, setWireColor] = React.useState(WIRE_COLORS[0])
  const viewRef = React.useRef<HTMLDivElement>(null)
  const innerRef = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<{ id: string; offX: number; offY: number } | null>(null)
  const pan = React.useRef<{ x: number; y: number } | null>(null)
  const [cam, setCam] = React.useState({ scale: 0.62, tx: 0, ty: 0 })
  const scale = cam.scale
  const didInit = React.useRef(false)

  const write = (d: Partial<Diagram>): void => {
    const next = { version: 1, editor: 'tinystudio', author: diagram.author, parts: diagram.parts, connections: diagram.connections, ...d }
    onChange(JSON.stringify(next, null, 2))
  }

  const fitView = (): void => {
    const el = viewRef.current
    if (!el) return
    const f = Math.max(0.3, Math.min(1, Math.min(el.clientWidth / (CANVAS_W + 60), el.clientHeight / (CANVAS_H + 60))))
    setCam({ scale: f, tx: (el.clientWidth - CANVAS_W * f) / 2, ty: (el.clientHeight - CANVAS_H * f) / 2 })
  }

  React.useLayoutEffect(() => {
    if (!didInit.current) {
      fitView()
      didInit.current = true
    }
  }, [])

  const zoomAt = (factor: number, sx: number, sy: number): void => {
    setCam((c) => {
      const ns = Math.max(0.25, Math.min(3, c.scale * factor))
      const k = ns / c.scale
      return { scale: ns, tx: sx - (sx - c.tx) * k, ty: sy - (sy - c.ty) * k }
    })
  }
  const zoomCenter = (factor: number): void => {
    const el = viewRef.current
    if (!el) return
    zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2)
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
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    pan.current = { x: e.clientX, y: e.clientY }
    setCam((c) => ({ ...c, tx: c.tx + dx, ty: c.ty + dy }))
  }
  const onPanUp = (): void => {
    pan.current = null
    window.removeEventListener('pointermove', onPanMove)
    window.removeEventListener('pointerup', onPanUp)
  }

  const onPartDown = (e: React.PointerEvent, part: Part): void => {
    if ((e.target as HTMLElement).closest('.pin-hit')) return
    e.stopPropagation()
    setSelPart(part.id)
    const r = innerRef.current!.getBoundingClientRect()
    drag.current = { id: part.id, offX: (e.clientX - r.left) / scale - part.x, offY: (e.clientY - r.top) / scale - part.y }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const onMove = (e: PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const r = innerRef.current!.getBoundingClientRect()
    const nx = Math.round((e.clientX - r.left) / scale - d.offX)
    const ny = Math.round((e.clientY - r.top) / scale - d.offY)
    write({ parts: diagram.parts.map((p) => (p.id === d.id ? { ...p, x: nx, y: ny } : p)) })
  }
  const onUp = (): void => {
    drag.current = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }

  const onPinClick = (e: React.MouseEvent, part: Part, pin: string): void => {
    e.stopPropagation()
    if (!armed) {
      setArmed({ id: part.id, pin })
      return
    }
    if (armed.id === part.id && armed.pin === pin) {
      setArmed(null)
      return
    }
    const from = armed.id + ':' + armed.pin
    const to = part.id + ':' + pin
    if (!diagram.connections.some((c) => (c[0] === from && c[1] === to) || (c[0] === to && c[1] === from))) {
      write({ connections: [...diagram.connections, [from, to, wireColor]] })
    }
    setArmed(null)
  }

  const addPart = (type: string): void => {
    const g = PART_GEO[type]
    if (!g) return
    const pid = type + '_' + uid().slice(0, 3)
    write({ parts: [...diagram.parts, { id: pid, type, x: Math.round(CANVAS_W / 2 - g.w / 2), y: Math.round(CANVAS_H / 2 - g.h / 2) }] })
    setSelPart(pid)
  }
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/tinystudio-part')
    if (!id || !PART_GEO[id]) return
    const r = innerRef.current!.getBoundingClientRect()
    const g = PART_GEO[id]
    const x = Math.round((e.clientX - r.left) / scale - g.w / 2)
    const y = Math.round((e.clientY - r.top) / scale - g.h / 2)
    const pid = id + '_' + uid().slice(0, 3)
    write({ parts: [...diagram.parts, { id: pid, type: id, x, y }] })
    setSelPart(pid)
  }

  React.useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selPart) {
        if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return
        write({
          parts: diagram.parts.filter((p) => p.id !== selPart),
          connections: diagram.connections.filter((c) => c[0].split(':')[0] !== selPart && c[1].split(':')[0] !== selPart)
        })
        setSelPart(null)
      }
      if (e.key === 'Escape') {
        setArmed(null)
        setSelPart(null)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [selPart, diagram])

  const isAI = (diagram.author || '').includes('Studio AI')
  const tool =
    'h-8 px-2.5 flex items-center gap-1.5 rounded-lg bg-navy-700/80 border border-navy-500 text-fg-2 text-xs hover:bg-navy-500 hover:text-fg-1 transition-colors'

  return (
    <div className="size-full relative flex bg-navy-900 overflow-hidden">
      {/* components rail */}
      <div className="w-44 shrink-0 border-r border-navy-600 bg-navy-800 flex flex-col">
        <div className="px-3 py-2 text-[11px] font-semibold tracking-[0.16em] text-fg-3 border-b border-navy-600">
          COMPONENTS
        </div>
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {PALETTE.map((c) => (
            <div
              key={c.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/tinystudio-part', c.id)}
              onDoubleClick={() => addPart(c.id)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-navy-600 bg-navy-700/50 hover:bg-navy-600 cursor-grab active:cursor-grabbing"
              title="Drag onto the canvas (or double-click)"
            >
              <CircuitBoard size={15} className="text-cyan shrink-0" />
              <div className="min-w-0">
                <div className="text-xs text-fg-1 truncate">{c.label}</div>
                <div className="text-[10px] text-fg-4 truncate">{c.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="p-2 border-t border-navy-600">
          <div className="text-[10px] text-fg-4 mb-1.5">Wire color</div>
          <div className="flex gap-1.5 flex-wrap">
            {WIRE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setWireColor(c)}
                className="w-5 h-5 rounded-full border-2"
                style={{ background: c, borderColor: wireColor === c ? 'var(--fg-1)' : 'transparent' }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* canvas + tools */}
      <div className="flex-1 relative">
        <div className="absolute top-3 z-10 flex gap-1.5" style={{ right: showJson ? 374 : 14 }}>
          <button className={tool} onClick={() => zoomCenter(1.15)} title="Zoom in">
            <ZoomIn size={15} />
          </button>
          <button className={tool} onClick={() => zoomCenter(1 / 1.15)} title="Zoom out">
            <ZoomOut size={15} />
          </button>
          <span className={`${tool} pointer-events-none min-w-[52px] justify-center`}>{Math.round(scale * 100)}%</span>
          <button className={tool} onClick={fitView}>
            <Maximize size={15} /> Fit
          </button>
          <button className={`${tool} ${grid ? 'text-cyan border-cyan/40' : ''}`} onClick={() => setGrid((g) => !g)}>
            <Grid3x3 size={15} /> Grid
          </button>
          <button className={`${tool} ${showJson ? 'text-cyan border-cyan/40' : ''}`} onClick={() => setShowJson((s) => !s)}>
            <Braces size={15} /> JSON
          </button>
        </div>

        <div
          ref={viewRef}
          className="size-full overflow-hidden"
          style={{
            touchAction: 'none',
            backgroundImage: grid
              ? 'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)'
              : 'none',
            backgroundSize: `${22 * scale}px ${22 * scale}px`,
            backgroundPosition: `${cam.tx}px ${cam.ty}px`
          }}
          onWheel={onWheel}
          onPointerDown={onViewPointerDown}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={onDrop}
          onClick={() => {
            setSelPart(null)
            setArmed(null)
          }}
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
            <svg width={CANVAS_W} height={CANVAS_H} style={{ position: 'absolute', inset: 0, overflow: 'visible', zIndex: 1 }}>
              {diagram.connections.map((c, i) => {
                const [pa, pia] = c[0].split(':')
                const [pb, pib] = c[1].split(':')
                const A = diagram.parts.find((p) => p.id === pa)
                const B = diagram.parts.find((p) => p.id === pb)
                if (!A || !B) return null
                const pts = routePts(pinPos(A, pia), pinPos(B, pib))
                return (
                  <g
                    key={i}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      write({ connections: diagram.connections.filter((_, j) => j !== i) })
                    }}
                  >
                    <polyline points={ptsStr(pts)} fill="none" stroke="#05081a" strokeWidth="8" strokeLinejoin="round" strokeLinecap="round" />
                    <polyline points={ptsStr(pts)} fill="none" stroke={c[2] || '#36c46b'} strokeWidth="4.5" strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                )
              })}
            </svg>

            {diagram.parts.map((part) => {
              const g = PART_GEO[part.type]
              if (!g) return null
              return (
                <div
                  key={part.id}
                  style={{
                    position: 'absolute',
                    left: part.x,
                    top: part.y,
                    width: g.w,
                    height: g.h,
                    zIndex: 2,
                    outline: selPart === part.id ? '2px solid var(--cyan)' : 'none',
                    outlineOffset: 4,
                    borderRadius: 12
                  }}
                  onPointerDown={(e) => onPartDown(e, part)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <VectorPart type={part.type} />
                  {Object.keys(g.pins).map((pin) => {
                    const [px, py] = g.pins[pin]
                    const on = armed && armed.id === part.id && armed.pin === pin
                    return (
                      <div
                        key={pin}
                        className="pin-hit"
                        title={pin}
                        style={{ position: 'absolute', left: px - 8, top: py - 8, width: 16, height: 16, zIndex: 3, cursor: 'crosshair' }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => onPinClick(e, part, pin)}
                      >
                        <svg width="16" height="16">
                          <circle cx="8" cy="8" r="4.5" fill={on ? 'var(--cyan)' : 'var(--navy-300)'} stroke={on ? 'var(--cyan-bright)' : 'var(--navy-500)'} strokeWidth="1.5" />
                        </svg>
                      </div>
                    )
                  })}
                  <div className="absolute text-[11px] text-fg-2 whitespace-nowrap" style={{ left: 0, top: g.h + 4 }}>
                    {g.label}
                    {g.sub && <span className="text-fg-4"> {g.sub}</span>}
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
                <div>Drag parts from the Components rail — or double-click one to drop it here.</div>
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
          {armed ? (
            <span className="px-2.5 py-1 rounded-full bg-navy-700/80 border border-cyan/40 text-cyan flex items-center gap-1">
              <Zap size={12} /> Click a pin to connect — Esc to cancel
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-full bg-navy-700/80 border border-navy-500 text-fg-4 flex items-center gap-1">
              <MousePointer2 size={12} /> Scroll to zoom · middle/Alt-drag to pan · click a pin to wire
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
              {JSON.stringify({ version: 1, editor: 'tinystudio', parts: diagram.parts, connections: diagram.connections }, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
