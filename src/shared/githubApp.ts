/**
 * githubApp — the tinyStudio GitHub OAuth app, shared by the desktop main
 * process (device flow), the web build (authorization-code flow with PKCE) and
 * the Netlify function that finishes the web flow.
 *
 * The client id is public: it identifies the app, and every flow tinyStudio
 * uses is designed for clients that can't keep a secret. The client secret
 * exists only in the Netlify site's environment (GITHUB_CLIENT_SECRET) and is
 * used by netlify/functions/github-token.ts alone. See
 * docs/accounts-and-domains.md for the app's registration.
 */

/** The Mister-Industries "tinyStudio" OAuth app. Override with VITE_GITHUB_CLIENT_ID. */
export const GITHUB_CLIENT_ID_DEFAULT = 'Ov23liGFj4cdnq63Empm'

/**
 * `public_repo` covers reading and writing public repositories and creating new
 * ones — everything tinyStudio does. It deliberately cannot touch private
 * repos. Widen to `repo` only if private copies become a requirement.
 */
export const GITHUB_SCOPE = 'public_repo'

/**
 * Where the web flow returns to, on whichever host started it. Not
 * `/auth/callback`: the tinyCore sign-in uses that path on every tinycore.cc
 * site, and the two must not collide.
 */
export const GITHUB_CALLBACK_PATH = '/auth/github/callback'

/**
 * Browser origins the token exchange accepts. The app is served from the
 * first; the second forwards to it but stays registered until it does;
 * deploy previews get their own address; the last two are local development
 * (5173 is often taken).
 */
export const WEB_ORIGINS = [
  'https://studio.tinycore.cc',
  'https://app.tinystudio.cc',
  'http://localhost:5173',
  'http://localhost:5174'
]

export const PREVIEW_ORIGIN_PATTERN = /^https:\/\/deploy-preview-\d+\.preview\.tinystudio\.cc$/

export function isAllowedWebOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false
  return WEB_ORIGINS.includes(origin) || PREVIEW_ORIGIN_PATTERN.test(origin)
}
