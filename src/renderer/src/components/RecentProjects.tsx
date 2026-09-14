// RecentProjects — one-click reopen for folders and GitHub repos opened before.
// Shown on the start screen and in the Open dialog; renders nothing when empty.

import { openRecentFolder } from '@renderer/commands/fileCommands'
import { notify as toast } from '@renderer/lib/notify'
import {
  forgetRecentProject,
  listRecentProjects,
  RECENTS_EVENT,
  rememberGitHubProject,
  type RecentProject
} from '@renderer/lib/projectStore'
import { navigateToProject } from '@renderer/lib/projectRouting'
import { isElectron } from '@renderer/lib/utils'
import { Folder, Github, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

function describe(entry: RecentProject): string {
  if (entry.kind === 'github') return entry.location
  if (!isElectron()) return 'Folder on this computer'
  // Desktop: the parent folder, since the name is already shown.
  const slash = entry.location.lastIndexOf('/')
  return slash > 0 ? entry.location.slice(0, slash) : entry.location
}

export function RecentProjects({
  limit = 8,
  className,
  onOpened
}: {
  limit?: number
  className?: string
  onOpened?: () => void
}): React.JSX.Element | null {
  const [recents, setRecents] = useState(listRecentProjects)
  const [opening, setOpening] = useState<string | null>(null)

  useEffect(() => {
    const sync = (): void => setRecents(listRecentProjects())
    window.addEventListener(RECENTS_EVENT, sync)
    return () => window.removeEventListener(RECENTS_EVENT, sync)
  }, [])

  if (recents.length === 0) return null

  const open = async (entry: RecentProject): Promise<void> => {
    setOpening(entry.id)
    try {
      if (entry.kind === 'github' && entry.owner && entry.repo) {
        await navigateToProject(entry.owner, entry.repo, entry.repoPath ?? '')
        rememberGitHubProject(entry.owner, entry.repo, entry.repoPath)
        onOpened?.()
        return
      }
      const result = await openRecentFolder(entry)
      if (result === 'opened') {
        onOpened?.()
      } else if (result === 'missing') {
        forgetRecentProject(entry.id)
        toast.error(`Couldn't find ${entry.name}`, {
          description: 'It may have been moved or deleted, so it was removed from Recent.'
        })
      } else {
        toast.info(`tinyStudio wasn't allowed into ${entry.name}`, {
          description: isElectron()
            ? 'Choose the folder again so tinyStudio can open it.'
            : 'Click it again and choose Allow when your browser asks.'
        })
      }
    } catch (e) {
      toast.error(`Could not open ${entry.name}`, {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className={className}>
      <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
        Recent
      </div>
      <ul className="flex flex-col">
        {recents.slice(0, limit).map((entry) => (
          <li key={entry.id} className="group/recent relative">
            <button
              type="button"
              onClick={() => open(entry)}
              disabled={!!opening}
              title={entry.location}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 pr-8 text-left hover:bg-[var(--bg-sunken)] disabled:cursor-default disabled:opacity-60"
            >
              {opening === entry.id ? (
                <Loader2 size={15} className="shrink-0 animate-spin text-[var(--text-muted)]" />
              ) : entry.kind === 'github' ? (
                <Github size={15} className="shrink-0 text-[var(--text-muted)]" />
              ) : (
                <Folder size={15} className="shrink-0 text-[var(--brand)]" />
              )}
              {/* The name wins the space; the location is the one that truncates. */}
              <span className="max-w-[65%] shrink-0 truncate text-[13px] font-semibold text-[var(--text-body)]">
                {entry.name}
              </span>
              <span className="ml-auto min-w-0 truncate text-right text-xs text-[var(--text-faint)]">
                {describe(entry)}
              </span>
            </button>
            <button
              type="button"
              title="Remove from Recent"
              aria-label={`Remove ${entry.name} from Recent`}
              onClick={() => forgetRecentProject(entry.id)}
              className="absolute right-1 top-1/2 -translate-y-1/2 cursor-pointer rounded-[var(--radius-xs)] p-1 text-[var(--text-faint)] opacity-0 hover:bg-[var(--bg-raised)] hover:text-[var(--text-body)] focus-visible:opacity-100 group-hover/recent:opacity-100"
            >
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
