/**
 * The pure parts of the browser sign-in: the authorize URL, PKCE, where the
 * token exchange goes, the callback route, and which origins the exchange
 * accepts (shared with netlify/functions/github-token.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GITHUB_CALLBACK_PATH,
  GITHUB_CLIENT_ID_DEFAULT,
  isAllowedWebOrigin
} from '../../../../shared/githubApp'
import {
  authorizeUrl,
  isCallbackUrl,
  pkceChallenge,
  randomToken,
  tokenEndpoint
} from '../githubWebAuth'
import { parseProjectRoute } from '../projectRouting'

test('the authorize URL carries the app, the scope, PKCE and a same-origin callback', () => {
  const u = new URL(authorizeUrl('https://studio.tinycore.cc', 'st4te', 'ch4llenge'))
  assert.equal(u.origin + u.pathname, 'https://github.com/login/oauth/authorize')
  assert.equal(u.searchParams.get('client_id'), GITHUB_CLIENT_ID_DEFAULT)
  assert.equal(u.searchParams.get('scope'), 'public_repo')
  assert.equal(
    u.searchParams.get('redirect_uri'),
    'https://studio.tinycore.cc/auth/github/callback'
  )
  assert.equal(u.searchParams.get('state'), 'st4te')
  assert.equal(u.searchParams.get('code_challenge'), 'ch4llenge')
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256')
})

test('PKCE challenge is base64url(sha256(verifier)), per RFC 7636 appendix B', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  assert.equal(await pkceChallenge(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
})

test('random tokens are url-safe and unique', () => {
  const a = randomToken()
  const b = randomToken()
  assert.match(a, /^[A-Za-z0-9_-]{40,}$/)
  assert.notEqual(a, b)
})

test('a dev server uses the hosted token exchange; a site uses its own', () => {
  assert.equal(
    tokenEndpoint('http://localhost:5174'),
    'https://studio.tinycore.cc/.netlify/functions/github-token'
  )
  assert.equal(
    tokenEndpoint('https://studio.tinycore.cc'),
    'https://studio.tinycore.cc/.netlify/functions/github-token'
  )
  assert.equal(
    tokenEndpoint('https://deploy-preview-12.preview.tinystudio.cc'),
    'https://deploy-preview-12.preview.tinystudio.cc/.netlify/functions/github-token'
  )
})

test('the callback path is never read as a project', () => {
  assert.equal(GITHUB_CALLBACK_PATH, '/auth/github/callback')
  assert.equal(isCallbackUrl('/auth/github/callback'), true)
  assert.equal(isCallbackUrl('/Mister-Industries/tinyStudio-examples'), false)
  assert.equal(parseProjectRoute('/auth/github/callback'), null)
  assert.equal(parseProjectRoute('/auth/callback'), null)
  assert.deepEqual(parseProjectRoute('/Mister-Industries/tinyStudio-examples/basics/blink'), {
    owner: 'Mister-Industries',
    repo: 'tinyStudio-examples',
    path: 'basics/blink'
  })
})

test('only the app’s own origins may exchange a code', () => {
  for (const ok of [
    'https://studio.tinycore.cc',
    'https://app.tinystudio.cc',
    'https://deploy-preview-7.preview.tinystudio.cc',
    'http://localhost:5173',
    'http://localhost:5174'
  ])
    assert.equal(isAllowedWebOrigin(ok), true, ok)
  for (const bad of [
    'https://evil.example',
    'https://studio.tinycore.cc.evil.example',
    'https://preview.tinystudio.cc',
    'http://localhost:3000',
    'https://tinystudio.cc',
    null,
    ''
  ])
    assert.equal(isAllowedWebOrigin(bad), false, String(bad))
})
