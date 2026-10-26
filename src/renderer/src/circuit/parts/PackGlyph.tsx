/**
 * PackGlyph — a parts bin's tab mark, in whatever form the pack shipped it.
 *
 * `PackIndexEntry.icon` carries one of three things, and both the palette's
 * vertical rail and the Pack Manager's list have to render all three:
 *
 *  - a data-URI PNG — Fritzing's own bin artwork, lifted out of
 *    `fritzing-parts/bins/more/` by scripts/lib/bin-icons.mjs
 *  - a raw SVG document — a couple of bins store one in the icon attribute
 *  - a two-letter monogram ("SN", "AR") — the fallback for bins Fritzing never
 *    drew, or whose artwork isn't in the repo
 */

import React from 'react'

export function PackGlyph({
  icon,
  size = 18,
  className = ''
}: {
  icon?: string
  size?: number
  className?: string
}): React.JSX.Element {
  if (icon?.startsWith('data:'))
    return (
      <img
        src={icon}
        alt=""
        draggable={false}
        className={`object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    )

  if (icon?.startsWith('<'))
    return (
      <span
        className={`grid place-items-center [&>svg]:max-w-full [&>svg]:max-h-full ${className}`}
        style={{ width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: icon }}
      />
    )

  return (
    <span className={`text-[10px] font-bold tracking-tight leading-none ${className}`}>
      {icon || '··'}
    </span>
  )
}
