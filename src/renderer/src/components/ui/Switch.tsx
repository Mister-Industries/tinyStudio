/* eslint-disable @typescript-eslint/explicit-function-return-type */
'use client'

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@renderer/lib/utils'

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-6 w-10 shrink-0 items-center rounded-full border-[1.5px] border-[var(--border-default)] shadow-[var(--highlight-top),inset_0_1px_2px_rgba(20,19,16,0.08)] transition-all outline-none data-[state=checked]:bg-[var(--green)] data-[state=checked]:border-[var(--green-deep)] data-[state=unchecked]:bg-[var(--warm-300)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block size-[18px] rounded-full bg-white border-[1.5px] border-[var(--border-default)] shadow-[0_1px_2px_rgba(20,19,16,0.18),var(--highlight-top)] ring-0 transition-transform data-[state=checked]:translate-x-[16px] data-[state=unchecked]:translate-x-0'
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
