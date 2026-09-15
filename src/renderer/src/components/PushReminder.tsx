/**
 * PushReminder — "3 changes not pushed to owner/repo", for a project linked to
 * a repo this account can push to. Hidden while nothing has changed since the
 * last sync. Push commits with a default message; the GitHub tab takes a
 * custom one.
 */

import { useRepoSync } from '@renderer/hooks/useRepoSync'
import { pushRepo } from '@renderer/lib/repoSync'
import { ArrowUpToLine, GitBranch, Loader2 } from 'lucide-react'
import { Button } from './ui/Button'

export function PushReminder(): React.JSX.Element | null {
  const { link, changed, deleted, writable, busy } = useRepoSync()
  const count = changed.length + deleted.length
  if (!link || writable !== true || (count === 0 && !busy)) return null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[12px] border-b-[1.5px] border-[var(--border-default)] bg-[var(--bg-sunken)]">
      <GitBranch size={14} className="shrink-0 text-[var(--brand)]" />
      <span className="min-w-0 flex-1 truncate text-[var(--text-body)]">
        {busy ? (
          busy
        ) : (
          <>
            <span className="font-semibold text-[var(--text-strong)]">
              {count} {count === 1 ? 'change' : 'changes'} not pushed
            </span>{' '}
            to {link.remote}
            {link.path ? `/${link.path}` : ''}
          </>
        )}
      </span>
      <Button
        size="sm"
        className="h-6 shrink-0 px-2 text-[12px]"
        disabled={!!busy}
        title={`Commit ${count === 1 ? 'this change' : 'these changes'} to ${link.branch} on GitHub`}
        onClick={() => void pushRepo()}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <ArrowUpToLine size={13} />}
        {busy ? 'Pushing…' : 'Push'}
      </Button>
    </div>
  )
}
