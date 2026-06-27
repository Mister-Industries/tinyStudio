import * as React from 'react'
import { cn } from '@renderer/lib/utils'

/* tinyStudio — IconButton
   Square tactile control for icon-only actions (toolbars, IDE chrome).
   Requires an accessible `label`. Use `active` for toggled tools. */

type IconButtonProps = React.ComponentProps<'button'> & {
  label: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'default' | 'ghost'
  active?: boolean
}

const sizes = {
  sm: 'size-[30px]',
  md: 'size-[38px]',
  lg: 'size-[46px]'
}

export function IconButton({
  label,
  size = 'md',
  variant = 'default',
  active = false,
  className,
  children,
  ...rest
}: IconButtonProps): React.ReactElement {
  return (
    <button
      aria-label={label}
      aria-pressed={active || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--radius-sm)] leading-none outline-none transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50',
        sizes[size],
        variant === 'default' && !active && 'tactile-bordered bg-card text-[var(--text-strong)]',
        variant === 'ghost' &&
          !active &&
          'bg-transparent text-[var(--text-body)] hover:bg-[var(--bg-sunken)]',
        active && 'border-[1.5px] border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-on)]',
        className
      )}
      {...rest}
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  )
}
