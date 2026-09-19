/**
 * Shared GitHub account state, with a window event so every consumer (the
 * header profile, the GitHub source-control tab, and the Visual "Publish"
 * button) stays in sync when you sign in or out.
 *
 * Three ways in:
 *   • **Device flow** (desktop). No token to paste, no client secret in the
 *     app. Runs in the main process because GitHub's OAuth endpoints send no
 *     CORS headers, and the token lands in the OS keychain.
 *   • **Web flow** (browser). The page goes to github.com and comes back to
 *     /auth/github/callback; a Netlify function swaps the code for a token
 *     (lib/githubWebAuth).
 *   • **Personal Access Token**, behind "Advanced", for enterprise and
 *     air-gapped setups. On desktop this also stores via the keychain.
 *
 * Every way in ends in saveAccount, which fires GITHUB_ACCOUNT_EVENT.
 */

import {
  ghUser,
  GITHUB_ACCOUNT_EVENT,
  GitHubAccount,
  initAccount,
  loadAccount,
  saveAccount
} from '@renderer/lib/github'
import { canUseWebFlow, startWebSignIn } from '@renderer/lib/githubWebAuth'
import { useCallback, useEffect, useState } from 'react'

export interface DeviceCodePrompt {
  userCode: string
  verificationUri: string
}

export interface UseGitHubAccount {
  account: GitHubAccount | null
  connecting: boolean
  /** True on desktop with an OAuth client ID built in; i.e. no PAT needed. */
  canUseDeviceFlow: boolean
  /** True in the browser build: sign-in goes through github.com and comes back. */
  canUseWebFlow: boolean
  /** Paste-a-token path, behind "Advanced". */
  connect: (token: string) => Promise<GitHubAccount>
  /** `onPrompt` fires with the code to show the user, then resolves when done. */
  signInWithDevice: (onPrompt: (p: DeviceCodePrompt) => void) => Promise<GitHubAccount>
  /** Leaves for github.com; the app finishes the sign-in when the page comes back. */
  signInWithWeb: () => Promise<void>
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
    window.addEventListener(GITHUB_ACCOUNT_EVENT, sync)
    window.addEventListener('storage', sync)
    // Hydrate from the keychain (desktop) or storage (web) on first mount.
    initAccount().then(sync).catch(sync)
    bridge()
      ?.isConfigured()
      .then(setCanUseDeviceFlow)
      .catch(() => setCanUseDeviceFlow(false))
    return () => {
      window.removeEventListener(GITHUB_ACCOUNT_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const connect = useCallback(async (token: string): Promise<GitHubAccount> => {
    setConnecting(true)
    try {
      const api = bridge()
      // On desktop the main process verifies the token and stores it in the
      // keychain; on web we verify here and keep it in localStorage.
      const acct = api ? await api.signInWithToken(token.trim()) : await ghUser(token.trim())
      saveAccount(acct)
      return acct
    } finally {
      setConnecting(false)
    }
  }, [])

  const signInWithDevice = useCallback(
    async (onPrompt: (p: DeviceCodePrompt) => void): Promise<GitHubAccount> => {
      const api = bridge()
      if (!api) throw new Error('Device sign-in is only available in the desktop app.')
      setConnecting(true)
      try {
        const start = await api.startDeviceFlow()
        onPrompt({ userCode: start.userCode, verificationUri: start.verificationUri })
        const acct = await api.poll(start.deviceCode, start.interval, start.expiresIn)
        saveAccount(acct)
        return acct
      } finally {
        setConnecting(false)
      }
    },
    []
  )

  const cancelDeviceSignIn = useCallback((): void => {
    bridge()?.cancelSignIn()
  }, [])

  const signInWithWeb = useCallback(async (): Promise<void> => {
    setConnecting(true)
    try {
      await startWebSignIn()
    } catch (e) {
      setConnecting(false)
      throw e
    }
  }, [])

  const signOut = useCallback((): void => {
    bridge()?.signOut()
    saveAccount(null)
  }, [])

  return {
    account,
    connecting,
    canUseDeviceFlow,
    canUseWebFlow: canUseWebFlow(),
    connect,
    signInWithDevice,
    signInWithWeb,
    cancelDeviceSignIn,
    signOut
  }
}
