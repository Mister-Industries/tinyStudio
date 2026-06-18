/**
 * SourceControl — GitHub panel for the file explorer. Connect with a Personal
 * Access Token, link the workspace to a repo, then Push / Pull / Publish.
 * The push set is the working tree diffed against the last-synced baseline.
 */

import { RefreshWorkspaceCommand } from '@renderer/commands/fileCommands'
import { useAppSelector } from '@renderer/redux'
import {
  changedPaths,
  collectWorkspaceFiles,
  ghCreateRepo,
  ghRepoMeta,
  ghUser,
  loadAccount,
  loadLink,
  pullWorkspace,
  pushWorkspace,
  saveAccount,
  saveLink,
  type GitHubAccount,
  type RepoLink
} from '@renderer/lib/github'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ExternalLink,
  GitBranch,
  Github,
  Loader2,
  LogOut,
  UploadCloud
} from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import { Button } from '../ui/Button'
import { ScrollArea } from '../ui/ScrollArea'

export function SourceControl(): React.JSX.Element {
  const workspace = useAppSelector((state) => state.file.workspace)
  const [account, setAccount] = React.useState<GitHubAccount | null>(loadAccount())
  const [token, setToken] = React.useState('')
  const [link, setLink] = React.useState<RepoLink | null>(null)
  const [changed, setChanged] = React.useState<string[]>([])
  const [repoInput, setRepoInput] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)

  // Load this workspace's repo link + compute the change set.
  const refreshChanges = React.useCallback(async () => {
    if (!workspace) return
    const l = loadLink(workspace.path)
    setLink(l)
    if (l) {
      const current = await collectWorkspaceFiles(workspace)
      setChanged(changedPaths(current, l.base))
    } else {
      setChanged([])
    }
  }, [workspace])

  React.useEffect(() => {
    refreshChanges()
  }, [refreshChanges])

  const connect = async (): Promise<void> => {
    if (!token.trim()) return
    setBusy('connect')
    try {
      const acct = await ghUser(token.trim())
      saveAccount(acct)
      setAccount(acct)
      setToken('')
      toast.success(`Signed in as ${acct.login}`)
    } catch (e) {
      toast.error('Sign-in failed', { description: e instanceof Error ? e.message : 'Unknown error' })
    } finally {
      setBusy(null)
    }
  }

  const signOut = (): void => {
    saveAccount(null)
    setAccount(null)
  }

  const linkRepo = async (): Promise<void> => {
    if (!workspace || !repoInput.trim()) return
    setBusy('link')
    try {
      const m =
        repoInput.trim().replace(/\.git$/, '').match(/github\.com\/([^/]+)\/([^/?#]+)/) ||
        repoInput.trim().match(/^([^/\s]+)\/([^/\s]+)$/)
      if (!m) throw new Error('Enter a repo as owner/name or a github.com URL')
      const meta = await ghRepoMeta(m[1], m[2], account?.token)
      const newLink: RepoLink = { remote: meta.fullName, branch: meta.branch, base: {} }
      // Pull to populate the baseline + working tree from the remote.
      const base = await pullWorkspace(workspace, newLink, account?.token, (msg) => setBusy(msg))
      newLink.base = base
      saveLink(workspace.path, newLink)
      if (workspace) await new RefreshWorkspaceCommand(workspace).execute()
      setRepoInput('')
      await refreshChanges()
      toast.success(`Linked ${meta.fullName}`)
    } catch (e) {
      toast.error('Could not link repo', { description: e instanceof Error ? e.message : 'Unknown error' })
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
      saveLink(workspace.path, updated)
      setLink(updated)
      setChanged([])
      toast.success(pushed > 0 ? `Pushed ${pushed} file(s)` : 'Nothing to push')
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
      const repo = await ghCreateRepo(repoInput.trim(), account.token, true, `${workspace.name} — built with tinyStudio`)
      // Fresh repo → empty baseline so every file is pushed.
      const newLink: RepoLink = { remote: repo.fullName, branch: repo.branch, base: {} }
      const { base } = await pushWorkspace(workspace, newLink, account.token, 'Initial commit via tinyStudio', (msg) =>
        setBusy(msg)
      )
      const linked = { ...newLink, base }
      saveLink(workspace.path, linked)
      setLink(linked)
      setRepoInput('')
      await refreshChanges()
      toast.success(`Published ${repo.fullName}`)
    } catch (e) {
      toast.error('Publish failed', { description: e instanceof Error ? e.message : 'Unknown error' })
    } finally {
      setBusy(null)
    }
  }

  const input =
    'w-full bg-navy-900 border border-navy-400 rounded-lg px-3 py-2 text-sm text-fg-1 placeholder:text-fg-4 outline-none focus:border-cyan'

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 text-[11px] font-semibold tracking-[0.16em] text-fg-3 border-b border-navy-600">
        <Github size={14} />
        GITHUB
      </div>

      {!workspace ? (
        <div className="p-4 text-sm text-fg-4 text-center">Open a project to use source control.</div>
      ) : !account ? (
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-fg-2">
            <Github size={16} /> Connect to GitHub
          </div>
          <input
            className={input}
            type="password"
            placeholder="Personal Access Token (repo scope)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && connect()}
          />
          <Button onClick={connect} disabled={busy === 'connect' || !token.trim()} className="w-full">
            {busy === 'connect' ? <Loader2 size={15} className="animate-spin" /> : <Github size={15} />}
            Connect
          </Button>
          <a
            href="https://github.com/settings/tokens/new?scopes=repo&description=tinyStudio"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-cyan hover:text-cyan-bright flex items-center gap-1 justify-center"
          >
            Create a token <ExternalLink size={12} />
          </a>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {/* account */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-navy-600">
            {account.avatarUrl && <img src={account.avatarUrl} alt="" className="w-6 h-6 rounded-full" />}
            <div className="flex-1 min-w-0">
              <div className="text-xs text-fg-1 truncate">{account.name}</div>
              <div className="text-[10px] text-fg-4 truncate">@{account.login}</div>
            </div>
            <button className="text-fg-4 hover:text-signal-error" title="Sign out" onClick={signOut}>
              <LogOut size={14} />
            </button>
          </div>

          {!link ? (
            <div className="p-4 flex flex-col gap-3">
              <div className="text-xs text-fg-3">Link this project to a repository, or publish a new one.</div>
              <input
                className={input}
                placeholder="owner/name or github.com URL"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
              />
              <div className="flex gap-2">
                <Button onClick={linkRepo} disabled={!!busy || !repoInput.trim()} className="flex-1" variant="outline">
                  {busy === 'link' ? <Loader2 size={15} className="animate-spin" /> : <ArrowDownToLine size={15} />}
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
                <span className="text-fg-1 truncate flex-1">{link.remote}</span>
                <span className="font-mono text-fg-4">{link.branch}</span>
              </div>
              <div className="px-4 py-2 flex gap-2">
                <Button onClick={push} disabled={!!busy} className="flex-1" size="sm">
                  {busy && busy.startsWith('Push') ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ArrowUpToLine size={14} />
                  )}
                  Push{changed.length > 0 ? ` (${changed.length})` : ''}
                </Button>
                <Button onClick={pull} disabled={!!busy} variant="outline" className="flex-1" size="sm">
                  {busy && busy.startsWith('Pull') ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ArrowDownToLine size={14} />
                  )}
                  Pull
                </Button>
              </div>
              <div className="px-4 py-1 text-[11px] font-semibold tracking-wider text-fg-3">
                CHANGES ({changed.length})
              </div>
              <ScrollArea className="flex-1">
                <div className="px-4 pb-3 flex flex-col gap-0.5">
                  {changed.length === 0 ? (
                    <div className="text-xs text-fg-4 py-2">Working tree matches the last sync.</div>
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
            </>
          )}
          {busy && busy.includes('·') && (
            <div className="px-4 py-1.5 text-[11px] text-fg-3 border-t border-navy-600 truncate">{busy}</div>
          )}
        </div>
      )}
    </div>
  )
}
