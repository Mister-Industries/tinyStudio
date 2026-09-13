/**
 * SourceControl — GitHub panel for the file explorer. Sign in (see
 * GitHubSignIn), link the workspace to a repo, then Push / Pull / Publish.
 * The push set is the working tree diffed against the last-synced baseline.
 */

import { AdoptCopiedProjectCommand, RefreshWorkspaceCommand } from '@renderer/commands/fileCommands'
import { GitHubSignInButton } from '@renderer/components/GitHubSignIn'
import { useGitHubAccount } from '@renderer/hooks/useGitHubAccount'
import { useAppSelector } from '@renderer/redux'
import {
  canPushTo,
  changedPaths,
  collectWorkspaceFiles,
  copyProjectToNewRepo,
  ghRepoMeta,
  loadLink,
  pullWorkspace,
  pushWorkspace,
  saveLink,
  type RepoLink
} from '@renderer/lib/github'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  GitBranch,
  Github,
  Loader2,
  LogOut,
  UploadCloud
} from 'lucide-react'
import React from 'react'
import { notify as toast } from '@renderer/lib/notify'
import { Button } from '../ui/Button'
import { ScrollArea } from '../ui/ScrollArea'

export function SourceControl(): React.JSX.Element {
  const workspace = useAppSelector((state) => state.file.workspace)
  // Shared with the header sign-in, so connecting in either place updates both.
  const { account, signOut } = useGitHubAccount()
  const [link, setLink] = React.useState<RepoLink | null>(null)
  const [changed, setChanged] = React.useState<string[]>([])
  const [repoInput, setRepoInput] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)
  // null = not linked / unknown. Whether the *token* can push to the linked repo
  // — asked of GitHub rather than inferred from who we think the user is, so a
  // collaborator gets write access with no extra wiring and everyone else gets a
  // truthful read-only state.
  const [writable, setWritable] = React.useState<boolean | null>(null)

  // Load this workspace's repo link + compute the change set.
  const refreshChanges = React.useCallback(async () => {
    if (!workspace) return
    const l = loadLink(workspace.path)
    setLink(l)
    if (l) {
      const current = await collectWorkspaceFiles(workspace)
      setChanged(changedPaths(current, l.base))
      const [owner, repo] = l.remote.split('/')
      setWritable(await canPushTo(owner, repo, account?.token))
    } else {
      setChanged([])
      setWritable(null)
    }
  }, [workspace, account?.token])

  React.useEffect(() => {
    refreshChanges()
  }, [refreshChanges])

  const linkRepo = async (): Promise<void> => {
    if (!workspace || !repoInput.trim()) return
    setBusy('link')
    try {
      const cleaned = repoInput.trim().replace(/\.git$/, '')
      const m =
        cleaned.match(/github\.com\/([^/]+)\/([^/?#]+)(?:\/(?:tree\/[^/]+\/)?([^?#]*))?/) ||
        cleaned.match(/^([^/\s]+)\/([^/\s]+)(?:\/(.*))?$/)
      if (!m) throw new Error('Enter a repo as owner/name or a github.com URL')
      const meta = await ghRepoMeta(m[1], m[2], account?.token)
      // A workspace opened from a repo subfolder must stay pinned to that
      // subfolder, or push flattens the project onto the repo root.
      const sameRepo =
        workspace.source &&
        `${workspace.source.owner}/${workspace.source.repo}`.toLowerCase() ===
          meta.fullName.toLowerCase()
      const repoPath = (m[3] || (sameRepo ? workspace.source!.path : '') || '').replace(
        /^\/+|\/+$/g,
        ''
      )
      const newLink: RepoLink = {
        remote: meta.fullName,
        branch: meta.branch,
        path: repoPath,
        base: {}
      }
      // Pull to populate the baseline + working tree from the remote.
      const base = await pullWorkspace(workspace, newLink, account?.token, (msg) => setBusy(msg))
      newLink.base = base
      saveLink(workspace.path, newLink)
      if (workspace) await new RefreshWorkspaceCommand(workspace).execute()
      setRepoInput('')
      await refreshChanges()
      toast.success(`Linked ${meta.fullName}`)
    } catch (e) {
      toast.error('Could not link repo', {
        description: e instanceof Error ? e.message : 'Unknown error'
      })
    } finally {
      setBusy(null)
    }
  }

  const push = async (): Promise<void> => {
    if (!workspace || !link || !account) return
    setBusy('Pushing…')
    try {
      const { pushed, base } = await pushWorkspace(
        workspace,
        link,
        account.token,
        'Update via tinyStudio',
        (msg) => setBusy(msg)
      )
      const updated = { ...link, base }
      setLink(updated)
      setChanged([])
      toast.success(pushed > 0 ? `Pushed ${pushed} file(s)` : 'Nothing to push')
      // The push already landed on GitHub; only the local baseline can fail
      // here, and reporting that as "Push failed" would send people looking in
      // the wrong place.
      try {
        saveLink(workspace.path, updated)
      } catch (e) {
        toast.error('Pushed, but could not save the sync baseline', {
          description: e instanceof Error ? e.message : 'Unknown error'
        })
      }
    } catch (e) {
      toast.error('Push failed', { description: e instanceof Error ? e.message : 'Unknown error' })
    } finally {
      setBusy(null)
    }
  }

  const pull = async (): Promise<void> => {
    if (!workspace || !link) return
    setBusy('Pulling…')
    try {
      const base = await pullWorkspace(workspace, link, account?.token, (msg) => setBusy(msg))
      const updated = { ...link, base }
      saveLink(workspace.path, updated)
      setLink(updated)
      await new RefreshWorkspaceCommand(workspace).execute()
      await refreshChanges()
      toast.success('Pulled latest')
    } catch (e) {
      toast.error('Pull failed', { description: e instanceof Error ? e.message : 'Unknown error' })
    } finally {
      setBusy(null)
    }
  }

  const publish = async (): Promise<void> => {
    if (!workspace || !account || !repoInput.trim()) return
    setBusy('Publishing…')
    try {
      // Repos are created PUBLIC so GitHub Pages works on the free plan (Pages
      // on private repos needs a paid plan) and so the project can be shared.
      //
      // This goes through the same copy path as "Make it mine" so a project
      // opened from an example publishes *complete* — including the files whose
      // bytes were never downloaded, which a plain push of the working tree
      // would leave behind.
      const {
        link: linked,
        copied,
        failed
      } = await copyProjectToNewRepo({
        name: repoInput.trim(),
        token: account.token,
        isPrivate: false,
        description: `${workspace.name} — built with tinyStudio`,
        files: await collectWorkspaceFiles(workspace),
        source: workspace.source,
        onProgress: (msg) => setBusy(msg)
      })
      await new AdoptCopiedProjectCommand(workspace, linked, account.login).execute()
      setLink(linked)
      setRepoInput('')
      await refreshChanges()
      if (failed.length > 0) {
        toast.warning(`Published ${linked.remote} — ${failed.length} file(s) failed`, {
          description: failed.slice(0, 4).join(', ') + (failed.length > 4 ? '…' : '')
        })
      } else {
        toast.success(`Published ${linked.remote}`, { description: `${copied} file(s) copied.` })
      }
    } catch (e) {
      toast.error('Publish failed', {
        description: e instanceof Error ? e.message : 'Unknown error'
      })
    } finally {
      setBusy(null)
    }
  }

  const input =
    'w-full bg-navy-900 border border-navy-400 rounded-lg px-3 py-2 text-sm text-fg-1 placeholder:text-fg-4 outline-none focus:border-cyan'

  return (
    <div className="h-full flex flex-col">
      {!workspace ? (
        <div className="p-4 text-sm text-fg-4 text-center">
          Open a project to use source control.
        </div>
      ) : !account ? (
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-fg-2">
            <Github size={16} /> Connect to GitHub
          </div>
          <p className="text-xs text-fg-3">
            Sign in to link this project to a repository, push your changes, and publish to GitHub
            Pages.
          </p>
          <GitHubSignInButton block />
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {/* account */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-navy-600">
            {account.avatarUrl && (
              <img src={account.avatarUrl} alt="" className="w-6 h-6 rounded-full" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xs text-fg-1 truncate">{account.name}</div>
              <div className="text-[10px] text-fg-4 truncate">@{account.login}</div>
            </div>
            <button
              className="text-fg-4 hover:text-signal-error"
              title="Sign out"
              onClick={signOut}
            >
              <LogOut size={14} />
            </button>
          </div>

          {!link ? (
            <div className="p-4 flex flex-col gap-3">
              <div className="text-xs text-fg-3">
                Link this project to a repository, or publish a new one. New repos are created{' '}
                <span className="text-fg-2">public</span> so GitHub Pages works.
              </div>
              <input
                className={input}
                placeholder="new repo name (or owner/name to link)"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  onClick={linkRepo}
                  disabled={!!busy || !repoInput.trim()}
                  className="flex-1"
                  variant="outline"
                >
                  {busy === 'link' ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <ArrowDownToLine size={15} />
                  )}
                  Link & pull
                </Button>
                <Button onClick={publish} disabled={!!busy || !repoInput.trim()} className="flex-1">
                  {busy === 'Publishing…' ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <UploadCloud size={15} />
                  )}
                  Publish
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="px-4 py-2 border-b border-navy-600 flex items-center gap-2 text-xs">
                <GitBranch size={13} className="text-cyan" />
                <span className="text-fg-1 truncate flex-1">
                  {link.remote}
                  {link.path ? <span className="text-fg-4">/{link.path}</span> : null}
                </span>
                <span className="font-mono text-fg-4">{link.branch}</span>
              </div>
              <div className="px-4 py-1 text-[11px] font-semibold tracking-wider text-fg-3">
                CHANGES ({changed.length})
              </div>
              <ScrollArea className="flex-1">
                <div className="px-4 pb-3 flex flex-col gap-0.5">
                  {changed.length === 0 ? (
                    <div className="text-xs text-fg-4 py-2">
                      Working tree matches the last sync.
                    </div>
                  ) : (
                    changed.map((p) => (
                      <div key={p} className="flex items-center gap-2 text-xs text-fg-2 py-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-signal-warning shrink-0" />
                        <span className="truncate font-mono">{p}</span>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
              {writable === false && (
                <div className="px-4 py-2 text-[11px] text-fg-3 border-t border-navy-600">
                  You don&apos;t have write access to{' '}
                  <span className="text-fg-2">{link.remote}</span>. Your edits are saved locally —
                  publish a copy to keep them on GitHub.
                </div>
              )}
              <div className="px-4 py-2 flex gap-2">
                <Button
                  onClick={push}
                  disabled={!!busy || writable === false}
                  className="flex-1"
                  size="sm"
                  title={writable === false ? 'Read-only: no write access to this repo' : undefined}
                >
                  {busy && busy.startsWith('Push') ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ArrowUpToLine size={14} />
                  )}
                  Push{changed.length > 0 ? ` (${changed.length})` : ''}
                </Button>
                <Button
                  onClick={pull}
                  disabled={!!busy}
                  variant="outline"
                  className="flex-1"
                  size="sm"
                >
                  {busy && busy.startsWith('Pull') ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ArrowDownToLine size={14} />
                  )}
                  Pull
                </Button>
              </div>
            </>
          )}
          {busy && busy.includes('·') && (
            <div className="px-4 py-1.5 text-[11px] text-fg-3 border-t border-navy-600 truncate">
              {busy}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
