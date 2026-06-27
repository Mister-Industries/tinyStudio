import * as React from 'react'
import { cn } from '@renderer/lib/utils'

/* tinyStudio — Radio + RadioGroup */

type RadioProps = Omit<React.ComponentProps<'input'>, 'type'> & {
  label?: React.ReactNode
}

export function Radio({ label, disabled = false, className, id, ...rest }: RadioProps): React.ReactElement {
  const autoId = React.useId()
  const fieldId = id || autoId
  return (
    <label className={cn('ts-radio', className)} htmlFor={fieldId}>
      <input type="radio" id={fieldId} disabled={disabled} {...rest} />
      <span className="ts-radio__dot" aria-hidden="true" />
      {label && <span>{label}</span>}
    </label>
  )
}

type Option = string | { value: string; label: React.ReactNode }

export function RadioGroup({
  name,
  value,
  onChange,
  options = [],
  row = false,
  className
}: {
  name: string
  value?: string
  onChange?: (value: string, e: React.ChangeEvent<HTMLInputElement>) => void
  options?: Option[]
  row?: boolean
  className?: string
}): React.ReactElement {
  return (
    <div className={cn('ts-radiogroup', row && 'ts-radiogroup--row', className)} role="radiogroup">
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value
        const lab = typeof o === 'string' ? o : o.label
        return (
          <Radio
            key={val}
            name={name}
            value={val}
            label={lab}
            checked={value === val}
            onChange={(e) => onChange?.(val, e)}
          />
        )
      })}
    </div>
  )
}
