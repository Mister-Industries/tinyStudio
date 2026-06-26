import * as React from 'react'
import { cn } from '@renderer/lib/utils'
import { Check } from 'lucide-react'

/* tinyStudio — Checkbox (tactile, hard-edged) */

type CheckboxProps = Omit<React.ComponentProps<'input'>, 'type'> & {
  label?: React.ReactNode
}

export function Checkbox({
  label,
  disabled = false,
  className,
  id,
  ...rest
}: CheckboxProps): React.ReactElement {
  const autoId = React.useId()
  const fieldId = id || autoId
  return (
    <label
      className={cn('ts-check', disabled && 'ts-check--disabled', className)}
      htmlFor={fieldId}
    >
      <input type="checkbox" id={fieldId} disabled={disabled} {...rest} />
      <span className="ts-check__box" aria-hidden="true">
        <Check strokeWidth={3.5} />
      </span>
      {label && <span className="ts-check__label">{label}</span>}
    </label>
  )
}
