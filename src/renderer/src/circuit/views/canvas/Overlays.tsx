/**
 * circuit/views/canvas/Overlays: world-anchored readouts drawn over the circuit: the
 * breadboard hole tooltip, DC node-voltage chips and simulation probe tags.
 */

import { X } from 'lucide-react'
import React from 'react'
import { describeNet, type NetModel } from '../../core/nets'
import type { ProbeTag } from './Canvas'
import type { HoverHole } from './types'

export interface OverlaysProps {
  scale: number
  /**
   * -1 while the breadboard view is mirrored (the back of the board): readouts
   * flip back so their text still reads left to right.
   */
  flipX?: 1 | -1
  netModel: NetModel
  hoverHole: HoverHole
  simVoltageForNet?: (netIdx: number) => string | undefined
  annotations?: { x: number; y: number; lx?: number; ly?: number; text: string }[]
  probes?: ProbeTag[]
  draggingProbe: string | null
  onProbeDown: (e: React.PointerEvent, tag: ProbeTag) => void
  onDeleteProbe?: (id: string) => void
}

export function Overlays({
  scale,
  flipX = 1,
  netModel,
  hoverHole,
  simVoltageForNet,
  annotations,
  probes,
  draggingProbe,
  onProbeDown,
  onDeleteProbe
}: OverlaysProps): React.JSX.Element {
  return (
    <>
      {hoverHole && (
        <div
          style={{
            position: 'absolute',
            left: hoverHole.pos.x + 8 * flipX,
            top: hoverHole.pos.y - 10,
            zIndex: 6,
            transform: `scale(${flipX / scale}, ${1 / scale})`,
            transformOrigin: 'left bottom',
            pointerEvents: 'none'
          }}
          className="px-2 py-1 rounded-md bg-surface-card border border-border-default text-[11px] text-text-body whitespace-nowrap shadow"
        >
          {hoverHole.pin}
          {(() => {
            const idx = netModel.pinToNet.get(`${hoverHole.id}:${hoverHole.pin}`)
            if (idx == null) return ''
            const v = simVoltageForNet?.(idx)
            return ` · net: ${describeNet(netModel, idx)}${v ? ` · ${v}` : ''}`
          })()}
        </div>
      )}

      {/* sim annotations (node voltages after a DC run) */}
      {annotations && annotations.length > 0 && (
        <svg
          style={{ position: 'absolute', inset: 0, overflow: 'visible', zIndex: 4 }}
          className="pointer-events-none"
        >
          {annotations.map((a, i) => {
            if (a.lx === undefined || a.ly === undefined) return null
            // a chip placed away from its node gets a faint leader to it
            const cx = Math.max(a.lx, Math.min(a.x, a.lx + 4))
            const cy = a.y < a.ly ? a.ly : a.ly + 15
            if (Math.hypot(cx - a.x, cy - a.y) < 10) return null
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={cx}
                y2={cy}
                stroke="var(--brand)"
                strokeOpacity={0.45}
                strokeWidth={0.8}
              />
            )
          })}
        </svg>
      )}
      {annotations?.map((a, i) => (
        <div
          key={i}
          className="pointer-events-none select-none px-1 py-0.5 rounded bg-surface-card/90 border border-brand/40 text-[9px] leading-[10px] font-mono text-brand whitespace-nowrap"
          style={{
            position: 'absolute',
            left: a.lx ?? a.x + 7,
            top: a.ly ?? a.y - 21,
            zIndex: 4
          }}
        >
          {a.text}
        </div>
      ))}

      {/* probe tags: leader lines + anchor dots (labels follow, above) */}
      {probes && probes.length > 0 && (
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'visible',
            zIndex: 6,
            pointerEvents: 'none'
          }}
        >
          {probes.map((t) => (
            <g key={t.id} opacity={draggingProbe === t.id ? 0.75 : 1}>
              <line
                x1={t.ax}
                y1={t.ay}
                x2={t.x}
                y2={t.y}
                stroke="var(--brand)"
                strokeWidth={1}
                strokeDasharray="3 2"
                opacity={0.8}
              />
              <circle cx={t.ax} cy={t.ay} r={3.2} fill="var(--brand)" />
              <circle cx={t.ax} cy={t.ay} r={6} fill="var(--brand)" fillOpacity={0.18} />
            </g>
          ))}
        </svg>
      )}

      {probes?.map((t) => (
        <div
          key={t.id}
          className={`group absolute flex items-center gap-1 rounded-md border bg-surface-card shadow-sm pl-1.5 pr-1 h-[18px] text-[10px] font-mono whitespace-nowrap select-none ${
            draggingProbe === t.id
              ? 'border-brand ring-1 ring-brand text-brand'
              : 'border-brand/50 text-brand hover:border-brand'
          }`}
          style={{
            left: t.x,
            top: t.y,
            zIndex: 7,
            transform: `scale(${flipX / scale}, ${1 / scale})`,
            transformOrigin: 'left top',
            cursor: 'move',
            touchAction: 'none'
          }}
          title={`${t.label}: drag to move, drop on a wire to re-anchor`}
          onPointerDown={(e) => onProbeDown(e, t)}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-[8px] opacity-70">
            {t.kind === 'current' ? 'A' : t.kind === 'diff' ? '\u0394' : 'V'}
          </span>
          <span className="font-semibold">{t.label}</span>
          {t.value && <span className="text-text-body">{t.value}</span>}
          <button
            className="opacity-0 group-hover:opacity-100 text-text-faint hover:text-status-danger leading-none px-0.5"
            title="Remove this probe"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onDeleteProbe?.(t.id)
            }}
          >
            <X size={9} />
          </button>
        </div>
      ))}
    </>
  )
}
