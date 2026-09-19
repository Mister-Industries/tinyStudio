/**
 * MakeItMine: the read-only-example affordance.
 *
 * A project opened from someone else's repo is editable but not pushable. The
 * rule this component exists to enforce: **saving never blocks**. Edits go to
 * local storage instantly, exactly as they do for a project the user owns, and
 * the only thing this adds is a standing, dismissible offer to turn those edits
 * into a repo of their own. Putting that prompt on Ctrl+S would interrupt
 * people mid-thought and make a permanent decision feel like a typo.
 */

import { adoptCopiedProject } from '@renderer/commands/fileCommands'
import { useGitHubAccount } from '@renderer/hooks/useGitHubAccount'
import { useIsBrowserOnlyProject } from '@renderer/hooks/useIsBrowserOnlyProject'
import { useIsReadOnlyProject } from '@renderer/hooks/useIsReadOnlyProject'
import {
  collectWorkspaceFiles,
  copyProjectToNewRepo,
  sanitizeRepoName,
  suggestRepoName
} from '@renderer/lib/github'
import { notify as toast } from '@renderer/lib/notify'
import { fileSystem } from '@renderer/lib/fileSystem'
import {
  saveFileWithContent,
  selectOpenFiles,
  useAppDispatch,
  useAppSelector
} from '@renderer/redux'
import { GitFork, Loader2, Lock, X } from 'lucide-react'
import React from 'react'
import { Button } from './ui/Button'
import { Checkbox } from './ui/Checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/Dialog'
import { Input } from './ui/Input'

export function MakeItMine(): React.JSX.Element | null {
  const workspace = useAppSelector((state) => state.file.workspace)
  const openFiles = useAppSelector(selectOpenFiles)
  const dispatch = useAppDispatch()
  const { account } = useGitHubAccount()
  const readOnly = useIsReadOnlyProject()
  // A browser-only project gets the "save to computer" banner instead; one
  // notice at a time. This offer returns once the project has a folder.
  const browserOnly = useIsBrowserOnlyProject()

  const [dismissed, setDismissed] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [isPrivate, setIsPrivate] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)

  // A different project is a different offer: un-dismiss when the source changes.
  const sourceKey = workspace?.source
    ? `${workspace.source.owner}/${workspace.source.repo}/${workspace.source.path}`
    : ''
  React.useEffect(() => {
    setDismissed(false)
  }, [sourceKey])

  if (!workspace || !readOnly || dismissed || browserOnly) return null

  const deferred = workspace.source?.manifest.filter((m) => m.skipped).length ?? 0

  const openDialog = async (): Promise<void> => {
    if (!account) {
      toast.info('Sign in to GitHub first', {
        description:
          'Your edits are saved locally either way; signing in is only needed to make a repo.'
      })
      return
    }
    setOpen(true)
    const seed = workspace.name || workspace.source?.repo || 'my-project'
    setName(sanitizeRepoName(seed))
    try {
      setName(await suggestRepoName(account.login, seed, account.token))
    } catch {
      /* availability is a nicety; the create call is the real authority */
    }
  }

  const make = async (): Promise<void> => {
    if (!account || !name.trim()) return
    setBusy('Preparing…')
    try {
      // Flush unsaved buffers first: the copy reads the working tree off the
      // filesystem, so anything still sitting in an editor would be left behind.
      const dirty = openFiles.filter((f) => f.modified && f.path)
      await Promise.all(
        dirty.map(async (f) => {
          await fileSystem.writeFile(f.path, f.content)
          dispatch(saveFileWithContent({ id: f.id, content: f.content }))
        })
      )

      const files = await collectWorkspaceFiles(workspace)
      const { link, copied, failed } = await copyProjectToNewRepo({
        name,
        token: account.token,
        isPrivate,
        description: `${workspace.name}, built with tinyStudio`,
        files,
        source: workspace.source,
        onProgress: (msg) => setBusy(msg)
      })

      setBusy('Switching to your copy…')
      await adoptCopiedProject(workspace, link, account.login)

      setOpen(false)
      if (failed.length > 0) {
        toast.warning(`Copied ${copied} file(s), ${failed.length} failed`, {
          description: failed.slice(0, 4).join(', ') + (failed.length > 4 ? '…' : '')
        })
      } else {
        toast.success(`${link.remote} is yours`, {
          description: `${copied} file(s) copied. Saving now pushes to your own repo.`
        })
      }
    } catch (e) {
      toast.error('Could not make a copy', {
        description: e instanceof Error ? e.message : 'Unknown error'
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5 text-[12px] border-b-[1.5px] border-[var(--border-default)] bg-[var(--bg-sunken)]">
        <GitFork size={14} className="shrink-0 text-[var(--brand)]" />
        <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">
          You&apos;re editing{' '}
          <span className="text-[var(--text-body)]">
            {workspace.source?.owner}/{workspace.source?.repo}
          </span>
          . Changes save to this folder; make a copy to keep them on GitHub.
        </span>
        <Button size="sm" className="h-6 shrink-0 px-2 text-[12px]" onClick={openDialog}>
          Make it mine
        </Button>
        <button
          className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-body)]"
          title="Dismiss"
          onClick={() => setDismissed(true)}
        >
          <X size={13} />
        </button>
      </div>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitFork size={18} className="text-[var(--brand)]" /> Make it mine
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--text-muted)]">
              Creates a new repository on{' '}
              <span className="text-[var(--text-body)]">@{account?.login}</span> and copies this
              project into it
              {deferred > 0 ? `, including ${deferred} file(s) the editor didn't need to open` : ''}
              .
            </p>
            <Input
              autoFocus
              placeholder="repository name"
              value={name}
              disabled={!!busy}
              onChange={(e) => setName(sanitizeRepoName(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && !busy && make()}
            />
            <Checkbox
              checked={isPrivate}
              disabled={!!busy}
              onChange={(e) => setIsPrivate(e.target.checked)}
              label={
                <span className="flex items-center gap-1 text-xs">
                  <Lock size={12} /> Private repository
                </span>
              }
            />
            {isPrivate && (
              <p className="text-[11px] text-[var(--text-muted)]">
                GitHub Pages needs a public repo on the free plan, so Publish won&apos;t work until
                you make it public.
              </p>
            )}
            {busy && (
              <div className="flex items-center gap-2 truncate text-[11px] text-[var(--text-muted)]">
                <Loader2 size={12} className="shrink-0 animate-spin" />
                <span className="truncate">{busy}</span>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={!!busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={make} disabled={!!busy || !name.trim()}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <GitFork size={15} />}
                Create repository
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
