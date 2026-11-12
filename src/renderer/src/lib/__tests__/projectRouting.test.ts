/**
 * Project deep links come from the window's URL only where the app is served
 * over http(s). The packaged desktop app loads from file://, and its path (the
 * app's own location on disk) must never be read as a GitHub project.
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { hasUrlRouting, parseProjectRoute } from '../projectRouting'

const g = globalThis as { window?: unknown }
const saved = g.window

function at(href: string): void {
  const u = new URL(href)
  g.window = { location: { protocol: u.protocol, pathname: u.pathname } }
}

afterEach(() => {
  g.window = saved
})

test('the packaged app (file://) has no deep links', () => {
  at('file:///Applications/tinyStudio.app/Contents/Resources/app/out/renderer/index.html')
  assert.equal(hasUrlRouting(), false)
  assert.equal(parseProjectRoute(), null)
})

test('the web app and the dev server read the route from the URL', () => {
  at('https://studio.tinycore.cc/Mister-Industries/tinyStudio-examples/blink')
  assert.equal(hasUrlRouting(), true)
  assert.deepEqual(parseProjectRoute(), {
    owner: 'Mister-Industries',
    repo: 'tinyStudio-examples',
    path: 'blink'
  })
  at('http://localhost:5173/')
  assert.equal(parseProjectRoute(), null)
})

test('an explicit pathname is parsed whatever the protocol', () => {
  at('file:///Applications/tinyStudio.app/index.html')
  assert.deepEqual(parseProjectRoute('/owner/repo/sub/dir'), {
    owner: 'owner',
    repo: 'repo',
    path: 'sub/dir'
  })
})
