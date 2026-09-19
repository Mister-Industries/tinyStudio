/**
 * ShortcutsDialog: every keyboard shortcut tinyStudio defines, from
 * lib/shortcuts. Opened from the tinyStudio menu and with Mod+/.
 */

import { keysOf, shortcutsByScope, MOD_LABEL } from '@renderer/lib/shortcuts'
import { Button } from './ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/Dialog'

export function ShortcutsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            {MOD_LABEL} is the modifier on this computer. The code editor also has its own shortcuts
            for editing text, such as find and toggle comment.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          {shortcutsByScope().map((group) => (
            <section key={group.scope} className="flex flex-col gap-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
                {group.label}
              </h3>
              <ul className="flex flex-col">
                {group.items.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-baseline justify-between gap-3 border-b border-[var(--border-soft)] py-1.5 text-[13px] last:border-b-0"
                  >
                    <span className="min-w-0 text-[var(--text-body)]">
                      {s.label}
                      {s.when && <span className="text-[var(--text-muted)]"> ({s.when})</span>}
                    </span>
                    <kbd className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-sunken)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-strong)]">
                      {keysOf(s.id)}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
