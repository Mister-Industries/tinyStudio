/**
 * circuit/views/canvas/WireLayer: wires, ratsnest, junction dots, the in-progress wire,
 * the selected wire’s handles, breadboard seat marks and the marquee:
 * one SVG above the parts.
 */

import React from 'react'
import { wireSide, type Pt, type ViewId, type WireSide } from '../../core/model'
import type { NetModel } from '../../core/nets'
import type { RatsnestSegment, Seat, wireGeometry } from '../partsAdapter'
import type { Selection } from './selection'
import type { HandleKind, HoverHole, SetState } from './types'
import {
  NET_GLOW,
  WIRE_CORNER,
  WIRE_CORNER_SCH,
  WIRE_GLOW_W,
  WIRE_OUTLINE_W,
  WIRE_SCH_W,
  WIRE_W,
  darken,
  roundedPath
} from './wireStyle'

export interface WireLayerProps {
  view: ViewId
  /** breadboard: the face being shown; the other face's wires are drawn faintly */
  side?: WireSide
  editable: boolean
  pickNets: boolean
  scale: number
  ink: string
  wireColor: string
  sel: Selection
  netModel: NetModel
  highlightNet: number
  rats: RatsnestSegment[]
  wireGeom: ReturnType<typeof wireGeometry>
  soloWire: string | null
  editPts: Pt[] | null
  junctionDots: { key: string; pt: Pt; color: string }[]
  previewPts: Pt[] | null
  seats: Seat[]
  hoverHole: HoverHole
  marquee: { a: Pt; b: Pt } | null
  setHoverWire: SetState<string | null>
  onWireClick: (e: React.MouseEvent, wireId: string) => void
  onWireDoubleClick: (e: React.MouseEvent, wireId: string) => void
  startHandleDrag: (e: React.PointerEvent, kind: HandleKind, idx: number, end?: 0 | 1) => void
}

export function WireLayer({
  view,
  side = 'front',
  editable,
  pickNets,
  scale,
  ink,
  wireColor,
  sel,
  netModel,
  highlightNet,
  rats,
  wireGeom,
  soloWire,
  editPts,
  junctionDots,
  previewPts,
  seats,
  hoverHole,
  marquee,
  setHoverWire,
  onWireClick,
  onWireDoubleClick,
  startHandleDrag
}: WireLayerProps): React.JSX.Element {
  return (
    <>
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
          // a wire on the other face of the board: seen through it, faint and
          // dashed, and not clickable (turn the board over to edit it)
          const farSide = view === 'bb' && wireSide(w) !== side
          const selected = sel.wires.has(w.id)
          const onHotNet = highlightNet >= 0 && netModel.wireToNet.get(w.id) === highlightNet
          const core = view === 'sch' ? ink : w.color || '#2fa46a'
          const outline = view === 'sch' ? 'rgba(0,0,0,0.45)' : darken(w.color || '#2fa46a')
          // schematic ink is a single thin stroke, no color outline, no glow.
          const coreW = view === 'sch' ? WIRE_SCH_W : WIRE_W
          const d = roundedPath(pts, view === 'sch' ? WIRE_CORNER_SCH : WIRE_CORNER)
          return (
            <g
              key={w.id}
              opacity={farSide ? 0.28 : undefined}
              strokeDasharray={farSide ? '6 5' : undefined}
              style={{
                cursor: pickNets ? 'crosshair' : editable ? 'pointer' : 'default',
                pointerEvents: farSide ? 'none' : 'stroke'
              }}
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
            d={roundedPath(previewPts, view === 'sch' ? WIRE_CORNER_SCH : WIRE_CORNER)}
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
    </>
  )
}
