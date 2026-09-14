/**
 * A port counts as free only when nothing holds it on 127.0.0.1 or on the
 * wildcard address, since Windows lets one bind sit beside the other.
 */
import assert from 'node:assert/strict'
import net from 'node:net'
import { test } from 'node:test'
import { canBind, findFreePort } from '../freePort'

/** Listen on `host` (or every interface) on an OS-chosen port; resolves the port. */
function hold(host?: string): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.once('listening', () => {
      const { port } = srv.address() as net.AddressInfo
      resolve({ port, close: () => new Promise((r) => srv.close(() => r())) })
    })
    if (host) srv.listen(0, host)
    else srv.listen(0)
  })
}

test('a port held on 127.0.0.1 is skipped', async () => {
  const held = await hold('127.0.0.1')
  try {
    assert.equal(await canBind(held.port, '127.0.0.1'), false)
    const got = await findFreePort(held.port, 5)
    assert.notEqual(got, held.port)
    assert.ok(got > held.port && got < held.port + 5)
  } finally {
    await held.close()
  }
})

test('a port held on every interface is skipped', async () => {
  const held = await hold()
  try {
    assert.equal(await canBind(held.port), false)
    assert.notEqual(await findFreePort(held.port, 5), held.port)
  } finally {
    await held.close()
  }
})

test('a free port is returned as is, and none in range throws', async () => {
  const probe = await hold('127.0.0.1')
  const port = probe.port
  await probe.close()
  assert.equal(await findFreePort(port, 3), port)

  const busy = await hold('127.0.0.1')
  try {
    await assert.rejects(findFreePort(busy.port, 1), /No free port/)
  } finally {
    await busy.close()
  }
})
