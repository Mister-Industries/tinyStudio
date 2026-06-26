/**
 * GitHubAccountButton — the sign-in / profile control in the header (top-right).
 * Signed out: a "Sign in" button that opens a PAT dialog. Signed in: the user's
 * avatar + login with a menu to open their GitHub or sign out.
 */

import { useGitHubAccount } from '@renderer/hooks/useGitHubAccount'
import { ExternalLink, Github, LogOut, Loader2 } from 'lucide-react'
import React from 'react'
import { notify as toast } from '@renderer/lib/notify'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from './ui/Dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/DropdownMenu'

export function GitHubAccountButton(): React.JSX.Element {
  const { account, connecting, connect, signOut } = useGitHubAccount()
  const [open, setOpen] = React.useState(false)
  const [token, setToken] = React.useState('')

  const doConnect = async (): Promise<void> => {
    if (!token.trim()) return
    try {
      const acct = await connect(token)
      setToken('')
      setOpen(false)
      toast.success(`Signed in as ${acct.login}`)
    } catch (e) {
      toast.error('Sign-in failed', { description: e instanceof Error ? e.message : 'Unknown error' })
    }
  }

  if (account) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-[var(--radius-sm)] hover:bg-white/15 dark:hover:bg-[var(--bg-sunken)] transition-colors">
            {account.avatarUrl ? (
              <img src={account.avatarUrl} alt="" className="w-6 h-6 rounded-full" />
            ) : (
              <span className="w-6 h-6 rounded-full bg-white/20 dark:bg-[var(--bg-sunken)] flex items-center justify-center text-[11px] text-white dark:text-[var(--text-body)]">
                {account.login.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="text-xs text-white dark:text-[var(--text-body)] max-w-[120px] truncate">
              {account.login}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => window.api.fs.openExternal(`https://github.com/${account.login}`)}>
            <ExternalLink size={14} className="mr-2" /> Open GitHub profile
          </DropdownMenuItem>
          <DropdownMenuItem onClick={signOut} className="text-destructive">
            <LogOut size={14} className="mr-2" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 h-7 px-2.5 rounded-[var(--radius-sm)] text-[13px] font-semibold bg-white/15 text-white hover:bg-white/25 dark:bg-[var(--bg-sunken)] dark:text-[var(--text-body)] dark:hover:bg-[var(--border-soft)]"
        >
          <Github size={15} /> Sign in
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github size={18} className="text-[var(--brand)]" /> Sign in to GitHub
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-[var(--text-muted)]">
            Paste a Personal Access Token with{' '}
            <span className="font-mono text-[var(--text-body)]">repo</span> scope. It's stored
            locally and used to list your repos, push, and publish to Pages.
          </p>
          <Input
            type="password"
            placeholder="ghp_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doConnect()}
          />
          <div className="flex items-center justify-between">
            <a
              className="text-xs text-[var(--brand)] hover:underline flex items-center gap-1"
              href="https://github.com/settings/tokens/new?scopes=repo&description=tinyStudio"
              target="_blank"
              rel="noreferrer"
            >
              Create a token <ExternalLink size={12} />
            </a>
            <Button onClick={doConnect} disabled={connecting || !token.trim()}>
              {connecting ? <Loader2 size={15} className="animate-spin" /> : <Github size={15} />} Connect
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
