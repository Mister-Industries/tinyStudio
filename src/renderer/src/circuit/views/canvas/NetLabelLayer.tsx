/**
 * circuit/views/canvas/NetLabelLayer: schematic net labels (ground, power rails, named
 * nets). Each is a one-pin part whose net joins every label of the same name.
 */

import React from 'react'
import type { CircuitDoc, Placement, ViewId } from '../../core/model'
import type { NetModel } from '../../core/nets'
import { netLabelVisualOf } from '../../parts/netLabels'
import { INK, PIN_OPEN } from '../../parts/style'
import { sanitizeSvg } from '../../../lib/sanitizeSvg'
import type { Selection } from './selection'
import type { Armed, HoverPin, SetState } from './types'

export interface NetLabelLayerProps {
  doc: CircuitDoc
  view: ViewId
  editable: boolean
  pinHit: number
  sel: Selection
  netModel: NetModel
  armed: Armed | null
  hoverPin: HoverPin
  dragOverrides: Map<string, Placement> | null
  setHoverPin: SetState<HoverPin>
  onNetLabelDown: (e: React.PointerEvent, id: string) => void
  onPinClick: (e: React.MouseEvent, partId: string, pin: string) => void
  onRequestEdit: () => void
}

export function NetLabelLayer({
  doc,
  view,
  editable,
  pinHit,
  sel,
  netModel,
  armed,
  hoverPin,
  dragOverrides,
  setHoverPin,
  onNetLabelDown,
  onPinClick,
  onRequestEdit
}: NetLabelLayerProps): React.JSX.Element {
  return (
    <>
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
                dangerouslySetInnerHTML={{ __html: sanitizeSvg(v.svg) }}
              />
              {editable && (
                <div
                  className="pin-hit"
                  title={label.name}
                  style={{
                    position: 'absolute',
                    left: px - pinHit / 2,
                    top: py - pinHit / 2,
                    width: pinHit,
                    height: pinHit,
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
                  <svg
                    width="16"
                    height="16"
                    style={{
                      position: 'absolute',
                      left: (pinHit - 16) / 2,
                      top: (pinHit - 16) / 2
                    }}
                  >
                    {showDot && (
                      <circle
                        cx="8"
                        cy="8"
                        r={on ? 3.4 : 2.6}
                        fill={on || connected ? 'var(--brand)' : PIN_OPEN}
                        stroke={on || connected ? 'var(--brand)' : INK}
                        strokeWidth="1"
                      />
                    )}
                  </svg>
                </div>
              )}
            </div>
          )
        })}
    </>
  )
}
