import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decideAfterExit, RESTART_WINDOW_MS } from '../serviceRestart'

test('an exit during stop() is ignored', () => {
  assert.equal(decideAfterExit({ stopping: true, lastRestartAt: null, now: 1000 }), 'ignore')
  assert.equal(decideAfterExit({ stopping: true, lastRestartAt: 900, now: 1000 }), 'ignore')
})

test('the first unexpected exit gets a restart', () => {
  assert.equal(decideAfterExit({ stopping: false, lastRestartAt: null, now: 1000 }), 'restart')
})

test('dying again within the window gives up', () => {
  const lastRestartAt = 10_000
  assert.equal(
    decideAfterExit({ stopping: false, lastRestartAt, now: lastRestartAt + 1 }),
    'give-up'
  )
  assert.equal(
    decideAfterExit({ stopping: false, lastRestartAt, now: lastRestartAt + RESTART_WINDOW_MS - 1 }),
    'give-up'
  )
})

test('a service that outlived the window earns another restart', () => {
  const lastRestartAt = 10_000
  assert.equal(
    decideAfterExit({ stopping: false, lastRestartAt, now: lastRestartAt + RESTART_WINDOW_MS }),
    'restart'
  )
})
