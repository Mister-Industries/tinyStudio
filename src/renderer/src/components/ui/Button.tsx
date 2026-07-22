import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@renderer/lib/utils'

/* tinyStudio — Button
   The signature "pixel-art" tactile control: a top inner highlight + a solid
   colored bottom edge + a soft ambient shadow. Filled variants lift on hover
   and press DOWN on click (see .tactile / .tactile-bordered in ds-components.css).
   All historical variant/size names are preserved so existing call sites keep
   working — they're just remapped onto the new design language. */

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] font-semibold tracking-[-0.01em] select-none transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
  {
    variants: {
      variant: {
        // filled — tactile depth, lifts/presses
        default: 'tactile bg-primary text-white [--_edge:var(--brand-deep)]',
        destructive: 'tactile bg-[var(--red)] text-white [--_edge:var(--red-deep)]',
        success: 'tactile bg-[var(--green)] text-white [--_edge:var(--green-deep)]',
        warning:
          'tactile bg-[var(--yellow)] text-[var(--yellow-contrast)] [--_edge:var(--yellow-deep)]',
        // bordered tactile — neutral actions
        secondary: 'tactile-bordered bg-card text-[var(--text-strong)]',
        outline: 'tactile-bordered bg-background text-[var(--text-strong)]',
        // flat soft — quiet neutral
        muted:
          'border-[1.5px] border-[var(--border-soft)] bg-[var(--bg-sunken)] text-[var(--text-body)] hover:border-[var(--border-interactive)]',
        // chromeless
        ghost:
          'bg-transparent text-[var(--text-body)] hover:bg-[var(--bg-sunken)] active:translate-y-px',
        toolbarGhost:
          'bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-sunken)] hover:text-[var(--text-strong)] active:translate-y-px',
        destructiveGhost:
          'bg-transparent text-[var(--text-body)] hover:bg-[var(--red-soft)] hover:text-[var(--red-on)] active:translate-y-px',
        link: 'text-[var(--brand)] underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-[38px] px-4 text-sm has-[>svg]:px-3',
        sm: 'h-[30px] gap-1.5 rounded-[var(--radius-sm)] px-3 text-sm has-[>svg]:px-2.5',
        lg: 'h-[46px] px-6 text-base has-[>svg]:px-4',
        icon: 'size-[38px] rounded-[var(--radius-sm)] p-0'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }): React.ReactElement {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants }
