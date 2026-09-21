import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Board, BoardConfig } from '@renderer/services/arduino/types'
import {
  baseFqbn,
  isDiscoveryStub,
  resolveBuildTarget,
  substituteDiscoveryStub,
  withRealBoard
} from '../boardFallbacks'

const stub: BoardConfig = {
  fqbn: 'tinyCore:esp32:esp32_family',
  name: 'ESP32 Family Device'
}
const real: BoardConfig = {
  fqbn: 'tinyCore:esp32:tiny_core_esp32s3_nopsram',
  name: 'tinyCore ESP32-S3 No PSRAM'
}

describe('baseFqbn', () => {
  it('drops config options', () => {
    assert.equal(baseFqbn('tinyCore:esp32:esp32_family'), 'tinyCore:esp32:esp32_family')
    assert.equal(baseFqbn('esp32:esp32:esp32s3,PSRAM=disabled'), 'esp32:esp32:esp32s3')
  })
})

describe('isDiscoveryStub', () => {
  it('spots esp32_family whoever ships it, with or without options', () => {
    assert.equal(isDiscoveryStub('tinyCore:esp32:esp32_family'), true)
    assert.equal(isDiscoveryStub('esp32:esp32:esp32_family'), true)
    assert.equal(isDiscoveryStub('tinyCore:esp32:esp32_family,UploadSpeed=921600'), true)
  })

  it('leaves real boards alone', () => {
    assert.equal(isDiscoveryStub(real.fqbn), false)
    assert.equal(isDiscoveryStub('esp32:esp32:esp32s3'), false)
    assert.equal(isDiscoveryStub('arduino:avr:uno'), false)
    assert.equal(isDiscoveryStub(''), false)
    assert.equal(isDiscoveryStub('nonsense'), false)
  })
})

describe('substituteDiscoveryStub', () => {
  it("swaps tinyCore's stub for the real board", () => {
    const out = substituteDiscoveryStub(stub)
    assert.equal(out?.fqbn, real.fqbn)
    assert.equal(out?.name, real.name)
  })

  it("drops the stub's config options, which belong to menus it does not have", () => {
    const out = substituteDiscoveryStub({ ...stub, fqbn: `${stub.fqbn},UploadSpeed=921600` })
    assert.equal(out?.fqbn, real.fqbn)
  })

  it('keeps other board properties', () => {
    const out = substituteDiscoveryStub({ ...stub, package: 'tinyCore', architecture: 'esp32' })
    assert.equal(out?.package, 'tinyCore')
    assert.equal(out?.architecture, 'esp32')
  })

  it('returns null for anything it has no replacement for', () => {
    assert.equal(substituteDiscoveryStub(real), null)
    // Detectable but unmapped: resolveBuildTarget is what refuses these.
    assert.equal(substituteDiscoveryStub({ fqbn: 'esp32:esp32:esp32_family', name: 'x' }), null)
  })
})

describe('withRealBoard', () => {
  const detected: Board = { port: 'COM5', config: stub, connected: true }

  it('rewrites a detected stub and flags it as a guess', () => {
    const out = withRealBoard(detected)
    assert.equal(out.config.fqbn, real.fqbn)
    assert.equal(out.port, 'COM5')
    assert.equal(out.connected, true)
    assert.equal(out.guess, true)
  })

  it('passes a real board through untouched', () => {
    const board: Board = { port: 'COM5', config: real, connected: true }
    assert.equal(withRealBoard(board), board)
  })
})

describe('resolveBuildTarget', () => {
  it('returns the real board for a mapped stub', () => {
    assert.equal(resolveBuildTarget(stub).fqbn, real.fqbn)
  })

  it('passes real boards through', () => {
    const cfg: BoardConfig = { fqbn: 'arduino:avr:uno', name: 'Arduino Uno' }
    assert.equal(resolveBuildTarget(cfg), cfg)
  })

  it('refuses an unmapped stub instead of letting arduino-cli fail blind', () => {
    assert.throws(
      () => resolveBuildTarget({ fqbn: 'esp32:esp32:esp32_family', name: 'ESP32 Family Device' }),
      /placeholder/
    )
  })
})
