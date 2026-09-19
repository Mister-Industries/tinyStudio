/**
 * What to do when the tinyService child process exits. Kept free of Electron
 * so it can be unit-tested; ServiceManager supplies the timestamps.
 *
 * The policy: an exit we asked for is ignored. An unexpected exit gets one
 * automatic restart on the same port. If the restarted service dies again
 * within RESTART_WINDOW_MS, restarting clearly isn't helping, so give up and
 * tell the user. A service that ran longer than the window before dying earns
 * a fresh restart.
 */

export const RESTART_WINDOW_MS = 60_000

export type ExitDecision = 'ignore' | 'restart' | 'give-up'

export function decideAfterExit(input: {
  /** stop() was called: the exit is expected. */
  stopping: boolean
  /** When the last automatic restart happened, or null if there was none. */
  lastRestartAt: number | null
  now: number
}): ExitDecision {
  if (input.stopping) return 'ignore'
  if (input.lastRestartAt !== null && input.now - input.lastRestartAt < RESTART_WINDOW_MS) {
    return 'give-up'
  }
  return 'restart'
}
