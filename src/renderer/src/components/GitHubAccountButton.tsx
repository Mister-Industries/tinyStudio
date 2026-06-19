/**
 * GitHubAccountButton — the sign-in / profile control in the header (top-right).
 * Signed out: a "Sign in" button that opens a PAT dialog. Signed in: the user's
 * avatar + login with a menu to open their GitHub or sign out.
 */

import { useGitHubAccount } from '@renderer/hooks/useGitHubAccount'
import { ExternalLink, Github, LogOut, Loader2 } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import { Button } from './ui/Button'
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
          <button className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-navy-600 transition-colors">
            {account.avatarUrl ? (
              <img src={account.avatarUrl} alt="" className="w-6 h-6 rounded-full" />
            ) : (
              <span className="w-6 h-6 rounded-full bg-navy-500 flex items-center justify-center text-[11px]">
                {account.login.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="text-xs text-fg-2 max-w-[120px] truncate">{account.login}</span>
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
        <Button variant="ghost" size="sm" className="rounded-full text-fg-2 hover:text-fg-1 hover:bg-navy-600 gap-1.5">
          <Github size={15} /> Sign in
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-navy-700 border border-navy-500 text-fg-1 max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github size={18} className="text-cyan" /> Sign in to GitHub
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-3">
            Paste a Personal Access Token with <span className="font-mono text-fg-2">repo</span> scope. It's
            stored locally and used to list your repos, push, and publish to Pages.
          </p>
          <input
            type="password"
            className="w-full bg-navy-900 border border-navy-400 rounded-lg px-3 py-2 text-sm text-fg-1 placeholder:text-fg-4 outline-none focus:border-cyan"
            placeholder="ghp_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doConnect()}
          />
          <div className="flex items-center justify-between">
            <a
              className="text-xs text-cyan hover:text-cyan-bright flex items-center gap-1"
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
