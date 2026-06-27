/* eslint-disable @typescript-eslint/explicit-function-return-type */
'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@renderer/lib/utils'

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'inline-flex items-stretch gap-5 border-b-[1.5px] border-[var(--border-soft)]',
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // underline strip: brand label + a 2.5px underline that scales in under the active tab
        "relative inline-flex items-center gap-[7px] whitespace-nowrap px-0.5 py-[9px] text-xs font-semibold text-[var(--text-muted)] outline-none transition-colors hover:text-[var(--text-body)] data-[state=active]:text-[var(--text-strong)] focus-visible:text-[var(--text-strong)] disabled:pointer-events-none disabled:opacity-50 after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-[1.5px] after:h-[2.5px] after:origin-bottom after:scale-x-0 after:rounded-t-[2px] after:bg-[var(--brand)] after:transition-transform after:duration-[180ms] after:ease-[cubic-bezier(0.2,0.8,0.2,1)] after:content-[''] data-[state=active]:after:scale-x-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
