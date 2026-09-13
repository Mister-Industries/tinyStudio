/**
 * GitHubSignIn — the single sign-in surface, shared by the header profile
 * control and the GitHub sidebar tab.
 *
 * The default path is the OAuth **device flow**: the user gets a short code,
 * types it on github.com, and the app polls until GitHub says yes. No token to
 * paste, nothing confidential shipped in the app, and the resulting token is
 * held by the main process in the OS keychain.
 *
 * Pasting a Personal Access Token stays available behind "Advanced" — it is
 * still the only route on the web build, and enterprise/air-gapped setups need
 * it — but it is no longer what a normal user is asked to do.
 */

import { useGitHubAccount, type DeviceCodePrompt } from '@renderer/hooks/useGitHubAccount'
import { notify as toast } from '@renderer/lib/notify'
import { Check, Copy, ExternalLink, Github, Loader2 } from 'lucide-react'
import React from 'react'
import { Button } from './ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/Dialog'
import { Input } from './ui/Input'

const openExternal = (url: string): void => {
  if (typeof window !== 'undefined' && window.api?.fs?.openExternal) {
    void window.api.fs.openExternal(url)
  } else {
    window.open(url, '_blank', 'noreferrer')
  }
}

export function GitHubSignInButton({
  className,
  block = false
}: {
  className?: string
  block?: boolean
}): React.JSX.Element {
  const { connect, connecting, canUseDeviceFlow, signInWithDevice, cancelDeviceSignIn } =
    useGitHubAccount()
  const [open, setOpen] = React.useState(false)
  const [prompt, setPrompt] = React.useState<DeviceCodePrompt | null>(null)
  const [showToken, setShowToken] = React.useState(false)
  const [token, setToken] = React.useState('')
  const [copied, setCopied] = React.useState(false)

  const reset = (): void => {
    setPrompt(null)
    setToken('')
    setCopied(false)
    setShowToken(!canUseDeviceFlow)
  }

  const start = async (): Promise<void> => {
    reset()
    setOpen(true)
    if (!canUseDeviceFlow) return
    try {
      const acct = await signInWithDevice(setPrompt)
      setOpen(false)
      toast.success(`Signed in as ${acct.login}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      if (msg !== 'Sign-in cancelled') {
        toast.error('Sign-in failed', { description: msg })
      }
      setPrompt(null)
    }
  }

  const connectToken = async (): Promise<void> => {
    if (!token.trim()) return
    try {
      const acct = await connect(token)
      setOpen(false)
      reset()
      toast.success(`Signed in as ${acct.login}`)
    } catch (e) {
      toast.error('Sign-in failed', {
        description: e instanceof Error ? e.message : 'Unknown error'
      })
    }
  }

  const close = (next: boolean): void => {
    if (!next) {
      cancelDeviceSignIn()
      reset()
    }
    setOpen(next)
  }

  const copyCode = async (): Promise<void> => {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt.userCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.info('Copy the code manually', { description: prompt.userCode })
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={start}
        className={
          className ??
          `gap-1.5 h-7 px-2.5 rounded-[var(--radius-sm)] text-[13px] font-semibold bg-white/15 text-white hover:bg-white/25 dark:bg-[var(--bg-sunken)] dark:text-[var(--text-body)] dark:hover:bg-[var(--border-soft)] ${
            block ? 'w-full' : ''
          }`
        }
      >
        <Github size={15} /> Sign in
      </Button>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Github size={18} className="text-[var(--brand)]" /> Sign in to GitHub
            </DialogTitle>
          </DialogHeader>

          {prompt ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-[var(--text-muted)]">
                Enter this code on GitHub to finish signing in.
              </p>
              <button
                onClick={copyCode}
                title="Copy code"
                className="flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-sunken)] py-3 font-mono text-2xl tracking-[0.3em] text-[var(--text-strong)] hover:border-[var(--brand)]"
              >
                {prompt.userCode}
                {copied ? (
                  <Check size={15} className="text-[var(--brand)]" />
                ) : (
                  <Copy size={15} className="text-[var(--text-muted)]" />
                )}
              </button>
              <Button onClick={() => openExternal(prompt.verificationUri)}>
                <ExternalLink size={15} /> Open GitHub
              </Button>
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                <Loader2 size={12} className="animate-spin" />
                Waiting for you to finish on GitHub…
              </div>
            </div>
          ) : showToken ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-[var(--text-muted)]">
                Paste a Personal Access Token with{' '}
                <span className="font-mono text-[var(--text-body)]">repo</span> scope.
                {canUseDeviceFlow
                  ? ' Only needed for enterprise setups — signing in with GitHub is simpler.'
                  : ''}
              </p>
              <Input
                type="password"
                placeholder="ghp_…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && connectToken()}
              />
              <div className="flex items-center justify-between">
                <a
                  className="flex items-center gap-1 text-xs text-[var(--brand)] hover:underline"
                  href="https://github.com/settings/tokens/new?scopes=repo&description=tinyStudio"
                  target="_blank"
                  rel="noreferrer"
                >
                  Create a token <ExternalLink size={12} />
                </a>
                <Button onClick={connectToken} disabled={connecting || !token.trim()}>
                  {connecting ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Github size={15} />
                  )}{' '}
                  Connect
                </Button>
              </div>
              {canUseDeviceFlow && (
                <button
                  className="self-start text-[11px] text-[var(--text-muted)] hover:text-[var(--text-body)]"
                  onClick={() => {
                    setShowToken(false)
                    void start()
                  }}
                >
                  ← Back to signing in with GitHub
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-4 text-xs text-[var(--text-muted)]">
              <Loader2 size={16} className="animate-spin" />
              Starting sign-in…
            </div>
          )}

          {!showToken && (
            <button
              className="self-start text-[11px] text-[var(--text-muted)] hover:text-[var(--text-body)]"
              onClick={() => {
                cancelDeviceSignIn()
                setPrompt(null)
                setShowToken(true)
              }}
            >
              Advanced: use a personal access token
            </button>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
