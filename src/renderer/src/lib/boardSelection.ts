/**
 * boardSelection: keeping the selected board in step with what is plugged in.
 */

import type { Board } from '@renderer/services/arduino/types'

/**
 * How long a selected board may be missing before the selection moves to
 * another board. Covers the USB re-enumeration of an ESP32 reset.
 */
export const DISCONNECT_GRACE_MS = 5000

/**
 * Decide what the selection should be now that `boards` changed. Pure, so
 * React may call it as often as it likes; useArduino applies the side effects
 * (re-check timer, toast).
 *
 *  - Same device still present: keep the user's choice (board type and
 *    options); follow detection only if the selection was detection's own
 *    guess and the device's identity changed (e.g. a platform was installed).
 *  - Device gone: keep the selection, marked disconnected, for a grace
 *    period. An ESP32 drops off USB for a moment on every reset (uploads
 *    included), and Verify still works without a port. When it comes back,
 *    the selection re-attaches quietly. Only after the grace period does it
 *    move to another connected board.
 *  - Nothing selected: take the first board with a known type.
 */
export function reconcileSelection(
  current: Board | null,
  boards: Board[],
  disconnectedAt: number | null,
  now: number
): {
  next: Board | null
  /** When the selected device went missing (null while it is present). */
  disconnectedAt: number | null
  /** Run again after this long to finish the grace period. */
  recheckInMs?: number
  /** Set when the selection moved off a board that disappeared. */
  switchedFrom?: Board
} {
  const firstKnown = (): Board | null => boards.find((b) => b.config.fqbn) ?? boards[0] ?? null

  if (!current) return { next: firstKnown(), disconnectedAt: null }

  // A board type picked by hand with no port yet: adopt the first port.
  if (!current.port) {
    const first = boards[0]
    return {
      next: first
        ? {
            ...current,
            port: first.port,
            protocol: first.protocol,
            metadata: first.metadata,
            deviceKey: first.deviceKey,
            connected: first.connected
          }
        : current,
      disconnectedAt: null
    }
  }

  const sameDevice =
    boards.find((b) => current.deviceKey && b.deviceKey === current.deviceKey) ??
    boards.find((b) => b.port === current.port)
  if (sameDevice) {
    const userChose = current.source === 'remembered'
    if (!userChose && sameDevice.config.fqbn !== current.config.fqbn) {
      return { next: sameDevice, disconnectedAt: null } // detection changed its guess
    }
    const unchanged =
      current.connected &&
      current.port === sameDevice.port &&
      JSON.stringify(current.alternatives ?? []) === JSON.stringify(sameDevice.alternatives ?? [])
    return {
      next: unchanged
        ? current
        : {
            ...current,
            port: sameDevice.port,
            connected: true,
            alternatives: sameDevice.alternatives
          },
      disconnectedAt: null
    }
  }

  // The device is gone.
  const since = disconnectedAt ?? now
  const waited = now - since
  if (waited < DISCONNECT_GRACE_MS) {
    return {
      next: current.connected ? { ...current, connected: false } : current,
      disconnectedAt: since,
      recheckInMs: DISCONNECT_GRACE_MS - waited + 50
    }
  }
  const next = firstKnown()
  if (next) return { next, disconnectedAt: null, switchedFrom: current }
  return {
    next: current.connected ? { ...current, connected: false } : current,
    disconnectedAt: since
  }
}
