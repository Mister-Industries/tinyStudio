/**
 * githubAuth — GitHub sign-in for the desktop app, via the OAuth **device flow**.
 *
 * Why device flow: it is the only browser-less flow that needs no client secret
 * and no redirect URI, so nothing confidential ships inside the app. The user
 * gets a short code, types it on github.com, and we poll until GitHub says yes.
 *
 * Why this lives in the MAIN process rather than the renderer:
 *   • GitHub's OAuth endpoints send no CORS headers, so a renderer `fetch` to
 *     them fails outright. This is not a workaround — it's the supported shape.
 *   • The resulting token is written with safeStorage (OS keychain / DPAPI),
 *     the same way the Anthropic key is. A token in the renderer's localStorage
 *     would be readable by any process running as the user.
 *
 * Why an OAuth App and not a GitHub App: a GitHub App *cannot create a
 * repository in a user's personal account*, which is the whole point of "make
 * it mine". Repo creation needs an OAuth scope. We ask for `public_repo`
 * rather than `repo`, which is strictly narrower than a full-`repo` personal
 * access token.
 */

import { safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { GITHUB_CLIENT_ID_DEFAULT, GITHUB_SCOPE as SCOPE } from '../shared/githubApp'

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const API = 'https://api.github.com'

/**
 * Public client id — safe to ship; it is not a secret. The tinyStudio app's id
 * is built in (shared/githubApp); override at build time with
 * VITE_GITHUB_CLIENT_ID, or at run time with GITHUB_CLIENT_ID for dev.
 */
const CLIENT_ID =
  process.env.GITHUB_CLIENT_ID || process.env.VITE_GITHUB_CLIENT_ID || GITHUB_CLIENT_ID_DEFAULT

export interface DeviceCode {
  userCode: string
  verificationUri: string
  /** seconds until the code expires */
  expiresIn: number
}

export interface GitHubUser {
  login: string
  name: string
  avatarUrl: string
}

interface StoredAuth {
  tokenEnc?: string
  tokenEncrypted?: boolean
  user?: GitHubUser
}

function authPath(): string {
  return join(app.getPath('userData'), 'github-auth.json')
}

async function readAuth(): Promise<StoredAuth> {
  try {
    return JSON.parse(await fs.readFile(authPath(), 'utf-8')) as StoredAuth
  } catch {
    return {}
  }
}

async function writeAuth(a: StoredAuth): Promise<void> {
  await fs.writeFile(authPath(), JSON.stringify(a, null, 2), 'utf-8')
}

function encrypt(token: string): Pick<StoredAuth, 'tokenEnc' | 'tokenEncrypted'> {
  if (safeStorage.isEncryptionAvailable()) {
    return { tokenEnc: safeStorage.encryptString(token).toString('base64'), tokenEncrypted: true }
  }
  // Platforms without an OS keychain. Base64 so it isn't in plain sight, but
  // this is NOT encryption — same caveat as the Anthropic key.
  return { tokenEnc: Buffer.from(token, 'utf-8').toString('base64'), tokenEncrypted: false }
}

export async function getToken(): Promise<string | null> {
  const a = await readAuth()
  if (!a.tokenEnc) return null
  const buf = Buffer.from(a.tokenEnc, 'base64')
  try {
    return a.tokenEncrypted ? safeStorage.decryptString(buf) : buf.toString('utf-8')
  } catch {
    return null
  }
}

export async function getAccount(): Promise<(GitHubUser & { token: string }) | null> {
  const [token, a] = await Promise.all([getToken(), readAuth()])
  if (!token || !a.user) return null
  return { ...a.user, token }
}

export async function signOut(): Promise<void> {
  await writeAuth({})
}

export function isConfigured(): boolean {
  return CLIENT_ID.length > 0
}

/** Abort flag for an in-flight poll, so the user can cancel the dialog. */
let cancelled = false
export function cancelSignIn(): void {
  cancelled = true
}

/** Step 1: ask GitHub for a device + user code. */
export async function startDeviceFlow(): Promise<
  DeviceCode & { deviceCode: string; interval: number }
> {
  if (!CLIENT_ID) {
    throw new Error(
      'No GitHub client ID configured. Set VITE_GITHUB_CLIENT_ID (see docs/github-auth.md).'
    )
  }
  cancelled = false
  const r = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPE })
  })
  if (!r.ok) throw new Error(`GitHub declined the sign-in request (${r.status})`)
  const j = (await r.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
    error?: string
    error_description?: string
  }
  if (j.error) {
    throw new Error(
      j.error === 'device_flow_disabled'
        ? 'Device flow is not enabled on the GitHub OAuth app. Turn it on in the app settings.'
        : j.error_description || j.error
    )
  }
  return {
    deviceCode: j.device_code,
    userCode: j.user_code,
    verificationUri: j.verification_uri,
    expiresIn: j.expires_in,
    interval: j.interval || 5
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Step 2: poll until the user finishes on github.com. Returns the signed-in
 * account, or throws with a message worth showing.
 */
export async function pollForToken(
  deviceCode: string,
  intervalSeconds: number,
  expiresIn: number
): Promise<GitHubUser & { token: string }> {
  let interval = Math.max(intervalSeconds, 1) * 1000
  const deadline = Date.now() + expiresIn * 1000

  for (;;) {
    if (cancelled) throw new Error('Sign-in cancelled')
    if (Date.now() > deadline) throw new Error('The code expired — start sign-in again.')
    await sleep(interval)
    if (cancelled) throw new Error('Sign-in cancelled')

    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    })
    const j = (await r.json()) as {
      access_token?: string
      error?: string
      error_description?: string
    }

    if (j.access_token) {
      const user = await fetchUser(j.access_token)
      await writeAuth({ ...encrypt(j.access_token), user })
      return { ...user, token: j.access_token }
    }

    switch (j.error) {
      case 'authorization_pending':
        break // the user hasn't finished yet — keep waiting
      case 'slow_down':
        // GitHub asks us to back off; its own +5s is the documented step.
        interval += 5000
        break
      case 'expired_token':
        throw new Error('The code expired — start sign-in again.')
      case 'access_denied':
        throw new Error('Sign-in was cancelled on GitHub.')
      default:
        throw new Error(j.error_description || j.error || 'Sign-in failed')
    }
  }
}

async function fetchUser(token: string): Promise<GitHubUser> {
  const r = await fetch(`${API}/user`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` }
  })
  if (!r.ok) throw new Error(`Could not read your GitHub profile (${r.status})`)
  const u = (await r.json()) as { login: string; name: string | null; avatar_url: string }
  return { login: u.login, name: u.name || u.login, avatarUrl: u.avatar_url }
}

/**
 * Adopt a Personal Access Token as if it came from the device flow. Kept as an
 * escape hatch for enterprise / air-gapped setups, but it now stores the token
 * through safeStorage like any other rather than in renderer localStorage.
 */
export async function signInWithToken(token: string): Promise<GitHubUser & { token: string }> {
  const user = await fetchUser(token)
  await writeAuth({ ...encrypt(token), user })
  return { ...user, token }
}
