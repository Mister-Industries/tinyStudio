/**
 * SourceControl — GitHub panel for the file explorer. Sign in (see
 * GitHubSignIn), link the workspace to a repo, then Push / Pull / Publish.
 * The push set is the working tree diffed against the last-synced baseline,
 * shared with the push reminder through lib/repoSync.
 */

import { adoptCopiedProject, refreshWorkspace } from '@renderer/commands/fileCommands'
import { GitHubSignInButton } from '@renderer/components/GitHubSignIn'
import { useGitHubAccount } from '@renderer/hooks/useGitHubAccount'
import { useRepoSync } from '@renderer/hooks/useRepoSync'
import { useAppSelector } from '@renderer/redux'
import {
  collectWorkspaceFiles,
  copyProjectToNewRepo,
  ghRepoMeta,
  parseRepoRef,
  saveLink,
  type RepoLink
} from '@renderer/lib/github'
import { defaultPushMessage, pullWorkspace } from '@renderer/lib/githubSync'
import { pullRepo, pushRepo, refreshRepoSync } from '@renderer/lib/repoSync'
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
  // Whether the *token* can push is asked of GitHub rather than inferred from
  // who we think the user is, so a collaborator gets write access with no extra
  // wiring and everyone else gets a truthful read-only state.
  const { link, changed, deleted, writable, busy: syncBusy } = useRepoSync()
  const [repoInput, setRepoInput] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [localBusy, setLocalBusy] = React.useState<string | null>(null)
  const busy = syncBusy ?? localBusy
  const changeCount = changed.length + deleted.length

  const linkRepo = async (): Promise<void> => {
    if (!workspace || !repoInput.trim()) return
    setLocalBusy('link')
    try {
      const ref = parseRepoRef(repoInput)
      if (!ref) throw new Error('Enter a repo as owner/name or a github.com URL')
      const meta = await ghRepoMeta(ref.owner, ref.repo, account?.token)
      // A workspace opened from a repo subfolder must stay pinned to that
      // subfolder, or push flattens the project onto the repo root.
      const sameRepo =
        workspace.source &&
        `${workspace.source.owner}/${workspace.source.repo}`.toLowerCase() ===
          meta.fullName.toLowerCase()
      const repoPath = (ref.path || (sameRepo ? workspace.source!.path : '') || '').replace(
        /^\/+|\/+$/g,
        ''
      )
      const newLink: RepoLink = {
        remote: meta.fullName,
        branch: ref.branch || meta.branch,
        path: repoPath,
        base: {}
      }
      // Pull to populate the baseline + working tree from the remote.
      const pulled = await pullWorkspace(workspace, newLink, account?.token, (msg) =>
        setLocalBusy(msg)
      )
      saveLink(workspace.path, pulled.link)
      await refreshWorkspace(workspace)
      setRepoInput('')
      await refreshRepoSync()
      toast.success(`Linked ${meta.fullName}`)
    } catch (e) {
      toast.error('Could not link repo', {
        description: e instanceof Error ? e.message : 'Unknown error'
      })
    } finally {
      setLocalBusy(null)
    }
  }

  const push = async (): Promise<void> => {
    if (await pushRepo(message)) setMessage('')
  }

  const pull = async (): Promise<void> => {
    await pullRepo(refreshWorkspace)
  }

  const publish = async (): Promise<void> => {
    if (!workspace || !account || !repoInput.trim()) return
    setLocalBusy('Publishing…')
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
        onProgress: (msg) => setLocalBusy(msg)
      })
      await adoptCopiedProject(workspace, linked, account.login)
      setRepoInput('')
      await refreshRepoSync()
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
      setLocalBusy(null)
    }
  }

  const input =
    'w-full bg-[var(--bg-raised)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--brand)]'

  return (
    <div className="h-full flex flex-col">
      {!workspace ? (
        <div className="p-4 text-sm text-[var(--text-faint)] text-center">
          Open a project to use source control.
        </div>
      ) : !account ? (
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-[var(--text-body)]">
            <Github size={16} /> Connect to GitHub
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Sign in to link this project to a repository, push your changes, and publish to GitHub
            Pages.
          </p>
          <GitHubSignInButton block />
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {/* account */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-default)]">
            {account.avatarUrl && (
              <img src={account.avatarUrl} alt="" className="w-6 h-6 rounded-full" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xs text-[var(--text-strong)] truncate">{account.name}</div>
              <div className="text-[10px] text-[var(--text-faint)] truncate">@{account.login}</div>
            </div>
            <button
              className="text-[var(--text-faint)] hover:text-[var(--status-error)]"
              title="Sign out"
              onClick={signOut}
            >
              <LogOut size={14} />
            </button>
          </div>

          {!link ? (
            <div className="p-4 flex flex-col gap-3">
              <div className="text-xs text-[var(--text-muted)]">
                Link this project to a repository, or publish a new one. New repos are created{' '}
                <span className="text-[var(--text-body)]">public</span> so GitHub Pages works.
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
              <div className="px-4 py-2 border-b border-[var(--border-default)] flex items-center gap-2 text-xs">
                <GitBranch size={13} className="text-[var(--brand)]" />
                <span className="text-[var(--text-strong)] truncate flex-1">
                  {link.remote}
                  {link.path ? (
                    <span className="text-[var(--text-faint)]">/{link.path}</span>
                  ) : null}
                </span>
                <span className="font-mono text-[var(--text-faint)]">{link.branch}</span>
              </div>
              <div className="px-4 py-1 text-[11px] font-semibold tracking-wider text-[var(--text-muted)]">
                CHANGES ({changeCount})
              </div>
              <ScrollArea className="flex-1">
                <div className="px-4 pb-3 flex flex-col gap-0.5">
                  {changeCount === 0 ? (
                    <div className="text-xs text-[var(--text-faint)] py-2">
                      Working tree matches the last sync.
                    </div>
                  ) : (
                    <>
                      {changed.map((p) => (
                        <div
                          key={p}
                          className="flex items-center gap-2 text-xs text-[var(--text-body)] py-0.5"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-warn)] shrink-0" />
                          <span className="truncate font-mono">{p}</span>
                        </div>
                      ))}
                      {deleted.map((p) => (
                        <div
                          key={p}
                          className="flex items-center gap-2 text-xs text-[var(--text-muted)] py-0.5"
                          title="Deleted — Push removes it from GitHub"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-error)] shrink-0" />
                          <span className="truncate font-mono line-through">{p}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </ScrollArea>
              {writable === false && (
                <div className="px-4 py-2 text-[11px] text-[var(--text-muted)] border-t border-[var(--border-default)]">
                  You don&apos;t have write access to{' '}
                  <span className="text-[var(--text-body)]">{link.remote}</span>. Your edits are
                  saved locally — publish a copy to keep them on GitHub.
                </div>
              )}
              {writable !== false && changeCount > 0 && (
                <div className="px-4 pt-2">
                  <input
                    id="source-control-commit-message"
                    className={input}
                    placeholder={defaultPushMessage(changed, deleted)}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !busy) void push()
                    }}
                    aria-label="Commit message"
                  />
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
                  Push{changeCount > 0 ? ` (${changeCount})` : ''}
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
          {busy && (busy.includes('·') || busy.includes('…')) && busy !== 'Publishing…' && (
            <div className="px-4 py-1.5 text-[11px] text-[var(--text-muted)] border-t border-[var(--border-default)] truncate">
              {busy}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
