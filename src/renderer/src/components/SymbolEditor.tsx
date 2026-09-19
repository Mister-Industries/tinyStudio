/**
 * SymbolEditor: the parts editor's Symbol mode: a schematic symbol built from
 * a body shape, a name and pins on the 0.1 in grid, without freeform drawing.
 * The canvas shows the rendered symbol with a draggable handle on every pin
 * tip; the panel edits the name, shape, fill, body size and the pin list.
 * The draft is the single source of truth (circuit/parts/symbolDraft); the
 * parent turns it into the schematic view's art on every change.
 */

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import React from 'react'
import {
  MAX_BODY,
  MIN_BODY,
  draftSize,
  nearestSlot,
  normalizeDraft,
  pinTip,
  renderDraft,
  sideLength,
  type DraftPin,
  type PinSide,
  type SymbolDraft
} from '../circuit/parts/symbolDraft'
import { sanitizeSvg } from '../lib/sanitizeSvg'

const SIDES: { id: PinSide; label: string }[] = [
  { id: 'L', label: 'Left' },
  { id: 'R', label: 'Right' },
  { id: 'T', label: 'Top' },
  { id: 'B', label: 'Bottom' }
]

const field =
  'bg-bg-sunken border border-border-default rounded px-2 py-1 text-sm text-text-strong focus:border-brand outline-none'
const select = `${field} pr-6`

/** The canvas: the symbol at `scale`, pin handles on top. */
export function SymbolCanvas({
  draft,
  scale,
  selected,
  onSelect,
  onChange
}: {
  draft: SymbolDraft
  scale: number
  selected: number
  onSelect: (i: number) => void
  /** `commit` is false while a drag is in progress */
  onChange: (next: SymbolDraft, commit: boolean) => void
}): React.JSX.Element {
  const { svg, w, h } = React.useMemo(() => renderDraft(draft), [draft])
  const surfaceRef = React.useRef<HTMLDivElement>(null)

  const onPinDown = (e: React.PointerEvent, i: number): void => {
    e.stopPropagation()
    e.preventDefault()
    onSelect(i)
    const start = draft
    let last = draft
    const move = (ev: PointerEvent): void => {
      const r = surfaceRef.current!.getBoundingClientRect()
      const slot = nearestSlot(start, (ev.clientX - r.left) / scale, (ev.clientY - r.top) / scale)
      const pin = start.pins[i]
      if (pin.side === slot.side && pin.pos === slot.pos) return
      // the slot is only free if no other pin holds it
      if (start.pins.some((p, j) => j !== i && p.side === slot.side && p.pos === slot.pos)) return
      last = {
        ...start,
        pins: start.pins.map((p, j) => (j === i ? { ...p, side: slot.side, pos: slot.pos } : p))
      }
      onChange(last, false)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (last !== start) onChange(last, true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      ref={surfaceRef}
      className="relative"
      style={{
        width: w * scale,
        height: h * scale,
        outline: '1px dashed var(--border-interactive)',
        backgroundImage: 'radial-gradient(var(--dot-color) 1.1px, transparent 1.1px)',
        backgroundSize: `${9.6 * scale}px ${9.6 * scale}px`
      }}
    >
      <div
        className="absolute inset-0 [&>svg]:size-full pointer-events-none [&_line]:[stroke:var(--text-strong)] [&_path]:[stroke:var(--text-strong)] [&_rect]:[stroke:var(--text-strong)] [&_circle:not([id])]:[stroke:var(--text-strong)] [&_text]:[fill:var(--text-strong)]"
        dangerouslySetInnerHTML={{ __html: sanitizeSvg(svg) }}
      />
      {draft.pins.map((pin, i) => {
        const [x, y] = pinTip(draft, pin)
        return (
          <div
            key={pin.name}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: x * scale, top: y * scale, zIndex: 2 }}
            onPointerDown={(e) => onPinDown(e, i)}
            title={`${pin.name}: drag to another side or slot`}
          >
            <div
              className="rounded-full border-2"
              style={{
                width: 12,
                height: 12,
                background: i === selected ? 'var(--brand)' : 'var(--text-muted)',
                borderColor: '#fff',
                cursor: 'grab'
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

/** The side panel: name, shape, fill, size and the pin list. */
export function SymbolPanel({
  draft,
  selected,
  onSelect,
  onChange,
  onStartFromArt,
  onStartFromBox
}: {
  draft: SymbolDraft
  selected: number
  onSelect: (i: number) => void
  onChange: (next: SymbolDraft) => void
  onStartFromArt?: () => void
  onStartFromBox: () => void
}): React.JSX.Element {
  const update = (patch: Partial<SymbolDraft>): void =>
    onChange(normalizeDraft({ ...draft, ...patch }))
  const updatePin = (i: number, patch: Partial<DraftPin>): void =>
    update({ pins: draft.pins.map((p, j) => (j === i ? { ...p, ...patch } : p)) })
  const movePin = (i: number, delta: number): void => {
    const pin = draft.pins[i]
    const pos = Math.max(1, Math.min(sideLength(draft, pin.side), pin.pos + delta))
    if (pos === pin.pos) return
    // swap with whoever holds the target slot, so ▲▼ never gets stuck
    const other = draft.pins.findIndex((p, j) => j !== i && p.side === pin.side && p.pos === pos)
    update({
      pins: draft.pins.map((p, j) =>
        j === i ? { ...p, pos } : j === other ? { ...p, pos: pin.pos } : p
      )
    })
  }
  const uniqueName = (base: string): string => {
    let n = base
    let k = 2
    while (draft.pins.some((p) => p.name === n)) n = `${base}${k++}`
    return n
  }
  const { w: pxW, h: pxH } = draftSize(draft)

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-text-muted">Name on the symbol</span>
        <input
          className={field}
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-text-muted">Body</span>
          <select
            className={select}
            value={draft.shape}
            onChange={(e) => update({ shape: e.target.value as SymbolDraft['shape'] })}
          >
            <option value="rect">Rectangle</option>
            <option value="circle">Circle</option>
            <option value="triangle">Triangle (op-amp)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-text-muted">Fill</span>
          <select
            className={select}
            value={draft.fill}
            onChange={(e) => update({ fill: e.target.value as SymbolDraft['fill'] })}
          >
            <option value="none">None</option>
            <option value="white">White</option>
            <option value="yellow">Soft yellow</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-text-muted">Width (0.1 in)</span>
          <input
            type="number"
            min={MIN_BODY}
            max={MAX_BODY}
            className={field}
            value={draft.w}
            onChange={(e) => update({ w: parseInt(e.target.value, 10) || MIN_BODY })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-text-muted">Height (0.1 in)</span>
          <input
            type="number"
            min={MIN_BODY}
            max={MAX_BODY}
            className={field}
            value={draft.h}
            disabled={draft.shape === 'circle'}
            onChange={(e) => update({ h: parseInt(e.target.value, 10) || MIN_BODY })}
          />
        </label>
      </div>
      <div className="text-[10px] leading-snug text-text-faint">
        {Math.round(pxW)} × {Math.round(pxH)} px with the pin leads. Pins sit on the grid lines of
        their side; drag a pin on the canvas or use the arrows here.
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-text-muted">Pins ({draft.pins.length})</span>
        <button
          className="text-text-muted hover:text-brand"
          title="Add a pin"
          onClick={() => {
            const side: PinSide =
              draft.pins.filter((p) => p.side === 'L').length <=
              draft.pins.filter((p) => p.side === 'R').length
                ? 'L'
                : 'R'
            update({ pins: [...draft.pins, { name: uniqueName('P'), side, pos: 1 }] })
            onSelect(draft.pins.length)
          }}
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {draft.pins.map((pin, i) => (
          <div
            key={i}
            className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-1.5 px-2 py-1 rounded border ${
              i === selected ? 'border-brand/50 bg-bg-sunken' : 'border-border-default'
            }`}
            onClick={() => onSelect(i)}
          >
            <input
              className="min-w-0 bg-transparent text-sm text-text-strong outline-none"
              value={pin.name}
              title="Pin names must match the breadboard pins: they are how the two views join up."
              onChange={(e) => updatePin(i, { name: e.target.value })}
              onBlur={(e) => {
                if (!e.target.value.trim()) updatePin(i, { name: uniqueName('P') })
              }}
            />
            <select
              className="bg-bg-sunken border border-border-default rounded px-1 py-0.5 text-[11px] text-text-body outline-none"
              value={pin.side}
              onChange={(e) => updatePin(i, { side: e.target.value as PinSide })}
            >
              {SIDES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="flex">
              <button
                className="text-text-faint hover:text-brand disabled:opacity-30"
                title="Earlier on its side"
                disabled={pin.pos <= 1}
                onClick={(e) => {
                  e.stopPropagation()
                  movePin(i, -1)
                }}
              >
                <ChevronUp size={13} />
              </button>
              <button
                className="text-text-faint hover:text-brand disabled:opacity-30"
                title="Later on its side"
                disabled={pin.pos >= sideLength(draft, pin.side)}
                onClick={(e) => {
                  e.stopPropagation()
                  movePin(i, 1)
                }}
              >
                <ChevronDown size={13} />
              </button>
            </span>
            <button
              className="text-text-faint hover:text-status-error"
              title="Remove pin"
              onClick={(e) => {
                e.stopPropagation()
                update({ pins: draft.pins.filter((_, j) => j !== i) })
                onSelect(-1)
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 pt-1">
        <span className="text-[11px] text-text-muted">Start over from</span>
        <div className="flex gap-2">
          <button
            className="flex-1 px-2 py-1 rounded-md border border-border-default text-[11px] text-text-body hover:border-brand hover:text-brand"
            onClick={onStartFromBox}
          >
            the generated box
          </button>
          {onStartFromArt && (
            <button
              className="flex-1 px-2 py-1 rounded-md border border-border-default text-[11px] text-text-body hover:border-brand hover:text-brand"
              onClick={onStartFromArt}
            >
              the existing art
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
