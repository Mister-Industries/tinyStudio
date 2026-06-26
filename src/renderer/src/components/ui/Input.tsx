/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { cn } from '@renderer/lib/utils'
import * as React from 'react'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-foreground placeholder:text-[var(--text-faint)] flex h-[38px] w-full min-w-0 rounded-[var(--radius-sm)] border-[1.5px] border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-1 text-sm text-[var(--text-strong)] transition-[color,box-shadow,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-55',
        'hover:border-[var(--border-interactive)]',
        'focus-visible:border-[var(--brand)] focus-visible:shadow-[0_0_0_3px_var(--brand-soft)]',
        'aria-invalid:border-[var(--red)] aria-invalid:focus-visible:shadow-[0_0_0_3px_var(--red-soft)]',
        className
      )}
      {...props}
    />
  )
}

export { Input }
