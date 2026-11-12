/**
 * detectedBoards: turns tinyService's raw port matches into the boards the UI
 * offers, one decision per port:
 *
 *  1. remembered: the user chose a board for this device before, so use it.
 *  2. detected: arduino-cli matched the device to a real (non-hidden) board.
 *     Several matches are all listed, best first, so the user can pick.
 *  3. assumed: a generic ESP32 (see isGenericEsp32) gets tinyCore. That USB id
 *     is the chip's built-in USB-serial bridge, shared by every ESP32-S3/C3/C6
 *     in its default mode, so it names a chip family, not a board. Any board
 *     that claims it (Espressif's core has one) is kept as an alternative.
 *  4. unknown: nothing to go on; listed with no board type until the user
 *     picks one (which is then remembered).
 */

import type { Board, BoardConfig } from '@renderer/services/arduino/types'
import { type BoardHistory, deviceKey } from './boardHistory'
import { defaultEsp32FamilyBoard, isDiscoveryStub } from './boardFallbacks'

/** Espressif's USB vendor id and the built-in USB-Serial/JTAG product id. */
const ESPRESSIF_VID = '0x303a'
const USB_SERIAL_JTAG_PID = '0x1001'

/**
 * True when the port is an ESP32 that identifies only as its chip family:
 * Espressif's USB-Serial/JTAG id (303a:1001), or a match on an `esp32_family`
 * placeholder board.
 */
export function isGenericEsp32(entries: Board[]): boolean {
  const first = entries[0]
  const vid = first?.metadata?.vendorId?.toLowerCase()
  const pid = first?.metadata?.productId?.toLowerCase()
  if (vid === ESPRESSIF_VID && pid === USB_SERIAL_JTAG_PID) return true
  return entries.some((e) => e.config.fqbn && isDiscoveryStub(e.config.fqbn))
}

/** Group raw entries (one per matched board) by port, keeping first-seen order. */
function groupByPort(raw: Board[]): Board[][] {
  const groups = new Map<string, Board[]>()
  for (const entry of raw) {
    const list = groups.get(entry.port)
    if (list) list.push(entry)
    else groups.set(entry.port, [entry])
  }
  return [...groups.values()]
}

function isRealMatch(entry: Board): boolean {
  return Boolean(entry.config.fqbn) && !entry.isHidden && !isDiscoveryStub(entry.config.fqbn)
}

/** Distinct board configs, by FQBN. */
function distinct(configs: BoardConfig[]): BoardConfig[] {
  const seen = new Set<string>()
  return configs.filter((c) => {
    if (seen.has(c.fqbn)) return false
    seen.add(c.fqbn)
    return true
  })
}

/**
 * Resolve raw tinyService entries into the boards to offer. `installedFqbns`
 * (from board-listall) picks the right tinyCore FQBN for generic ESP32s; see
 * defaultEsp32FamilyBoard.
 */
export function resolveDetectedBoards(
  raw: Board[],
  history: BoardHistory,
  installedFqbns?: ReadonlySet<string>
): Board[] {
  const out: Board[] = []
  for (const entries of groupByPort(raw)) {
    const base = entries[0]
    const key = deviceKey(base)
    const port: Omit<Board, 'config'> = {
      port: base.port,
      protocol: base.protocol,
      connected: base.connected,
      metadata: base.metadata,
      deviceKey: key
    }
    const real = distinct(entries.filter(isRealMatch).map((e) => e.config))
    const generic = isGenericEsp32(entries)

    const remembered = history[key]
    if (remembered) {
      out.push({
        ...port,
        config: { fqbn: remembered.fqbn, name: remembered.name },
        source: 'remembered',
        alternatives: real.filter((c) => c.fqbn !== remembered.fqbn)
      })
      continue
    }

    if (generic) {
      const tinyCore = defaultEsp32FamilyBoard(installedFqbns)
      out.push({
        ...port,
        config: tinyCore,
        source: 'assumed',
        guess: true,
        alternatives: real.filter((c) => c.fqbn !== tinyCore.fqbn)
      })
      continue
    }

    if (real.length > 0) {
      // One entry per candidate, so an ambiguous port can be resolved straight
      // from the board menu; the first is the default.
      real.forEach((config, i) =>
        out.push({
          ...port,
          config,
          source: 'detected',
          alternatives: real.filter((_, j) => j !== i)
        })
      )
      continue
    }

    const placeholder = entries.find((e) => e.config.fqbn)
    out.push({
      ...port,
      config: {
        fqbn: '',
        name: placeholder?.config.name || `Unknown device`
      },
      source: 'unknown',
      guess: true
    })
  }
  return out
}

/** A short label for where a board came from, for the board menu. */
export function boardSourceLabel(board: Board): string | null {
  switch (board.source) {
    case 'remembered':
      return 'your choice'
    case 'assumed':
      return 'assumed'
    case 'unknown':
      return 'choose type'
    default:
      return (board.alternatives?.length ?? 0) > 0 ? 'one of several' : null
  }
}
