import * as React from 'react'
import { cn } from '@renderer/lib/utils'
import { X } from 'lucide-react'

/* tinyStudio — Tag / Chip
   For libraries, board capabilities, filters. Optional leading icon and a
   removable affordance. Square-ish radius (not pill). */

type TagProps = Omit<React.ComponentProps<'span'>, 'onClick'> & {
  icon?: React.ReactNode
  onRemove?: (e: React.MouseEvent) => void
  selected?: boolean
  onClick?: (e: React.MouseEvent) => void
}

export function Tag({
  icon = null,
  onRemove,
  selected = false,
  onClick,
  className,
  children,
  ...rest
}: TagProps): React.ReactElement {
  return (
    <span
      className={cn('ts-tag', onClick && 'ts-tag--clickable', selected && 'ts-tag--selected', className)}
      onClick={onClick}
      {...rest}
    >
      {icon && <span className="ts-tag__ico">{icon}</span>}
      {children}
      {onRemove && (
        <span
          className="ts-tag__x"
          role="button"
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation()
            onRemove(e)
          }}
        >
          <X size={11} />
        </span>
      )}
    </span>
  )
}
