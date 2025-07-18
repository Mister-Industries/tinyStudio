/* eslint-disable @typescript-eslint/explicit-function-return-type */
'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export interface FileTabData {
  id: string
  name: string
  modified: boolean
}

export interface FileTabTriggerProps extends React.ComponentProps<typeof TabsPrimitive.Trigger> {
  file: FileTabData
  onFileClose?: (fileId: string) => void
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
      className={cn('flex justify-between w-full h-10 border-b border-border', className)}
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
        'text-xs justify-start px-4 py-2 h-full border-b border-transparent data-[state=active]:bg-muted data-[state=active]:border-b data-[state=active]:border-primary hover:bg-muted/50 transition-colors cursor-pointer flex items-center gap-2 whitespace-nowrap',
        className
      )}
      {...props}
    >
      <span>{file.name}</span>
      {file.modified && (
        <span className="w-2 h-2 bg-orange-500 rounded-full" title="Unsaved changes" />
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
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  )
}

export { FileTabs, FileTabsList, FileTabTrigger, FileTabContent }
