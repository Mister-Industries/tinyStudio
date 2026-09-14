/**
 * github-token — the one server-side step of the web build's GitHub sign-in.
 *
 * The page finishes the OAuth authorization-code flow here because GitHub
 * requires the app's client secret to swap a code for a token, even with
 * PKCE. The secret lives only in this site's environment as
 * GITHUB_CLIENT_SECRET (docs/accounts-and-domains.md). The function accepts
 * requests from the app's own origins and the deploy-preview and localhost
 * ones, forwards the exchange to GitHub, and returns the token to the page,
 * which keeps it the way it keeps a pasted token.
 *
 * Deployed by Netlify at /.netlify/functions/github-token (netlify.toml).
 */

// Kept in step with src/shared/githubApp.ts; functions bundle on their own,
// so the list is repeated here rather than imported from the app.
const CLIENT_ID = process.env.VITE_GITHUB_CLIENT_ID || 'Ov23liGFj4cdnq63Empm'
const ORIGINS = [
  'https://studio.tinycore.cc',
  'https://app.tinystudio.cc',
  'http://localhost:5173',
  'http://localhost:5174'
]
const PREVIEW_ORIGIN = /^https:\/\/deploy-preview-\d+\.preview\.tinystudio\.cc$/
const CALLBACK_PATH = '/auth/github/callback'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'

const isAllowed = (origin: string | null): origin is string =>
  !!origin && (ORIGINS.includes(origin) || PREVIEW_ORIGIN.test(origin))

function reply(status: number, body: unknown, origin: string | null): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (isAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Headers'] = 'Content-Type'
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    headers.Vary = 'Origin'
  }
  return new Response(JSON.stringify(body), { status, headers })
}

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return reply(isAllowed(origin) ? 204 : 403, {}, origin)
  if (req.method !== 'POST') return reply(405, { error: 'POST only' }, origin)
  if (!isAllowed(origin)) return reply(403, { error: 'This origin may not sign in.' }, origin)

  const secret = process.env.GITHUB_CLIENT_SECRET
  if (!secret) {
    return reply(500, { error: 'GITHUB_CLIENT_SECRET is not set on this site.' }, origin)
  }

  let body: { code?: unknown; code_verifier?: unknown; redirect_uri?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return reply(400, { error: 'Expected a JSON body.' }, origin)
  }
  const { code, code_verifier: verifier, redirect_uri: redirectUri } = body
  if (typeof code !== 'string' || typeof verifier !== 'string' || typeof redirectUri !== 'string') {
    return reply(400, { error: 'code, code_verifier and redirect_uri are required.' }, origin)
  }
  // The redirect the flow started with has to be this origin's own callback:
  // a token for one origin must not be minted for a code another one got.
  if (redirectUri !== origin + CALLBACK_PATH) {
    return reply(400, { error: 'redirect_uri does not belong to this origin.' }, origin)
  }

  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: secret,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri
    })
  })
  const j = (await r.json().catch(() => ({}))) as {
    access_token?: string
    scope?: string
    error?: string
    error_description?: string
  }
  if (!r.ok || !j.access_token) {
    return reply(
      400,
      { error: j.error_description || j.error || 'GitHub refused the code.' },
      origin
    )
  }
  return reply(200, { access_token: j.access_token, scope: j.scope ?? '' }, origin)
}
