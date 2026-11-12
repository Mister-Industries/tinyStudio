/**
 * circuit/export/kicadMap: part type → KiCad symbol, footprint and pad numbers.
 *
 * SparkFun's KiCad library comes first, because MR.INDUSTRIES boards are drawn
 * with it; KiCad's stock libraries fill in where SparkFun has no through-hole
 * equivalent. Pads are keyed by the part's OWN pin names (the names wires and
 * nets use), so a mapping can't drift from the circuit it exports.
 *
 * tinyStudio boards export as black boxes: one MR-INDUSTRIES footprint whose
 * pad N is the board's Nth header pin, in part.json order. Their internals
 * (LEDs, IMU, SD) never appear in an export, matching the simulator.
 */

import { isBreadboard } from '../parts/breadboard'

export interface KicadMapping {
  /** lib:symbol. Informational in a netlist; pcbnew reads the footprint. */
  symbol: string
  /** lib:footprint, or '' when nothing fits and the user must pick one. */
  footprint: string
  /** our pin name → footprint pad number */
  pads: Record<string, string>
}

const two = (a: string, b: string): Record<string, string> => ({ [a]: '1', [b]: '2' })

const AXIAL_R = 'SparkFun-Resistor:R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal'
const TO220 = 'SparkFun-Semiconductor-Standard:TO-220-3_Vertical'
const BUZZER = 'Buzzer_Beeper:Buzzer_12x9.5RM7.6'

/** Core-pack parts. LED and diode pads follow KiCad and SparkFun: 1 = K, 2 = A. */
export const KICAD_MAP: Record<string, KicadMapping> = {
  resistor: { symbol: 'Device:R', footprint: AXIAL_R, pads: two('Pin 0', 'Pin 1') },
  'capacitor-ceramic-100mil': {
    symbol: 'Device:C',
    footprint: 'Capacitor_THT:C_Disc_D5.0mm_W2.5mm_P2.50mm',
    pads: two('0', '1')
  },
  'capacitor-ceramic-200mil': {
    symbol: 'Device:C',
    footprint: 'Capacitor_THT:C_Disc_D5.0mm_W2.5mm_P5.00mm',
    pads: two('0', '1')
  },
  'capacitor-electrolytic-medium': {
    symbol: 'Device:C_Polarized',
    footprint: 'Capacitor_THT:CP_Radial_D5.0mm_P2.50mm',
    pads: two('+', '-')
  },
  'diode-1n4001-300mil': {
    symbol: 'Device:D',
    footprint: 'Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal',
    pads: two('cathode', 'anode')
  },
  'diode-zener-0-5w-3-6v-300mil': {
    symbol: 'Device:D_Zener',
    footprint: 'Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal',
    pads: two('cathode', 'anode')
  },
  'led-generic-5mm': {
    symbol: 'Device:LED',
    footprint: 'SparkFun-LED:LED_5mm_PTH_Red_Silk',
    pads: two('cathode', 'anode')
  },
  'led-generic-3mm': {
    symbol: 'Device:LED',
    footprint: 'LED_THT:LED_D3.0mm',
    pads: two('cathode', 'anode')
  },
  'ldr-photocell-300mil-v5': {
    symbol: 'Device:R_Photo',
    footprint: 'OptoDevice:R_LDR_5.1x4.3mm_P3.4mm_Vertical',
    pads: two('pin 0', 'pin 1')
  },
  'thermistor-300mil': {
    symbol: 'Device:Thermistor',
    footprint: AXIAL_R,
    pads: two('pin 0', 'pin 1')
  },
  'potentiometer-trimmer-6mm-5': {
    symbol: 'Device:R_Potentiometer',
    footprint: 'SparkFun-Resistor:Trimpot_PTH_3386U',
    pads: { leg1: '1', wiper: '2', leg2: '3' }
  },
  'potentiometer-rotary-16mm-5': {
    symbol: 'Device:R_Potentiometer',
    footprint: 'Potentiometer_THT:Potentiometer_Alps_RK163_Single_Horizontal',
    pads: { leg1: '1', wiper: '2', leg2: '3' }
  },
  pushbutton: {
    symbol: 'Switch:SW_Push',
    footprint: 'SparkFun-Switch:Push_PTH_6x6mm',
    pads: two('leg0', 'leg1')
  },
  // SparkFun's 6 mm (COM-00097) and 12 mm (COM-09190) tactile buttons. KiCad's
  // stock footprints number the four legs 1, 2, 1, 2: each joined pair of legs
  // (the part's 1a/1b and 2a/2b buses) is one pad number.
  'tactile-button-6mm': {
    symbol: 'Switch:SW_Push',
    footprint: 'Button_Switch_THT:SW_PUSH_6mm',
    pads: { '1a': '1', '1b': '1', '2a': '2', '2b': '2' }
  },
  'tactile-button-12mm': {
    symbol: 'Switch:SW_Push',
    footprint: 'SparkFun-Switch:Push_PTH_12x12mm',
    pads: { '1a': '1', '1b': '1', '2a': '2', '2b': '2' }
  },
  'switch-spst': {
    symbol: 'Switch:SW_SPST',
    footprint: 'SparkFun-Switch:Slide_SPDT_PTH_11.6x4.0mm',
    pads: two('1', '2')
  },
  'battery-aa': {
    symbol: 'Device:Battery_Cell',
    footprint: 'Battery:BatteryHolder_Keystone_2460_1xAA',
    pads: two('+', '-')
  },
  'buzzer-v15': { symbol: 'Device:Buzzer', footprint: BUZZER, pads: two('+', '-') },
  'piezo-sensor': { symbol: 'Device:Buzzer', footprint: BUZZER, pads: two('pin1', 'pin2') },
  'transistor-signal-npn-to92-ebc': {
    symbol: 'Transistor_BJT:Q_NPN_EBC',
    footprint: 'Package_TO_SOT_THT:TO-92_Inline',
    pads: { E: '1', B: '2', C: '3' }
  },
  'transistor-signal-pnp-to92-ebc': {
    symbol: 'Transistor_BJT:Q_PNP_EBC',
    footprint: 'Package_TO_SOT_THT:TO-92_Inline',
    pads: { E: '1', B: '2', C: '3' }
  },
  'sparkfun-discretesemi-mosfet-nchannel-pth': {
    symbol: 'Transistor_FET:Q_NMOS_GDS',
    footprint: TO220,
    pads: { G: '1', D: '2', S: '3' }
  },
  'voltage-regulator-7805': {
    symbol: 'Regulator_Linear:L7805',
    footprint: TO220,
    pads: { 'input voltage': '1', GND: '2', 'output voltage': '3' }
  },
  'sparkfun-passives-fuse-x20mm': {
    symbol: 'Device:Fuse',
    footprint: 'Fuse:Fuseholder_Cylinder-5x20mm_Schurter_0031_8201_Horizontal_OpenType',
    pads: two('1', '2')
  },
  'smd-inductor-0805': {
    symbol: 'Device:L',
    footprint: 'SparkFun-Coil:0805',
    pads: two('pin 0', 'pin 1')
  },
  servo: {
    symbol: 'Connector_Generic:Conn_01x03',
    footprint: 'SparkFun-Connector:1x03_P2.54mm',
    pads: { gnd: '1', vcc: '2', pulse: '3' }
  },
  'ir-receiver-v14': {
    symbol: 'Interface_Optical:TSOP382xx',
    footprint: 'OptoDevice:Vishay_MINICAST-3Pin',
    pads: { OUT: '1', GND: '2', VCC: '3' }
  }
}

/** A tinyStudio board (tinyCore or a HAT); tinyProto is a connection board, not a part. */
export function isTinyBoard(type: string): boolean {
  return /^tiny[a-z]+$/.test(type) && type !== 'tinyproto'
}

/**
 * Parts that become components in an export. Breadboards and tinyProto only
 * join nets; simulation sources and probes exist only in the simulator.
 */
export function isExportedPart(type: string): boolean {
  return !type.startsWith('sim-') && !isBreadboard(type) && type !== 'tinyproto'
}

export interface ResolvedMapping extends KicadMapping {
  /** true when no table entry fit: footprint is blank and pads are numbered by pin order */
  generic: boolean
}

/** The mapping for a part type, falling back to pin-order pads with no footprint. */
export function kicadMappingFor(type: string, pins: string[]): ResolvedMapping {
  const known = KICAD_MAP[type]
  if (known) return { ...known, generic: false }
  const pads = Object.fromEntries(pins.map((p, i) => [p, String(i + 1)]))
  if (isTinyBoard(type)) {
    return {
      symbol: `MR-INDUSTRIES:${type}`,
      footprint: `MR-INDUSTRIES:${type}`,
      pads,
      generic: false
    }
  }
  return { symbol: '', footprint: '', pads, generic: true }
}
