/**
 * Board history: which board (with its options) the user chose for each
 * device, so plugging the same board back in, or the reset during an upload,
 * brings back their choice instead of whatever detection guesses. The Arduino
 * IDE keeps the same kind of per-port history.
 *
 * A device is keyed by its USB identity when it reports a serial number (an
 * ESP32's is its MAC address), so the choice follows the board to any USB
 * socket. Devices without one (many CH340/CP210x adapters) are keyed by port.
 */

import type { Board, BoardConfig } from '@renderer/services/arduino/types'
import { STORAGE_KEYS } from './storageKeys'

export interface RememberedBoard {
  fqbn: string
  name: string
  updatedAt: number
}

export type BoardHistory = Record<string, RememberedBoard>

/** Keep the history small; the oldest entries go first. */
const MAX_ENTRIES = 50

/**
 * The stable key of the device on `board`'s port: USB vid:pid:serial when the
 * device has a serial number, else the port address.
 */
export function deviceKey(board: Pick<Board, 'port' | 'protocol' | 'metadata'>): string {
  const { vendorId, productId, serialNumber } = board.metadata ?? {}
  if (vendorId && productId && serialNumber) {
    return `usb:${vendorId.toLowerCase()}:${productId.toLowerCase()}:${serialNumber}`
  }
  return `${board.protocol || 'serial'}:${board.port}`
}

export function loadBoardHistory(): BoardHistory {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.boardHistory)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const history: BoardHistory = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = value as Partial<RememberedBoard>
      if (typeof v?.fqbn === 'string' && v.fqbn && typeof v.name === 'string') {
        history[key] = { fqbn: v.fqbn, name: v.name, updatedAt: Number(v.updatedAt) || 0 }
      }
    }
    return history
  } catch {
    return {}
  }
}

function saveBoardHistory(history: BoardHistory): void {
  try {
    localStorage.setItem(STORAGE_KEYS.boardHistory, JSON.stringify(history))
  } catch {
    /* storage full or unavailable: the choice just won't survive a restart */
  }
}

/** Remember `config` for the device `key`; returns the new history. */
export function rememberBoard(
  history: BoardHistory,
  key: string,
  config: BoardConfig
): BoardHistory {
  if (!config.fqbn) return history
  const next: BoardHistory = {
    ...history,
    [key]: { fqbn: config.fqbn, name: config.name, updatedAt: Date.now() }
  }
  const keys = Object.keys(next)
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => next[a].updatedAt - next[b].updatedAt)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete next[k])
  }
  saveBoardHistory(next)
  return next
}

/** Forget the device `key`; returns the new history. */
export function forgetBoard(history: BoardHistory, key: string): BoardHistory {
  if (!(key in history)) return history
  const next = { ...history }
  delete next[key]
  saveBoardHistory(next)
  return next
}
