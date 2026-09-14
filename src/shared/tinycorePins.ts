/**
 * tinycorePins — the tinyCore (ESP32-S3) pin map, as data.
 *
 * One table feeds both Studio AI's tinyCore guide and the circuit inspector, so
 * the pin numbers the agent quotes can't drift between the two. Sources: the
 * board package's variant header (variants/tiny_core_esp32s3_nopsram/
 * pins_arduino.h) and the tinyCore V2 pinout render in Mister-Industries/tinyCore.
 *
 * `label` is the pin name in the tinycore part.json, so a circuit.json pin ref
 * like "tinycore:D13" looks up directly.
 */

export type TinyCoreHeader = 'left' | 'right' | 'bottom' | 'onboard'

export interface TinyCorePin {
  /** Pin name in the tinycore part.json (and so in circuit.json pin refs). */
  label: string
  /** ESP32-S3 GPIO number; absent for power and ground. */
  gpio?: number
  /** What to write in a sketch for this pin. */
  code?: string
  /** Name on the pinout diagram, when it differs from `label`. */
  silk?: string
  header: TinyCoreHeader
  /** ADC channel, bus role, or power rail. */
  functions: string[]
  note?: string
}

const QWIIC_NOTE = 'Shared with both Qwiic connectors.'

export const TINYCORE_PINS: TinyCorePin[] = [
  // left header, top to bottom
  { label: 'GND', header: 'left', functions: ['ground'] },
  { label: '3V3', header: 'left', functions: ['3.3 V out'] },
  { label: 'A5', gpio: 7, code: 'A5', header: 'left', functions: ['ADC1_CH6'] },
  { label: 'A4', gpio: 14, code: 'A4', header: 'left', functions: ['ADC2_CH3'] },
  { label: 'A3', gpio: 15, code: 'A3', header: 'left', functions: ['ADC2_CH4'] },
  { label: 'A2', gpio: 16, code: 'A2', header: 'left', functions: ['ADC2_CH5'] },
  { label: 'A1', gpio: 17, code: 'A1', header: 'left', functions: ['ADC2_CH6'] },
  { label: 'A0', gpio: 18, code: 'A0', header: 'left', functions: ['ADC2_CH7'] },
  // right header, top to bottom — the variant defines no D8…D13 constants
  { label: 'D8', gpio: 8, code: '8', silk: '8', header: 'right', functions: ['ADC1_CH7'] },
  { label: 'D9', gpio: 9, code: '9', silk: '9', header: 'right', functions: ['ADC1_CH8'] },
  { label: 'D10', gpio: 10, code: '10', silk: '10', header: 'right', functions: ['ADC1_CH9'] },
  { label: 'D11', gpio: 11, code: '11', silk: '11', header: 'right', functions: ['ADC2_CH0'] },
  { label: 'D12', gpio: 12, code: '12', silk: '12', header: 'right', functions: ['ADC2_CH1'] },
  { label: 'D13', gpio: 13, code: '13', silk: '13', header: 'right', functions: ['ADC2_CH2'] },
  { label: '3V3.2', silk: '3V3', header: 'right', functions: ['3.3 V out'] },
  { label: 'GND.2', silk: 'GND', header: 'right', functions: ['ground'] },
  // bottom header, left to right
  { label: 'SCK', gpio: 36, code: 'SCK', header: 'bottom', functions: ['SPI clock'] },
  { label: 'MO', gpio: 35, code: 'MOSI', silk: 'MOSI', header: 'bottom', functions: ['SPI MOSI'] },
  { label: 'MI', gpio: 37, code: 'MISO', silk: 'MISO', header: 'bottom', functions: ['SPI MISO'] },
  { label: 'RX', gpio: 38, code: 'RX', header: 'bottom', functions: ['UART RX (Serial1)'] },
  { label: 'TX', gpio: 39, code: 'TX', header: 'bottom', functions: ['UART TX (Serial1)'] },
  {
    label: 'SDA',
    gpio: 3,
    code: 'SDA',
    header: 'bottom',
    functions: ['I2C data', 'ADC1_CH2'],
    note: QWIIC_NOTE
  },
  {
    label: 'SCL',
    gpio: 4,
    code: 'SCL',
    header: 'bottom',
    functions: ['I2C clock', 'ADC1_CH3'],
    note: QWIIC_NOTE
  },
  {
    label: 'PWR',
    gpio: 6,
    code: 'PIN_I2C_POWER',
    silk: 'I2C_PWR',
    header: 'bottom',
    functions: ['I2C / Qwiic power enable'],
    note: 'Drive HIGH before Wire.begin(), or I2C devices stay unpowered.'
  },
  { label: 'GND.3', silk: 'GND', header: 'bottom', functions: ['ground'] }
]

/** Parts on the board itself that sit on a GPIO. */
export const TINYCORE_ONBOARD: TinyCorePin[] = [
  { label: 'LED_SIG', gpio: 33, code: 'LED_BUILTIN', header: 'onboard', functions: ['user LED'] },
  { label: 'LED_BOOT', gpio: 21, code: '21', header: 'onboard', functions: ['user LED'] }
]

/** Look a pin up by part.json label, diagram name, or code constant (case-insensitive). */
export function tinyCorePin(name: string): TinyCorePin | undefined {
  const n = name.trim().toUpperCase()
  return [...TINYCORE_PINS, ...TINYCORE_ONBOARD].find(
    (p) => p.label.toUpperCase() === n || p.silk?.toUpperCase() === n || p.code?.toUpperCase() === n
  )
}

/** One-line description, e.g. "GPIO 13 · ADC2_CH2 · write 13 in code". */
export function describeTinyCorePin(pin: TinyCorePin): string {
  if (pin.gpio === undefined) return pin.functions.join(' · ')
  const parts = [`GPIO ${pin.gpio}`, ...pin.functions]
  if (pin.code) parts.push(`write ${pin.code} in code`)
  return parts.join(' · ')
}

/** The pin map as a markdown table, for the tinyCore guide. */
export function tinyCorePinTable(): string {
  const rows = [...TINYCORE_PINS, ...TINYCORE_ONBOARD].map((p) =>
    [
      p.header,
      p.silk && p.silk !== p.label ? `${p.label} (${p.silk})` : p.label,
      p.gpio ?? '—',
      p.code ? `\`${p.code}\`` : '—',
      [...p.functions, p.note].filter(Boolean).join('; ')
    ].join(' | ')
  )
  return [
    'header | pin (part.json name) | GPIO | in code | functions',
    '--- | --- | --- | --- | ---',
    ...rows
  ]
    .map((r) => `| ${r} |`)
    .join('\n')
}
