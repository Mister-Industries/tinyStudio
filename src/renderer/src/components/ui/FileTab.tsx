/* eslint-disable @typescript-eslint/explicit-function-return-type */
'use client'

import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@renderer/lib/utils'
import { X } from 'lucide-react'
import * as React from 'react'

export interface FileTabData {
  id: string
  name: string
  modified: boolean
}

export interface FileTabTriggerProps extends React.ComponentProps<typeof TabsPrimitive.Trigger> {
  file: FileTabData
  onFileClose: (fileId: string) => void
}

function FileTabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="file-tabs"
      className={cn('flex flex-col', className)}
      {...props}
    />
  )
}

function FileTabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="file-tabs-list"
      className={cn(
        'flex justify-between w-full h-[36px] border-b-[1.5px] border-[var(--border-default)] bg-[var(--bg-sunken)]',
        className
      )}
      {...props}
    />
  )
}

function FileTabTrigger({ className, file, onFileClose, ...props }: FileTabTriggerProps) {
  const handleCloseClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onFileClose?.(file.id)
  }

  return (
    <TabsPrimitive.Trigger
      data-slot="file-tab-trigger"
      className={cn(
        "relative text-[13px] justify-start px-3.5 h-full text-[var(--text-muted)] data-[state=active]:bg-[var(--surface-card)] data-[state=active]:text-[var(--text-strong)] data-[state=active]:shadow-[inset_0_2.5px_0_0_var(--brand)] hover:text-[var(--text-body)] transition-colors cursor-pointer flex items-center gap-2 whitespace-nowrap border-r-[1.5px] border-[var(--border-soft)]",
        className
      )}
      {...props}
    >
      <span>{file.name}</span>
      {file.modified && (
        <span className="w-2 h-2 bg-signal-warning rounded-full" title="Unsaved changes" />
      )}
      <div
        className="size-4 p-0 rounded hover:bg-muted-foreground/20 flex items-center justify-center cursor-pointer"
        onClick={handleCloseClick}
        onMouseDown={(e) => e.stopPropagation()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleCloseClick(e as unknown as React.MouseEvent)
          }
        }}
      >
        <X size={10} />
      </div>
    </TabsPrimitive.Trigger>
  )
}

function FileTabContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="file-tab-content"
      className={cn('flex-1 outline-none h-full relative', className)}
      {...props}
    />
  )
}

export { FileTabContent, FileTabs, FileTabsList, FileTabTrigger }
