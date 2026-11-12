import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Board } from '@renderer/services/arduino/types'
import { deviceKey, forgetBoard, rememberBoard, type BoardHistory } from '../boardHistory'
import { isGenericEsp32, resolveDetectedBoards } from '../detectedBoards'
import { TINYCORE_PACKAGE_BOARD, TINYCORE_UPSTREAM_BOARD } from '../boardFallbacks'

// localStorage for rememberBoard/forgetBoard under node:test.
const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k)
}

/** One raw entry as WebSocketArduinoService.toBoard produces it. */
function entry(
  port: string,
  fqbn: string,
  name: string,
  usb: { vid?: string; pid?: string; serial?: string } = {},
  isHidden = false
): Board {
  return {
    port,
    protocol: 'serial',
    connected: true,
    config: { fqbn, name },
    ...(isHidden ? { isHidden: true } : {}),
    metadata: { vendorId: usb.vid, productId: usb.pid, serialNumber: usb.serial }
  }
}

const S3 = { vid: '0x303a', pid: '0x1001', serial: 'F4:12:FA:00:00:01' }

describe('resolveDetectedBoards', () => {
  it('defaults a generic ESP32 (placeholder only) to tinyCore', () => {
    const boards = resolveDetectedBoards(
      [
        entry('/dev/cu.usbmodem1101', 'esp32:esp32:esp32_family', 'ESP32 Family Device', S3, true),
        entry(
          '/dev/cu.usbmodem1101',
          'tinyCore:esp32:esp32_family',
          'ESP32 Family Device',
          S3,
          true
        )
      ],
      {}
    )
    assert.equal(boards.length, 1)
    assert.equal(boards[0].config.fqbn, TINYCORE_PACKAGE_BOARD.fqbn)
    assert.equal(boards[0].source, 'assumed')
    assert.equal(boards[0].guess, true)
  })

  it('treats 303a:1001 as generic even when a board claims it', () => {
    // Espressif's core has a board (Ozobot DrvKit) declaring the shared id.
    const boards = resolveDetectedBoards(
      [
        entry('/dev/cu.usbmodem1101', 'esp32:esp32:ozobot_drvkit', 'Ozobot DrvKit', S3),
        entry('/dev/cu.usbmodem1101', 'esp32:esp32:esp32_family', 'ESP32 Family Device', S3, true)
      ],
      {}
    )
    assert.equal(boards.length, 1)
    assert.equal(boards[0].config.fqbn, TINYCORE_PACKAGE_BOARD.fqbn)
    assert.deepEqual(
      boards[0].alternatives?.map((a) => a.fqbn),
      ['esp32:esp32:ozobot_drvkit'],
      'the claimant stays available in the picker'
    )
  })

  it('defaults a generic ESP32 with no platform installed yet to tinyCore', () => {
    const boards = resolveDetectedBoards(
      [entry('/dev/cu.usbmodem1101', '', 'Unknown device', S3)],
      {}
    )
    assert.equal(boards[0].config.fqbn, TINYCORE_PACKAGE_BOARD.fqbn)
  })

  it('prefers the upstream tinyCore board once Espressif ships it', () => {
    const boards = resolveDetectedBoards(
      [entry('/dev/cu.usbmodem1101', 'esp32:esp32:esp32_family', 'ESP32 Family Device', S3, true)],
      {},
      new Set([TINYCORE_UPSTREAM_BOARD.fqbn, TINYCORE_PACKAGE_BOARD.fqbn])
    )
    assert.equal(boards[0].config.fqbn, TINYCORE_UPSTREAM_BOARD.fqbn)
  })

  it('keeps a board that has its own USB id (Arduino Nano ESP32)', () => {
    const boards = resolveDetectedBoards(
      [
        entry('/dev/cu.usbmodem3', 'esp32:esp32:nano_nora', 'Arduino Nano ESP32', {
          vid: '0x2341',
          pid: '0x0070'
        })
      ],
      {}
    )
    assert.equal(boards[0].config.fqbn, 'esp32:esp32:nano_nora')
    assert.equal(boards[0].source, 'detected')
    assert.equal(boards[0].guess, undefined)
  })

  it('remembers a SparkFun IoT RedBoard (no USB id of its own) by port', () => {
    // It sits behind a CH340 with no serial number: unknown until chosen once.
    const raw = [
      entry('/dev/cu.usbserial-110', '', 'Unknown device', { vid: '0x1a86', pid: '0x7523' })
    ]
    assert.equal(resolveDetectedBoards(raw, {})[0].source, 'unknown')
    const history = rememberBoard({}, deviceKey(raw[0]), {
      fqbn: 'esp32:esp32:sparkfun_esp32_iot_redboard',
      name: 'SparkFun ESP32 IoT RedBoard'
    })
    const [board] = resolveDetectedBoards(raw, history)
    assert.equal(board.config.fqbn, 'esp32:esp32:sparkfun_esp32_iot_redboard')
    assert.equal(board.source, 'remembered')
  })

  it('lists every candidate when a port is ambiguous', () => {
    const usb = { vid: '0x239a', pid: '0x8113' }
    const boards = resolveDetectedBoards(
      [
        entry(
          '/dev/cu.usbmodem2',
          'esp32:esp32:adafruit_feather_esp32s3_nopsram',
          'Adafruit Feather ESP32-S3 No PSRAM',
          usb
        ),
        entry('/dev/cu.usbmodem2', 'esp32:esp32:Bee_Motion_S3', 'Bee Motion S3', usb)
      ],
      {}
    )
    assert.equal(boards.length, 2)
    assert.equal(boards[0].alternatives?.[0].fqbn, 'esp32:esp32:Bee_Motion_S3')
  })

  it('leaves an unknown device without a board type', () => {
    const boards = resolveDetectedBoards(
      [
        entry('/dev/cu.usbserial-1', '', 'Unknown device (/dev/cu.usbserial-1)', {
          vid: '0x1a86',
          pid: '0x7523'
        })
      ],
      {}
    )
    assert.equal(boards[0].config.fqbn, '')
    assert.equal(boards[0].source, 'unknown')
  })

  it('uses the remembered choice, options included, over everything else', () => {
    const raw = [
      entry('/dev/cu.usbmodem1101', 'esp32:esp32:esp32_family', 'ESP32 Family Device', S3, true)
    ]
    const key = deviceKey(raw[0])
    const history: BoardHistory = {
      [key]: {
        fqbn: 'esp32:esp32:sparkfun_esp32c6_qwiic_pocket:CDCOnBoot=cdc',
        name: 'SparkFun ESP32-C6 Qwiic Pocket',
        updatedAt: 1
      }
    }
    const boards = resolveDetectedBoards(raw, history)
    assert.equal(boards[0].config.fqbn, 'esp32:esp32:sparkfun_esp32c6_qwiic_pocket:CDCOnBoot=cdc')
    assert.equal(boards[0].source, 'remembered')
  })

  it('keeps ports in first-seen order', () => {
    const boards = resolveDetectedBoards(
      [
        entry('/dev/b', 'arduino:avr:uno', 'Arduino Uno', { vid: '0x2341', pid: '0x0043' }),
        entry('/dev/a', '', 'Unknown device', { vid: '0x10c4', pid: '0xea60' })
      ],
      {}
    )
    assert.deepEqual(
      boards.map((b) => b.port),
      ['/dev/b', '/dev/a']
    )
  })
})

describe('isGenericEsp32', () => {
  it('is false for an ESP32 running TinyUSB with its own id', () => {
    assert.equal(
      isGenericEsp32([
        entry('/dev/x', 'esp32:esp32:adafruit_feather_esp32s3_nopsram', 'Feather', {
          vid: '0x239a',
          pid: '0x8113'
        })
      ]),
      false
    )
  })
})

describe('boardHistory', () => {
  it('keys a device by USB serial when it has one, else by port', () => {
    assert.equal(
      deviceKey(entry('/dev/cu.usbmodem1101', '', '', S3)),
      'usb:0x303a:0x1001:F4:12:FA:00:00:01'
    )
    assert.equal(
      deviceKey(entry('/dev/cu.usbserial-1', '', '', { vid: '0x1a86', pid: '0x7523' })),
      'serial:/dev/cu.usbserial-1'
    )
  })

  it('remembers and forgets, persisting to storage', () => {
    let h: BoardHistory = {}
    h = rememberBoard(h, 'usb:a', { fqbn: 'esp32:esp32:esp32s3', name: 'ESP32S3 Dev Module' })
    assert.equal(h['usb:a'].fqbn, 'esp32:esp32:esp32s3')
    assert.match(store.get('tinystudio.boards.history') ?? '', /esp32s3/)
    h = forgetBoard(h, 'usb:a')
    assert.equal(h['usb:a'], undefined)
  })

  it('ignores a board without a type', () => {
    const h = rememberBoard({}, 'usb:a', { fqbn: '', name: 'Unknown device' })
    assert.deepEqual(h, {})
  })
})
