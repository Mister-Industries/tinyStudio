/**
 * Discovery-only board definitions, and the real boards to use instead.
 *
 * A platform may ship a hidden board whose only job is to put a name to a USB
 * VID/PID during `arduino-cli board list`. Espressif's `esp32_family` is the
 * one that bites us: every ESP32-S3 enumerates over its built-in USB-serial-
 * JTAG bridge as 303a:1001, and the tinyCore platform carries this entry (as
 * Espressif's own does) so that port gets a name:
 *
 *   esp32_family.name=ESP32 Family Device
 *   esp32_family.hide=true
 *   esp32_family.vid.0=0x303a
 *   esp32_family.pid.0=0x1001
 *   esp32_family.build.board=ESP32_FAMILY
 *
 * That is the entire definition — no build.mcu, core, variant or upload tool,
 * and `hide=true` keeps it out of the Arduino IDE's board list. arduino-cli
 * will happily accept it as an FQBN and then fail deep inside the build with a
 * bare "Error during build: exit status 1" and no diagnostics, because the
 * recipes expand with empty values.
 *
 * So a detected stub is swapped for the real board of the same platform before
 * it can reach a compile or upload. The map is deliberately narrow: only a
 * board we know ships in the same platform as the stub that points at it.
 */

import type { Board, BoardConfig } from '@renderer/services/arduino/types'

interface StubTarget {
  fqbn: string
  name: string
}

const DISCOVERY_STUBS: Readonly<Record<string, StubTarget>> = {
  'tinyCore:esp32:esp32_family': {
    fqbn: 'tinyCore:esp32:tiny_core_esp32s3_nopsram',
    name: 'tinyCore ESP32-S3 No PSRAM'
  }
}

/** An FQBN without its config options: `a:b:c,opt=1` -> `a:b:c`. */
export function baseFqbn(fqbn: string): string {
  return fqbn.split(',')[0]
}

/** The board id of `vendor:arch:id`, or '' when the FQBN is malformed. */
function boardId(fqbn: string): string {
  const parts = baseFqbn(fqbn).split(':')
  return parts.length >= 3 && parts[0] && parts[1] ? parts[2] : ''
}

/**
 * Whether this FQBN names a discovery stub: detectable, not compilable. True
 * for the stubs we map and for any `esp32_family` entry, whoever ships it.
 */
export function isDiscoveryStub(fqbn: string): boolean {
  return boardId(fqbn) === 'esp32_family' || baseFqbn(fqbn) in DISCOVERY_STUBS
}

/**
 * The real board to use in place of `config`, or null when `config` isn't a
 * stub we have a replacement for. Config options are dropped with the stub:
 * they belong to the stub's (nonexistent) menus, not the real board's.
 */
export function substituteDiscoveryStub(config: BoardConfig): BoardConfig | null {
  const target = DISCOVERY_STUBS[baseFqbn(config.fqbn)]
  if (!target) return null
  return { ...config, fqbn: target.fqbn, name: target.name }
}

/**
 * A detected board with any stub identity replaced. The result is flagged as a
 * guess, because the USB id it was matched on belongs to every ESP32-S3 — the
 * user can still override it in the board picker.
 */
export function withRealBoard(board: Board): Board {
  const real = substituteDiscoveryStub(board.config)
  return real ? { ...board, config: real, guess: true } : board
}

/**
 * The board to hand arduino-cli for a build. Throws when the selection is a
 * stub with no known replacement, which is a far better error than the one
 * arduino-cli gives for the same mistake.
 */
export function resolveBuildTarget(config: BoardConfig): BoardConfig {
  const real = substituteDiscoveryStub(config)
  if (real) return real
  if (isDiscoveryStub(config.fqbn)) {
    throw new Error(
      `${config.name} (${config.fqbn}) is a USB-discovery placeholder, not a board that can be built. Choose your board type in the Boards Manager.`
    )
  }
  return config
}
