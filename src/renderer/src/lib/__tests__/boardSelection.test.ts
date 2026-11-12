import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Board } from '@renderer/services/arduino/types'
import { DISCONNECT_GRACE_MS, reconcileSelection } from '../boardSelection'

const board = (port: string, fqbn: string, extra: Partial<Board> = {}): Board => ({
  port,
  connected: true,
  config: { fqbn, name: fqbn || 'Unknown device' },
  deviceKey: `serial:${port}`,
  ...extra
})

const c6 = board('/dev/c6', 'esp32:esp32:sparkfun_esp32c6_qwiic_pocket', { source: 'remembered' })
const tiny = board('/dev/tiny', 'tinyCore:esp32:tiny_core_esp32s3_nopsram', { source: 'assumed' })

describe('reconcileSelection', () => {
  it('selects the first board with a known type when nothing is selected', () => {
    const unknown = board('/dev/x', '', { source: 'unknown' })
    assert.equal(reconcileSelection(null, [unknown, tiny], null, 0).next, tiny)
  })

  it("keeps the user's choice while the device is present", () => {
    const detectedAgain = { ...c6, config: { fqbn: 'esp32:esp32:other', name: 'Other' } }
    const out = reconcileSelection(c6, [detectedAgain], null, 0)
    assert.equal(out.next, c6)
  })

  it("follows detection when the selection was detection's own guess", () => {
    const guess = { ...tiny }
    const nowDetected = {
      ...tiny,
      config: { fqbn: 'esp32:esp32:esp32s3', name: 'ESP32S3' },
      source: 'detected' as const
    }
    assert.equal(reconcileSelection(guess, [nowDetected], null, 0).next, nowDetected)
  })

  it('rides out an upload reset: disconnected, then re-attached', () => {
    const gone = reconcileSelection(c6, [tiny], null, 1000)
    assert.equal(gone.next?.config.fqbn, c6.config.fqbn, 'still selected')
    assert.equal(gone.next?.connected, false)
    assert.equal(gone.disconnectedAt, 1000)
    assert.ok((gone.recheckInMs ?? 0) > 0)

    const back = reconcileSelection(gone.next, [tiny, c6], gone.disconnectedAt, 2500)
    assert.equal(back.next?.config.fqbn, c6.config.fqbn)
    assert.equal(back.next?.connected, true)
    assert.equal(back.disconnectedAt, null)
  })

  it('moves to another board only after the grace period', () => {
    const gone = reconcileSelection(c6, [tiny], null, 0)
    const still = reconcileSelection(
      gone.next,
      [tiny],
      gone.disconnectedAt,
      DISCONNECT_GRACE_MS - 1
    )
    assert.equal(still.next?.config.fqbn, c6.config.fqbn)
    const later = reconcileSelection(
      still.next,
      [tiny],
      still.disconnectedAt,
      DISCONNECT_GRACE_MS + 1
    )
    assert.equal(later.next, tiny)
    assert.equal(later.switchedFrom?.config.fqbn, c6.config.fqbn)
  })

  it('keeps an unplugged choice when nothing else is plugged in (Verify still works)', () => {
    const gone = reconcileSelection(c6, [], null, 0)
    const later = reconcileSelection(gone.next, [], gone.disconnectedAt, DISCONNECT_GRACE_MS * 3)
    assert.equal(later.next?.config.fqbn, c6.config.fqbn)
    assert.equal(later.next?.connected, false)
  })

  it('gives a hand-picked type with no port the first port', () => {
    const typeOnly: Board = { port: '', connected: false, config: c6.config }
    const out = reconcileSelection(typeOnly, [tiny], null, 0)
    assert.equal(out.next?.port, '/dev/tiny')
    assert.equal(out.next?.config.fqbn, c6.config.fqbn)
  })
})
