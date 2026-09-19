/**
 * The token function's answers that never reach GitHub: the preflight, the
 * origin check and the callback check (netlify/functions/github-token.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import handler from '../../../netlify/functions/github-token'

const ENDPOINT = 'http://localhost:5173/.netlify/functions/github-token'

const request = (method: string, origin: string, body?: unknown): Request =>
  new Request(ENDPOINT, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })

test('a preflight from an allowed origin gets an empty 204 with CORS headers', async () => {
  const r = await handler(request('OPTIONS', 'http://localhost:5173'))
  assert.equal(r.status, 204)
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  assert.equal(await r.text(), '')
})

test('another site gets 403 and no CORS headers, preflight or POST', async () => {
  const preflight = await handler(request('OPTIONS', 'https://evil.example'))
  assert.equal(preflight.status, 403)
  assert.equal(preflight.headers.get('access-control-allow-origin'), null)

  const post = await handler(request('POST', 'https://evil.example', {}))
  assert.equal(post.status, 403)
  assert.equal(post.headers.get('access-control-allow-origin'), null)
})

test('a POST must use its own origin’s callback', async () => {
  const saved = process.env.GITHUB_CLIENT_SECRET
  process.env.GITHUB_CLIENT_SECRET = 'test-secret'
  try {
    const r = await handler(
      request('POST', 'http://localhost:5173', {
        code: 'code',
        code_verifier: 'verifier',
        redirect_uri: 'https://studio.tinycore.cc/auth/github/callback'
      })
    )
    assert.equal(r.status, 400)
    const body = (await r.json()) as { error: string }
    assert.match(body.error, /does not belong to this origin/)
  } finally {
    if (saved === undefined) delete process.env.GITHUB_CLIENT_SECRET
    else process.env.GITHUB_CLIENT_SECRET = saved
  }
})
