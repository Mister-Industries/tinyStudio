/**
 * Shared GitHub account state. Backed by localStorage (lib/github), with a
 * window event so every consumer — the header profile, the GitHub source-control
 * tab, and the Visual "Publish" button — stays in sync when you sign in/out.
 */

import { ghUser, GitHubAccount, loadAccount, saveAccount } from '@renderer/lib/github'
import { useCallback, useEffect, useState } from 'react'

const ACCOUNT_EVENT = 'tinystudio:github-account'

export interface UseGitHubAccount {
  account: GitHubAccount | null
  connecting: boolean
  connect: (token: string) => Promise<GitHubAccount>
  signOut: () => void
}

export function useGitHubAccount(): UseGitHubAccount {
  const [account, setAccount] = useState<GitHubAccount | null>(() => loadAccount())
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    const sync = (): void => setAccount(loadAccount())
    window.addEventListener(ACCOUNT_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(ACCOUNT_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const connect = useCallback(async (token: string): Promise<GitHubAccount> => {
    setConnecting(true)
    try {
      const acct = await ghUser(token.trim())
      saveAccount(acct)
      window.dispatchEvent(new Event(ACCOUNT_EVENT))
      return acct
    } finally {
      setConnecting(false)
    }
  }, [])

  const signOut = useCallback((): void => {
    saveAccount(null)
    window.dispatchEvent(new Event(ACCOUNT_EVENT))
  }, [])

  return { account, connecting, connect, signOut }
}
