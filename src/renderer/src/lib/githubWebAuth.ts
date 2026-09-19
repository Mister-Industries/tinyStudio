/**
 * githubWebAuth: GitHub sign-in for the web build, via the OAuth
 * authorization-code flow with PKCE.
 *
 * The page sends the user to github.com with a one-time state and a PKCE
 * challenge, GitHub sends them back to `/auth/github/callback` on the same
 * host with a code, and the code is exchanged for a token by the Netlify
 * function in netlify/functions/github-token.ts, because GitHub requires the
 * app's client secret for that step even with PKCE. The token then lives where
 * the pasted-token path already kept it (lib/github's account store).
 *
 * The desktop app never uses this: it signs in with the device flow in the
 * main process (src/main/githubAuth.ts).
 */

import {
  GITHUB_CALLBACK_PATH,
  GITHUB_CLIENT_ID_DEFAULT,
  GITHUB_SCOPE
} from '../../../shared/githubApp'
import { ghUser, saveAccount, type GitHubAccount } from './github'
import { STORAGE_KEYS } from './storageKeys'

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const TOKEN_FUNCTION_PATH = '/.netlify/functions/github-token'

// Build-time overrides, substituted by the vite configs' `define` (see
// env.d.ts); absent under the test runner.
const defined = (v: string | undefined): string | undefined => (v ? v : undefined)

export const clientId = (): string =>
  defined(typeof __GITHUB_CLIENT_ID__ === 'string' ? __GITHUB_CLIENT_ID__ : undefined) ||
  GITHUB_CLIENT_ID_DEFAULT

/** True where the web flow can run: a browser page (not Electron) with a client id. */
export function canUseWebFlow(): boolean {
  return (
    typeof window !== 'undefined' &&
    !window.api &&
    /^https?:$/.test(window.location.protocol) &&
    clientId().length > 0
  )
}

export const isCallbackUrl = (pathname = window.location.pathname): boolean =>
  pathname === GITHUB_CALLBACK_PATH

interface Pending {
  state: string
  verifier: string
  /** the app path to return to, so a sign-in mid-project lands back in it */
  returnTo: string
}

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

/** PKCE S256: base64url(sha256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

/** The URL github.com is sent, for a given state and challenge. */
export function authorizeUrl(origin: string, state: string, challenge: string): string {
  const u = new URL(AUTHORIZE_URL)
  u.searchParams.set('client_id', clientId())
  u.searchParams.set('redirect_uri', origin + GITHUB_CALLBACK_PATH)
  u.searchParams.set('scope', GITHUB_SCOPE)
  u.searchParams.set('state', state)
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  return u.toString()
}

/**
 * Where the code is swapped for a token: the page's own site. Netlify serves
 * the function on a deploy, and `npm run dev:web` serves the same file
 * (githubTokenDev in vite-plugins.ts). VITE_GITHUB_TOKEN_ENDPOINT overrides it.
 */
export function tokenEndpoint(origin = window.location.origin): string {
  const override = defined(
    typeof __GITHUB_TOKEN_ENDPOINT__ === 'string' ? __GITHUB_TOKEN_ENDPOINT__ : undefined
  )
  return override || origin + TOKEN_FUNCTION_PATH
}

const isLocalhost = (host: string): boolean => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)

/**
 * What to show when the token exchange gets no usable answer: `status` is
 * absent when nothing answered at all, which the browser itself reports only
 * as "Failed to fetch".
 */
export function exchangeFailureMessage(endpoint: string, origin: string, status?: number): string {
  const host = new URL(endpoint, origin).host
  const local = isLocalhost(host)
  if (status === undefined) {
    return local
      ? `Couldn't reach ${host} to finish signing in. Check that npm run dev:web is still running, then try again.`
      : `Couldn't reach ${host} to finish signing in. Check your connection, then try again.`
  }
  if (status === 404) {
    return local
      ? `${host} has no GitHub sign-in function. Sign in from npm run dev:web, which serves it.`
      : `${host} has no GitHub sign-in function, so sign-in can't finish there.`
  }
  return `GitHub sign-in failed (${status}).`
}

/**
 * Leave for github.com. The page navigates away; the flow continues in
 * completeWebSignIn() when GitHub sends the browser back.
 */
export async function startWebSignIn(): Promise<void> {
  const verifier = randomToken(48)
  const state = randomToken(16)
  const pending: Pending = {
    state,
    verifier,
    returnTo: window.location.pathname + window.location.search
  }
  sessionStorage.setItem(STORAGE_KEYS.githubOAuthPending, JSON.stringify(pending))
  window.location.assign(authorizeUrl(window.location.origin, state, await pkceChallenge(verifier)))
}

export interface WebSignInResult {
  account?: GitHubAccount
  error?: string
  /** the path the app was on when sign-in started */
  returnTo: string
}

/**
 * Finish the flow on the callback URL: check the state, exchange the code,
 * load the profile and store the account. Always clears the pending record and
 * returns where to go next; never throws.
 */
export async function completeWebSignIn(): Promise<WebSignInResult> {
  const params = new URLSearchParams(window.location.search)
  let pending: Pending | null = null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.githubOAuthPending)
    pending = raw ? (JSON.parse(raw) as Pending) : null
    sessionStorage.removeItem(STORAGE_KEYS.githubOAuthPending)
  } catch {
    /* session storage unavailable: treated as no pending sign-in */
  }
  const returnTo = pending?.returnTo || '/'

  const denied = params.get('error')
  if (denied) {
    return {
      error:
        denied === 'access_denied'
          ? 'Sign-in was cancelled on GitHub.'
          : params.get('error_description') || denied,
      returnTo
    }
  }
  const code = params.get('code')
  if (!code || !pending) {
    return { error: 'This sign-in link is not one this browser started.', returnTo }
  }
  if (params.get('state') !== pending.state) {
    return { error: 'The sign-in did not come back the way it left. Try again.', returnTo }
  }

  const origin = window.location.origin
  const endpoint = tokenEndpoint(origin)
  let r: Response
  try {
    r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: pending.verifier,
        redirect_uri: origin + GITHUB_CALLBACK_PATH
      })
    })
  } catch {
    // Nothing answered: the host doesn't resolve, or its server is down.
    return { error: exchangeFailureMessage(endpoint, origin), returnTo }
  }

  try {
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; error?: string }
    if (!r.ok || !j.access_token) {
      return { error: j.error || exchangeFailureMessage(endpoint, origin, r.status), returnTo }
    }
    const account = await ghUser(j.access_token)
    saveAccount(account)
    return { account, returnTo }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), returnTo }
  }
}
