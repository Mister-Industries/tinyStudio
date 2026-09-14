// OpenProjectDialog — "Open existing": a folder on this computer, a GitHub repo
// (pasted, or picked from your own), or something you had open recently.
//
// A GitHub repo opens in the browser first, like an example. Saving it to the
// computer is the clone step, and a repo you can push to stays linked, so Push
// and Pull keep working from the folder afterwards.

import { openFolder } from '@renderer/commands/fileCommands'
import { useGitHubAccount } from '@renderer/hooks/useGitHubAccount'
import { ghRepos, parseRepoRef, type RepoRef, type RepoSummary } from '@renderer/lib/github'
import { notify as toast } from '@renderer/lib/notify'
import { canSaveToComputer, rememberGitHubProject } from '@renderer/lib/projectStore'
import { navigateToProject } from '@renderer/lib/projectRouting'
import { isElectron } from '@renderer/lib/utils'
import { FolderOpen, Github, Loader2, Lock } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { RecentProjects } from './RecentProjects'
import { Button } from './ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/Dialog'
import { Input } from './ui/Input'

const sectionLabel =
  'px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]'

export function OpenProjectDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { account } = useGitHubAccount()
  const [input, setInput] = useState('')
  // What's opening: 'input' for the pasted repo, or a repo's full name.
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [repos, setRepos] = useState<RepoSummary[] | null>(null)
  const folders = canSaveToComputer()

  useEffect(() => {
    if (!open) return
    setInput('')
    setError(null)
    setBusy(null)
  }, [open])

  useEffect(() => {
    if (!open || !account) return
    let cancelled = false
    setRepos(null)
    ghRepos(account.token)
      .then((list) => !cancelled && setRepos(list))
      .catch(() => !cancelled && setRepos([]))
    return () => {
      cancelled = true
    }
  }, [open, account])

  const matches = useMemo(() => {
    const q = input.trim().toLowerCase()
    return (repos ?? []).filter((r) => !q || r.fullName.toLowerCase().includes(q)).slice(0, 30)
  }, [repos, input])

  const close = (): void => onOpenChange(false)

  const pickFolder = async (): Promise<void> => {
    // Close first: the system picker takes over anyway, and the dialog
    // shouldn't linger behind it.
    close()
    try {
      await openFolder()
    } catch (e) {
      toast.error('Could not open folder', {
        description: e instanceof Error ? e.message : String(e)
      })
    }
  }

  const openRepo = async (ref: RepoRef, key: string): Promise<void> => {
    setBusy(key)
    setError(null)
    try {
      await navigateToProject(ref.owner, ref.repo, ref.path, ref.branch)
      rememberGitHubProject(ref.owner, ref.repo, ref.path)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const submit = (): void => {
    const ref = parseRepoRef(input)
    if (!ref) {
      setError('Enter a repo as owner/name, owner/name/folder, or a github.com link.')
      return
    }
    void openRepo(ref, 'input')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Open a project</DialogTitle>
          <DialogDescription>
            Pick up a project from this computer or from GitHub.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-5">
          <button
            type="button"
            onClick={pickFolder}
            disabled={!folders || !!busy}
            className="tactile-bordered flex w-full cursor-pointer items-center gap-3 rounded-[var(--radius-md)] bg-card p-3 text-left disabled:cursor-not-allowed disabled:opacity-55"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--brand-soft)] text-[var(--brand)]">
              <FolderOpen size={20} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-bold text-[var(--text-strong)]">
                Folder on this computer
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {folders
                  ? 'Any sketch folder, including a repo you’ve cloned'
                  : 'Needs Chrome, Edge, or the desktop app'}
              </span>
            </span>
          </button>

          <section className="flex min-w-0 flex-col gap-2">
            <div className={sectionLabel}>GitHub repository</div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <Input
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  setError(null)
                }}
                placeholder="owner/repo or a github.com link"
                aria-label="GitHub repository"
                disabled={!!busy}
              />
              <Button type="submit" disabled={!!busy || !input.trim()}>
                {busy === 'input' ? <Loader2 className="animate-spin" /> : <Github />}
                Open
              </Button>
            </form>
            {error && <p className="px-1 text-xs text-[var(--red-on)]">{error}</p>}

            {!account ? (
              <p className="px-1 text-xs text-[var(--text-muted)]">
                Sign in to GitHub (top right) to pick from your own repositories, private ones
                included.
              </p>
            ) : repos === null ? (
              <div className="flex items-center gap-2 px-1 text-xs text-[var(--text-muted)]">
                <Loader2 size={12} className="animate-spin" /> Loading your repositories…
              </div>
            ) : (
              matches.length > 0 && (
                <ul className="max-h-44 overflow-y-auto rounded-[var(--radius-sm)] border-[1.5px] border-[var(--border-soft)] py-1">
                  {matches.map((r) => (
                    <li key={r.fullName}>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() =>
                          openRepo({ owner: r.owner, repo: r.name, path: '' }, r.fullName)
                        }
                        className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--bg-sunken)] disabled:cursor-default disabled:opacity-60"
                      >
                        {busy === r.fullName ? (
                          <Loader2 size={13} className="shrink-0 animate-spin" />
                        ) : r.private ? (
                          <Lock size={13} className="shrink-0 text-[var(--text-faint)]" />
                        ) : (
                          <Github size={13} className="shrink-0 text-[var(--text-faint)]" />
                        )}
                        <span className="min-w-0 shrink-0 truncate text-[13px] text-[var(--text-body)]">
                          {r.fullName}
                        </span>
                        {r.desc && (
                          <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-faint)]">
                            {r.desc}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </section>

          <RecentProjects limit={6} onOpened={close} />

          {!isElectron() && (
            <p className="px-1 text-[11px] leading-snug text-[var(--text-faint)]">
              Repos open in your browser first. Save one to put it in a folder on your computer — if
              you can push to it, it stays linked, so Push and Pull keep working.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
