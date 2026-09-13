// One tag chip. Board/expansion tags wear their board's real solder-mask
// colour (see lib/exampleTags + the --board-* ramps in assets/base.css) so the
// chip on the card matches the PCB on the bench; topic tags stay neutral, which
// is what keeps the colours meaningful rather than decorative.

import { cn } from '@renderer/lib/utils'
import { getTagMeta, tagChipStyle } from '@renderer/lib/exampleTags'
import { Tag } from './ui/Tag'

interface ExampleTagProps {
  /** Canonical slug (or any alias — it is resolved here). */
  slug: string
  selected?: boolean
  /** Result count shown after the label, for filter-bar chips. */
  count?: number
  /** Omit to render a static, non-interactive chip. */
  onToggle?: (slug: string) => void
  /** Dimmed + inert: selecting this would produce no results. */
  disabled?: boolean
  className?: string
}

export function ExampleTag({
  slug,
  selected = false,
  count,
  onToggle,
  disabled = false,
  className
}: ExampleTagProps): React.JSX.Element {
  const meta = getTagMeta(slug)
  const interactive = Boolean(onToggle) && !disabled

  return (
    <Tag
      className={cn(meta.kind === 'board' && 'ts-tag--board', disabled && 'opacity-40', className)}
      style={tagChipStyle(meta)}
      selected={selected}
      onClick={interactive ? () => onToggle?.(meta.slug) : undefined}
      {...(interactive
        ? {
            role: 'checkbox',
            'aria-checked': selected,
            tabIndex: 0,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onToggle?.(meta.slug)
              }
            }
          }
        : {})}
      title={meta.kind === 'board' ? `${meta.label} — board or expansion` : meta.label}
    >
      {meta.label}
      {count !== undefined && <span className="ts-tag__count">{count}</span>}
    </Tag>
  )
}
