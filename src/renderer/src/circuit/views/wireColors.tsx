/**
 * circuit/views/wireColors — the wire palette and its swatch control.
 *
 * Lives on its own (rather than inside the components rail, where it used to)
 * because the wire tool moved to the Inspector: CircuitView holds the current
 * colour, the Inspector renders the picker, and the Canvas draws with it.
 *
 * Every swatch carries a 1px dark-grey outline in addition to the selection
 * ring, so pale colours (yellow) and dark ones (black) both read against the
 * rail background instead of dissolving into it.
 */

import React from 'react'

export const WIRE_COLORS = [
  '#2fa46a', // green
  '#e5544b', // red
  '#42a5f5', // blue
  '#f3cb00', // yellow
  '#f28c28', // orange
  '#9b5de5', // purple
  '#111111', // black
  '#79818c' // grey
]

export const WIRE_COLOR_NAMES: Record<string, string> = {
  '#2fa46a': 'Green',
  '#e5544b': 'Red',
  '#42a5f5': 'Blue',
  '#f3cb00': 'Yellow',
  '#f28c28': 'Orange',
  '#9b5de5': 'Purple',
  '#111111': 'Black',
  '#79818c': 'Grey'
}

/** 1px hairline drawn on every swatch so light/dark fills stay visible. */
const SWATCH_OUTLINE = '#3f4650'

export function ColorSwatch({
  color,
  selected,
  size = 18,
  title,
  onClick
}: {
  color: string
  selected: boolean
  size?: number
  title?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title ?? WIRE_COLOR_NAMES[color.toLowerCase()] ?? color}
      aria-label={WIRE_COLOR_NAMES[color.toLowerCase()] ?? color}
      aria-pressed={selected}
      className="rounded-full shrink-0 transition-transform hover:scale-110"
      style={{
        width: size,
        height: size,
        background: color,
        // hairline first, selection ring outside it — so the outline survives
        // selection instead of being overdrawn by the brand-coloured ring
        boxShadow: selected
          ? `0 0 0 1px ${SWATCH_OUTLINE}, 0 0 0 3px var(--brand)`
          : `0 0 0 1px ${SWATCH_OUTLINE}`
      }}
    />
  )
}

/** The row of wire colours. `value` is highlighted; picking one calls onPick. */
export function WireColorRow({
  value,
  onPick,
  size = 18
}: {
  value: string
  onPick: (c: string) => void
  size?: number
}): React.JSX.Element {
  const cur = value.toLowerCase()
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {WIRE_COLORS.map((c) => (
        <ColorSwatch
          key={c}
          color={c}
          size={size}
          selected={c.toLowerCase() === cur}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  )
}
