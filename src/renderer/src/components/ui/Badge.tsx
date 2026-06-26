import * as React from 'react'
import { cn } from '@renderer/lib/utils'

/* tinyStudio — Badge
   Compact status/label token (mono). Tones map to the four-ink semantic
   system. `soft` (default) = tinted bg; `solid` = filled ink; `outline`. */

type BadgeProps = React.ComponentProps<'span'> & {
  tone?: 'neutral' | 'red' | 'green' | 'blue' | 'yellow'
  variant?: 'soft' | 'solid' | 'outline'
  dot?: boolean
}

export function Badge({
  tone = 'neutral',
  variant = 'soft',
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps): React.ReactElement {
  return (
    <span
      className={cn('ts-badge', `ts-badge--${variant}`, `ts-badge--${tone}`, className)}
      {...rest}
    >
      {dot && <span className="ts-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  )
}
