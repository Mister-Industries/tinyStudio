/**
 * circuit/views/canvas/PartLayer: every part in the active view: its art, pin targets,
 * bent breadboard legs, and its refdes/value text. Breadboards sit under
 * everything and vanish on the schematic.
 */

import React from 'react'
import * as cmd from '../../core/commands'
import type { CircuitDoc, Placement, Pt, ViewId } from '../../core/model'
import type { NetModel } from '../../core/nets'
import type { CircuitStore } from '../../core/store'
import { isBreadboard, isHoleBoard } from '../../parts/breadboard'
import { isTinyHeaderBoard } from '../../parts/boardSymbols'
import { labelLayout, refdesOf, valueOf } from '../../parts/labels'
import { FONT_REFDES, FONT_VALUE, INK, PIN_OPEN } from '../../parts/style'
import {
  collectFrozen,
  holeAt,
  partArtFor,
  reroutesFor,
  ROTATE_STEP,
  visualFor
} from '../partsAdapter'
import { sanitizeSvg } from '../../../lib/sanitizeSvg'
import type { LedState } from '../../core/liveState'
import type { Selection } from './selection'
import type { Armed, HoverHole, HoverPin, SetState } from './types'

export interface PartLayerProps {
  store: CircuitStore
  doc: CircuitDoc
  view: ViewId
  /**
   * The breadboard view shows the back of the board (mirrored): parts are
   * dimmed, as seen through the board, and their captions (which would read
   * backwards) are hidden. Pins stay live, so wires still start and end on them.
   */
  backside?: boolean
  editable: boolean
  pickNets: boolean
  scale: number
  pinHit: number
  sel: Selection
  netModel: NetModel
  highlightNet: number
  armed: Armed | null
  hoverPin: HoverPin
  placementOf: (id: string) => Placement | undefined
  canvasPoint: (e: { clientX: number; clientY: number }) => Pt
  /** true while a part drag is in flight (hole hover is suspended) */
  isPartDragging: () => boolean
  /** set by a drag so the click that ends it is swallowed */
  suppressClick: React.RefObject<boolean>
  setHoverHole: SetState<HoverHole>
  setHoverPin: SetState<HoverPin>
  onPartDown: (e: React.PointerEvent, partId: string) => void
  onLabelDown: (e: React.PointerEvent, partId: string) => void
  onPinClick: (e: React.MouseEvent, partId: string, pin: string) => void
  beginLegDrag: (e: React.PointerEvent, partId: string, pin: string, base: [number, number]) => void
  rotateBoardAssembly: (boardId: string) => void
  onRequestEdit: () => void
  /** a plain click on a part (Simulate: press a button, flip a switch) */
  onPartClick?: (partId: string) => void
  /** a double-click on a part, with its viewport position (Simulate: edit its value) */
  onPartDoubleClick?: (partId: string, at: { x: number; y: number }) => void
  /** Simulate: a momentary part held down (true) and let go (false) */
  onPartPress?: (partId: string, down: boolean) => void
  /** Simulate: which parts can be operated, and how */
  operable?: (partId: string) => Operable | null
  /** Simulate: each LED's live state, by part id */
  leds?: Map<string, LedState> | null
}

/** How a part is operated in Simulate: held (a pushbutton) or flipped (a switch). */
export type Operable = 'momentary' | 'toggle'

/** CSS colour of an LED's light, from its colour attribute (red by default). */
const LED_LIGHT: Record<string, string> = {
  red: '255, 40, 30',
  green: '40, 230, 90',
  blue: '60, 120, 255',
  yellow: '255, 220, 40',
  orange: '255, 140, 20',
  white: '255, 250, 235',
  amber: '255, 170, 0'
}
const ledLight = (part: { type: string; attrs?: Record<string, unknown> }): string => {
  const c = String(part.attrs?.color ?? '').toLowerCase()
  const key = Object.keys(LED_LIGHT).find((k) => c.includes(k) || part.type.includes(k))
  return LED_LIGHT[key ?? 'red']
}

/**
 * On-board LEDs of tinyStudio boards, where they sit in the breadboard art
 * (part-local px) and what colour they light. `name` is the sim's key
 * ("U1:LED_SIG"); PWR has no model and is lit whenever the board is powered.
 */
const BOARD_LEDS: Record<
  string,
  { name: string; label: string; at: [number, number]; rgb: string }[]
> = {
  tinycore: [
    { name: 'PWR', label: 'PWR LED', at: [56.3, 105.3], rgb: LED_LIGHT.red },
    { name: 'LED_BOOT', label: 'BOOT LED (GPIO21)', at: [97.1, 84.9], rgb: LED_LIGHT.green },
    { name: 'LED_SIG', label: 'SIG LED (GPIO33)', at: [120.7, 85.1], rgb: LED_LIGHT.blue }
  ]
}

/** An LED's light: a soft radial glow, ringed in red when overdriven. */
function ledGlow(
  title: string,
  led: LedState,
  cx: number,
  cy: number,
  r: number,
  rgb: string
): React.JSX.Element | null {
  if (led.glow <= 0 && !led.over) return null
  const g = led.glow
  return (
    <div
      title={`${title}: ${(led.amps * 1e3).toFixed(1)} mA${led.over ? ', over its rating' : ''}`}
      className={`pointer-events-none ${led.over ? 'animate-pulse' : ''}`}
      style={{
        position: 'absolute',
        left: cx - r,
        top: cy - r,
        width: 2 * r,
        height: 2 * r,
        borderRadius: '50%',
        zIndex: 4,
        background: `radial-gradient(circle, rgba(${rgb}, ${0.95 * g}) 0%, rgba(${rgb}, ${0.55 * g}) 22%, rgba(${rgb}, ${0.18 * g}) 48%, rgba(${rgb}, 0) 70%)`,
        boxShadow: led.over ? '0 0 0 2px var(--status-danger, #e5484d)' : undefined
      }}
    />
  )
}

export function PartLayer({
  store,
  doc,
  view,
  backside = false,
  editable,
  pickNets,
  scale,
  pinHit,
  sel,
  netModel,
  highlightNet,
  armed,
  hoverPin,
  placementOf,
  canvasPoint,
  isPartDragging,
  suppressClick,
  setHoverHole,
  setHoverPin,
  onPartDown,
  onLabelDown,
  onPinClick,
  beginLegDrag,
  rotateBoardAssembly,
  onRequestEdit,
  onPartClick,
  onPartDoubleClick,
  onPartPress,
  operable,
  leds
}: PartLayerProps): React.JSX.Element {
  return (
    <>
      {doc.parts.map((part) => {
        const pl = placementOf(part.id)
        if (!pl) return null
        // breadboards and the tinyProto are transparent on the schematic;
        // their buses still merge nets globally, but they render as no part
        // here (an older file may still give one a schematic spot).
        if (view === 'sch' && isHoleBoard(part.type)) return null
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
        // labels live OUTSIDE the rotated container, anchored to the box
        // the symbol visibly occupies (parts/labels.ts); inside it they
        // would inherit the rotation and need a counter-transform that
        // slides them off the part
        const lay = labelLayout(vis.v.w, vis.v.h, vis.v.pins, pl.rotate)
        const valueText = view === 'sch' ? valueOf(part, vis.def.simFamily ?? vis.def.family) : ''
        return (
          <React.Fragment key={part.id}>
            <div
              style={{
                position: 'absolute',
                left: pl.x,
                top: pl.y,
                width: vis.v.w,
                height: vis.v.h,
                // boards sit under every other part (and under the z5 wire
                // layer); a tinyCore or HAT sits under a tinyProto stacked on it
                zIndex: isHoleBoard(part.type) ? 1 : isTinyHeaderBoard(part.type) ? 0 : 2,
                // from the back, boards stay readable and components fade
                opacity: backside
                  ? isBreadboard(part.type) || /^tiny/.test(part.type)
                    ? 0.8
                    : 0.35
                  : undefined,
                transform:
                  pl.rotate || pl.flip
                    ? `${pl.rotate ? `rotate(${pl.rotate}deg)` : ''}${pl.flip ? ' scaleX(-1)' : ''}`
                    : undefined,
                transformOrigin: 'center',
                outline: selected ? '2px solid var(--brand)' : 'none',
                outlineOffset: 4,
                borderRadius: 6,
                cursor: editable ? 'move' : operable?.(part.id) ? 'pointer' : 'default'
              }}
              onPointerDown={(e) => {
                // Simulate: a pushbutton is held, like the real thing; it
                // springs back on release wherever the pointer ends up
                if (onPartPress && operable?.(part.id) === 'momentary' && e.button === 0) {
                  e.stopPropagation()
                  onPartPress(part.id, true)
                  const up = (): void => {
                    window.removeEventListener('pointerup', up)
                    window.removeEventListener('pointercancel', up)
                    onPartPress(part.id, false)
                  }
                  window.addEventListener('pointerup', up)
                  window.addEventListener('pointercancel', up)
                  return
                }
                onPartDown(e, part.id)
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                if (onPartDoubleClick) onPartDoubleClick(part.id, { x: e.clientX, y: e.clientY })
                else if (!editable) onRequestEdit()
              }}
              onPointerMove={(e) => {
                if (!editable || view !== 'bb' || !isBreadboard(part.type) || isPartDragging())
                  return
                const cp = canvasPoint(e)
                const hole = holeAt(doc, part.id, cp.x, cp.y, 6 / Math.min(scale, 1))
                setHoverHole(hole ? { id: part.id, pin: hole.pin, pos: hole.pos } : null)
              }}
              onPointerLeave={() => setHoverHole((h) => (h?.id === part.id ? null : h))}
              onClick={(e) => {
                e.stopPropagation()
                if (operable?.(part.id) === 'momentary') return
                onPartClick?.(part.id)
              }}
              onContextMenu={(e) => {
                if (!editable) return
                e.preventDefault()
                // breadboards and the tinyProto rotate as a rigid assembly
                // (seated parts + wires turn with the board); other parts
                // rotate in place.
                if (view === 'bb' && isHoleBoard(part.type)) {
                  rotateBoardAssembly(part.id)
                  return
                }
                const cur = doc.parts.find((p) => p.id === part.id)?.[view]
                if (!cur) return
                const next = (((((cur.rotate ?? 0) + ROTATE_STEP) % 360) + 360) % 360) as
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
                dangerouslySetInnerHTML={{ __html: sanitizeSvg(partArtFor(part, vis, view)) }}
              />
              {(() => {
                // light shows on the breadboard; the schematic stays a clean
                // drawing (its readings are the probes and voltage chips)
                const led = view === 'bb' ? leds?.get(part.id) : undefined
                if (!led) return null
                // the light sits on the dome (top of the breadboard art) or
                // around the diode (the middle of the symbol)
                const cx = vis.v.w / 2
                const cy = view === 'bb' ? Math.min(vis.v.h * 0.32, vis.v.w * 0.55) : vis.v.h / 2
                const r = view === 'bb' ? Math.max(vis.v.w * 1.3, 22) : 26
                return ledGlow(part.id, led, cx, cy, r, ledLight(part))
              })()}
              {view === 'bb' &&
                leds &&
                BOARD_LEDS[part.type]?.map((b) => {
                  // the power LED is lit whenever the board is powered
                  const led =
                    b.name === 'PWR'
                      ? { amps: 2e-3, glow: 0.85, over: false }
                      : leds.get(`${part.id}:${b.name}`)
                  if (!led) return null
                  // indicator LEDs behind 1k read as plainly lit at ~1 mA
                  const lit = led.glow > 0 ? { ...led, glow: 0.65 + 0.35 * led.glow } : led
                  return (
                    <React.Fragment key={b.name}>
                      {ledGlow(`${part.id} ${b.label}`, lit, b.at[0], b.at[1], 12, b.rgb)}
                    </React.Fragment>
                  )
                })}
              {(editable || pickNets) &&
                !isBreadboard(part.type) &&
                Object.keys(vis.v.pins).length <= 256 &&
                Object.keys(vis.v.pins).map((pin) => {
                  const [restX, restY] = vis.v.pins[pin]
                  const isLeg = view === 'bb' && (vis.v.legs?.includes(pin) ?? false)
                  const legOff = isLeg ? pl.legs?.[pin] : undefined
                  const px = restX + (legOff?.[0] ?? 0)
                  const py = restY + (legOff?.[1] ?? 0)
                  const armedHere = armed?.from === `${part.id}:${pin}`
                  const hovered = hoverPin?.id === part.id && hoverPin?.pin === pin
                  const netIdx = netModel.pinToNet.get(`${part.id}:${pin}`)
                  const onHotNet = highlightNet >= 0 && netIdx === highlightNet
                  // a pin sharing a net with anything else is connected; its
                  // "open lead" dot disappears (still clickable to re-wire).
                  const connected =
                    netIdx !== undefined && (netModel.nets[netIdx]?.length ?? 0) >= 2
                  const on = armedHere || hovered
                  // a prototyping field (tinyProto) has too many holes to dot
                  // them all at rest; show one on hover, like a breadboard.
                  const dense = Object.keys(vis.v.pins).length > 60
                  const showDot = on || onHotNet || (!connected && !dense)
                  return (
                    <div
                      key={pin}
                      className="pin-hit"
                      title={isLeg ? `${pin} (drag to bend the leg)` : pin}
                      style={{
                        position: 'absolute',
                        left: px - pinHit / 2,
                        top: py - pinHit / 2,
                        width: pinHit,
                        height: pinHit,
                        zIndex: 3,
                        cursor: 'crosshair'
                      }}
                      onPointerDown={(e) => {
                        // in pick mode the pin is only a click target; let
                        // the press through so panning still works there
                        if (pickNets && !editable) return
                        e.stopPropagation()
                        if (editable && isLeg && !armed)
                          beginLegDrag(e, part.id, pin, legOff ?? [0, 0])
                      }}
                      onDoubleClick={(e) => {
                        if (!editable || !isLeg || !legOff) return
                        e.stopPropagation()
                        const cur = doc.parts.find((p) => p.id === part.id)?.[view]
                        if (!cur?.legs?.[pin]) return
                        const legs = { ...cur.legs }
                        delete legs[pin]
                        store.dispatch(
                          cmd.placePart(part.id, view, {
                            ...cur,
                            legs: Object.keys(legs).length ? legs : undefined
                          })
                        )
                      }}
                      onPointerEnter={() => setHoverPin({ id: part.id, pin })}
                      onPointerLeave={() =>
                        setHoverPin((h) => (h?.id === part.id && h?.pin === pin ? null : h))
                      }
                      onClick={(e) => {
                        if (suppressClick.current) {
                          suppressClick.current = false
                          e.stopPropagation()
                          return
                        }
                        onPinClick(e, part.id, pin)
                      }}
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
                        {onHotNet && !on && (
                          <circle cx="8" cy="8" r="5.5" fill="var(--yellow)" fillOpacity={0.4} />
                        )}
                        {showDot && (
                          <circle
                            cx="8"
                            cy="8"
                            r={on ? 3.4 : 2.6}
                            fill={
                              on || connected
                                ? 'var(--brand)'
                                : view === 'sch'
                                  ? PIN_OPEN
                                  : 'var(--yellow)'
                            }
                            stroke={
                              on || connected
                                ? 'var(--brand)'
                                : view === 'sch'
                                  ? INK
                                  : 'var(--border-strong)'
                            }
                            strokeWidth="1"
                          />
                        )}
                      </svg>
                    </div>
                  )
                })}
              {view === 'bb' && vis.v.legs && vis.v.legs.length > 0 && (
                // bent-leg indicator: a simple ink line from the rest pin to
                // the dragged tip, overlaid on the (static) Fritzing art;
                // real per-instance leg-path warping is future work.
                <svg
                  className="absolute inset-0 pointer-events-none overflow-visible"
                  width={vis.v.w}
                  height={vis.v.h}
                >
                  {vis.v.legs.map((pin) => {
                    const off = pl.legs?.[pin]
                    if (!off || (off[0] === 0 && off[1] === 0)) return null
                    const [rx, ry] = vis.v.pins[pin]
                    return (
                      <line
                        key={pin}
                        x1={rx}
                        y1={ry}
                        x2={rx + off[0]}
                        y2={ry + off[1]}
                        stroke="var(--text-strong)"
                        strokeWidth={2}
                        strokeLinecap="round"
                      />
                    )
                  })}
                </svg>
              )}
            </div>
            {/* Schematic text: refdes above the symbol, value below it
                  (spec §8). The breadboard keeps its single muted caption;
                  a value on a physical part would be noise. */}
            <div
              className="absolute whitespace-nowrap select-none"
              style={{
                display: backside ? 'none' : undefined,
                left: pl.x + (view === 'sch' ? lay.refdes[0] : lay.box.left) + labelOff[0],
                top:
                  view === 'sch'
                    ? pl.y + lay.refdes[1] + labelOff[1]
                    : pl.y + lay.box.top + lay.box.h + 4 + labelOff[1],
                zIndex: 4,
                fontSize: view === 'sch' ? FONT_REFDES : 11,
                fontFamily: 'var(--font-sans)',
                fontWeight: view === 'sch' ? 600 : 400,
                color: selected ? 'var(--brand)' : view === 'sch' ? INK : 'var(--text-muted)',
                cursor: editable ? 'move' : 'default',
                pointerEvents: editable ? 'auto' : 'none'
              }}
              onPointerDown={(e) => onLabelDown(e, part.id)}
            >
              {refdesOf(part)}
            </div>
            {valueText && (
              <div
                className="absolute whitespace-nowrap select-none pointer-events-none"
                style={{
                  left: pl.x + lay.value[0] + labelOff[0],
                  top: pl.y + lay.value[1] + labelOff[1],
                  zIndex: 4,
                  fontSize: FONT_VALUE,
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 600,
                  color: selected ? 'var(--brand)' : INK
                }}
              >
                {valueText}
              </div>
            )}
          </React.Fragment>
        )
      })}
    </>
  )
}
