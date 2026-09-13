/**
 * Shared GitHub account state, with a window event so every consumer — the
 * header profile, the GitHub source-control tab, and the Visual "Publish"
 * button — stays in sync when you sign in or out.
 *
 * Two ways in:
 *   • **Device flow** (desktop, preferred). No token to paste, no client secret
 *     in the app. Runs in the main process because GitHub's OAuth endpoints
 *     send no CORS headers, and the token lands in the OS keychain.
 *   • **Personal Access Token** (web today, and an escape hatch on desktop for
 *     enterprise setups). On desktop this now also stores via the keychain.
 */

import { ghUser, GitHubAccount, initAccount, loadAccount, saveAccount } from '@renderer/lib/github'
import { useCallback, useEffect, useState } from 'react'

const ACCOUNT_EVENT = 'tinystudio:github-account'

export interface DeviceCodePrompt {
  userCode: string
  verificationUri: string
}

export interface UseGitHubAccount {
  account: GitHubAccount | null
  connecting: boolean
  /** True on desktop with an OAuth client ID built in — i.e. no PAT needed. */
  canUseDeviceFlow: boolean
  /** Paste-a-token path. Still the only option on the web build for now. */
  connect: (token: string) => Promise<GitHubAccount>
  /** `onPrompt` fires with the code to show the user, then resolves when done. */
  signInWithDevice: (onPrompt: (p: DeviceCodePrompt) => void) => Promise<GitHubAccount>
  cancelDeviceSignIn: () => void
  signOut: () => void
}

const bridge = (): typeof window.api.github | undefined =>
  typeof window !== 'undefined' ? window.api?.github : undefined

export function useGitHubAccount(): UseGitHubAccount {
  const [account, setAccount] = useState<GitHubAccount | null>(() => loadAccount())
  const [connecting, setConnecting] = useState(false)
  const [canUseDeviceFlow, setCanUseDeviceFlow] = useState(false)

  useEffect(() => {
    const sync = (): void => setAccount(loadAccount())
    window.addEventListener(ACCOUNT_EVENT, sync)
    window.addEventListener('storage', sync)
    // Hydrate from the keychain (desktop) or storage (web) on first mount.
    initAccount().then(sync).catch(sync)
    bridge()
      ?.isConfigured()
      .then(setCanUseDeviceFlow)
      .catch(() => setCanUseDeviceFlow(false))
    return () => {
      window.removeEventListener(ACCOUNT_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const adopt = useCallback((acct: GitHubAccount): GitHubAccount => {
    saveAccount(acct)
    window.dispatchEvent(new Event(ACCOUNT_EVENT))
    return acct
  }, [])

  const connect = useCallback(
    async (token: string): Promise<GitHubAccount> => {
      setConnecting(true)
      try {
        const api = bridge()
        // On desktop the main process verifies the token and stores it in the
        // keychain; on web we verify here and keep it in localStorage.
        const acct = api ? await api.signInWithToken(token.trim()) : await ghUser(token.trim())
        return adopt(acct)
      } finally {
        setConnecting(false)
      }
    },
    [adopt]
  )

  const signInWithDevice = useCallback(
    async (onPrompt: (p: DeviceCodePrompt) => void): Promise<GitHubAccount> => {
      const api = bridge()
      if (!api) throw new Error('Device sign-in is only available in the desktop app.')
      setConnecting(true)
      try {
        const start = await api.startDeviceFlow()
        onPrompt({ userCode: start.userCode, verificationUri: start.verificationUri })
        const acct = await api.poll(start.deviceCode, start.interval, start.expiresIn)
        return adopt(acct)
      } finally {
        setConnecting(false)
      }
    },
    [adopt]
  )

  const cancelDeviceSignIn = useCallback((): void => {
    bridge()?.cancelSignIn()
  }, [])

  const signOut = useCallback((): void => {
    bridge()?.signOut()
    saveAccount(null)
    window.dispatchEvent(new Event(ACCOUNT_EVENT))
  }, [])

  return {
    account,
    connecting,
    canUseDeviceFlow,
    connect,
    signInWithDevice,
    cancelDeviceSignIn,
    signOut
  }
}
