import * as React from 'react'
import { cn } from '@renderer/lib/utils'

/* tinyStudio — StatusPill
   The IDE's board / connection state indicator: a live status dot (optionally
   pulsing) + label. Wrap the strong part of the label in <b> for emphasis. */

type StatusPillProps = React.ComponentProps<'span'> & {
  status?: 'ok' | 'error' | 'warn' | 'info' | 'idle'
  pulse?: boolean
  bare?: boolean
}

export function StatusPill({
  status = 'idle',
  pulse = false,
  bare = false,
  className,
  children,
  ...rest
}: StatusPillProps): React.ReactElement {
  return (
    <span
      className={cn(
        'ts-status',
        `ts-status--${status}`,
        pulse && 'ts-status--pulse',
        bare && 'ts-status--bare',
        className
      )}
      {...rest}
    >
      <span className="ts-status__dot" aria-hidden="true" />
      <span className="ts-status__label">{children}</span>
    </span>
  )
}
