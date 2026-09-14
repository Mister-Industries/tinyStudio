// Shown by the Circuit and Visual views when the project has no file for them
// yet. The view never creates the file on its own: the button does.

import { Loader2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '../ui/Button'

export function MissingFileView({
  icon,
  title,
  description,
  action,
  onAction
}: {
  icon: ReactNode
  title: string
  description: ReactNode
  action: string
  onAction: () => Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      await onAction()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="size-full flex flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-[var(--brand)]">{icon}</div>
      <p className="text-[var(--text-strong)] text-lg font-bold tracking-[-0.01em]">{title}</p>
      <div className="max-w-[44ch] text-sm text-[var(--text-muted)]">{description}</div>
      <Button className="mt-2" disabled={busy} onClick={run}>
        {busy && <Loader2 className="animate-spin" />}
        {action}
      </Button>
    </div>
  )
}
