/**
 * GitHubAccountButton — the sign-in / profile control in the header (top-right).
 * Signed out it defers to GitHubSignInButton (device flow, PAT behind
 * "Advanced"); signed in it shows the user's avatar + login with a menu to open
 * their GitHub profile or sign out.
 */

import { useGitHubAccount } from '@renderer/hooks/useGitHubAccount'
import { openExternal } from '@renderer/lib/utils'
import { ExternalLink, LogOut } from 'lucide-react'
import React from 'react'
import { GitHubSignInButton } from './GitHubSignIn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/DropdownMenu'

export function GitHubAccountButton(): React.JSX.Element {
  const { account, signOut } = useGitHubAccount()

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
          <DropdownMenuItem onClick={() => openExternal(`https://github.com/${account.login}`)}>
            <ExternalLink size={14} className="mr-2" /> Open GitHub profile
          </DropdownMenuItem>
          <DropdownMenuItem onClick={signOut} className="text-destructive">
            <LogOut size={14} className="mr-2" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return <GitHubSignInButton />
}
