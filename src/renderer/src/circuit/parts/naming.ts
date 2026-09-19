/**
 * circuit/parts/naming: human-readable part names and categories.
 *
 * Fritzing-imported parts arrive with whatever the .fzp author typed: labels
 * like "MOSFET-NCHANNEL", "FUSE" or "led", and families like
 * "microcontroller board (lilypad)" or "Capacitor [bidirectional]". That
 * leaks straight into the components rail, the inspector and the refdes
 * generator. This module is the single place that turns raw part metadata
 * into something a human wants to read:
 *
 *   - `PART_NAMING`: a curated table for parts we ship (exact names, the
 *     category they belong in, and the refdes prefix they deserve).
 *   - `humanizeLabel` / `humanizeCategory`: the fallback for anything we
 *     don't know: dropped .fzpz files, pack installs, user-authored parts.
 *
 * Naming is applied centrally in `lib/partsLibrary` (manifest metadata, lazy
 * part loads and `registerPart`), so every surface (palette, inspector,
 * tray, exports) shows the same name without each one re-deriving it.
 *
 * IMPORTANT: the SPICE netlist generator and the refdes assigner match on
 * keyword regexes over `"<type> <family>"`. Renaming a family could silently
 * change how a part simulates, so a curated entry can carry:
 *   - `sim`:     the keyword string handed to the netlist generator instead
 *                of the display category (keeps emitter matching stable), and
 *   - `prefix`:  an explicit refdes prefix (R, C, D, Q…), which beats the
 *                keyword guess in core/refdes.
 *
 * Zero imports by design: this is pure string data, so `lib/partsLibrary` can
 * depend on it without a cycle.
 */

export interface PartNaming {
  /** Display name shown in the palette, inspector and tray. */
  label: string
  /** Display category: the collapsible group in the components rail. */
  category: string
  /** Keyword string for the SPICE emitter match (defaults to the category). */
  sim?: string
  /** Explicit refdes prefix; beats core/refdes keyword matching. */
  prefix?: string
}

/**
 * Category display order in the components rail. Anything not listed sorts
 * alphabetically after these, with `Uncategorized` always last.
 */
export const CATEGORY_ORDER: string[] = [
  'tinyStudio Boards',
  'Breadboards',
  'Sources',
  'Passive Elements',
  'Diodes',
  'Transistors',
  'Switches',
  'Relays',
  'Sensors',
  'Displays',
  'Audio',
  'Motors & Actuators',
  'Power',
  'Integrated Circuits',
  'Connectors',
  'Probes & Meters',
  'Imported',
  'Custom',
  'Uncategorized'
]

const ORDER_INDEX = new Map(CATEGORY_ORDER.map((c, i) => [c, i]))

/** Sort comparator for category groups (curated order, then alphabetical). */
export function compareCategories(a: string, b: string): number {
  const ia = ORDER_INDEX.get(a)
  const ib = ORDER_INDEX.get(b)
  if (ia !== undefined && ib !== undefined) return ia - ib
  if (ia !== undefined) return -1
  if (ib !== undefined) return 1
  return a.localeCompare(b)
}

/**
 * Curated names for every part tinyStudio ships. Keyed by PartDef.type.
 *
 * Rules of thumb used here:
 *  - name the component, not the Fritzing file ("Pushbutton", not "pushbutton")
 *  - keep the distinguishing detail in parentheses (package, pitch, rating)
 *  - never bake a value into the name; values live in `attrs` and render as
 *    the schematic's value text (a resistor is "Resistor", not "220 Ω Resistor")
 */
export const PART_NAMING: Record<string, PartNaming> = {
  // ── passives ──────────────────────────────────────────────────────────────
  resistor: { label: 'Resistor', category: 'Passive Elements', prefix: 'R' },
  'potentiometer-rotary-16mm-5': {
    label: 'Rotary Potentiometer (16 mm)',
    category: 'Passive Elements',
    sim: 'potentiometer',
    prefix: 'RV'
  },
  'potentiometer-trimmer-6mm-5': {
    label: 'Trimmer Potentiometer (6 mm)',
    category: 'Passive Elements',
    sim: 'trimmer potentiometer',
    prefix: 'RV'
  },
  'capacitor-ceramic-100mil': {
    label: 'Ceramic Capacitor (0.1 in)',
    category: 'Passive Elements',
    sim: 'capacitor',
    prefix: 'C'
  },
  'capacitor-ceramic-200mil': {
    label: 'Ceramic Capacitor (0.2 in)',
    category: 'Passive Elements',
    sim: 'capacitor',
    prefix: 'C'
  },
  'capacitor-electrolytic-medium': {
    label: 'Electrolytic Capacitor',
    category: 'Passive Elements',
    sim: 'capacitor polarized',
    prefix: 'C'
  },
  'smd-inductor-0805': {
    label: 'Inductor (0805)',
    category: 'Passive Elements',
    sim: 'inductor',
    prefix: 'L'
  },
  'sparkfun-passives-fuse-x20mm': {
    label: 'Fuse (20 mm)',
    category: 'Passive Elements',
    sim: 'fuse',
    prefix: 'F'
  },

  // ── diodes ────────────────────────────────────────────────────────────────
  'diode-1n4001-300mil': {
    label: 'Rectifier Diode (1N4001)',
    category: 'Diodes',
    sim: 'diode',
    prefix: 'D'
  },
  'diode-zener-0-5w-3-6v-300mil': {
    label: 'Zener Diode (3.6 V, 0.5 W)',
    category: 'Diodes',
    sim: 'zener diode',
    prefix: 'D'
  },
  'led-generic-3mm': { label: 'LED (3 mm)', category: 'Diodes', sim: 'led', prefix: 'LED' },
  'led-generic-5mm': { label: 'LED (5 mm)', category: 'Diodes', sim: 'led', prefix: 'LED' },

  // ── transistors ───────────────────────────────────────────────────────────
  'transistor-signal-npn-to92-ebc': {
    label: 'NPN Transistor (TO-92)',
    category: 'Transistors',
    sim: 'npn bipolar transistor',
    prefix: 'Q'
  },
  'transistor-signal-pnp-to92-ebc': {
    label: 'PNP Transistor (TO-92)',
    category: 'Transistors',
    sim: 'pnp bipolar transistor',
    prefix: 'Q'
  },
  'sparkfun-discretesemi-mosfet-nchannel-pth': {
    label: 'N-Channel MOSFET',
    category: 'Transistors',
    sim: 'n-channel mosfet',
    prefix: 'Q'
  },

  // ── switches & relays ─────────────────────────────────────────────────────
  pushbutton: {
    label: 'Pushbutton (Momentary)',
    category: 'Switches',
    sim: 'button',
    prefix: 'SW'
  },
  'switch-spst': {
    label: 'Slide Switch (SPST)',
    category: 'Switches',
    sim: 'switch',
    prefix: 'SW'
  },
  'reedswitch-500mil': {
    label: 'Reed Switch',
    category: 'Switches',
    sim: 'reed switch',
    prefix: 'SW'
  },
  // 4-pin coil + contact relay: not a 2-terminal switch, so keep it OUT of the
  // switch emitter's way (it would emit a bogus 1 mΩ resistor).
  'te-relay': { label: 'Relay (SPST, 5 V Coil)', category: 'Relays', sim: 'relay', prefix: 'K' },

  // ── sensors ───────────────────────────────────────────────────────────────
  'ldr-photocell-300mil-v5': {
    label: 'Photoresistor (LDR)',
    category: 'Sensors',
    sim: 'ldr photocell',
    prefix: 'R'
  },
  'thermistor-300mil': {
    label: 'Thermistor (10 kΩ NTC)',
    category: 'Sensors',
    sim: 'thermistor',
    prefix: 'R'
  },
  'ir-receiver-v14': { label: 'IR Receiver', category: 'Sensors', sim: 'ir receiver', prefix: 'U' },
  'sparkfun-sensors-mic-electret-smd': {
    label: 'Electret Microphone',
    category: 'Sensors',
    sim: 'microphone',
    prefix: 'MK'
  },
  'piezo-sensor': { label: 'Piezo Element', category: 'Audio', sim: 'piezo', prefix: 'LS' },

  // ── output devices ────────────────────────────────────────────────────────
  'buzzer-v15': { label: 'LilyPad Buzzer', category: 'Audio', sim: 'buzzer piezo', prefix: 'LS' },
  servo: { label: 'Servo Motor', category: 'Motors & Actuators', sim: 'servo', prefix: 'M' },
  '7segment-100-cat': {
    label: '7-Segment Display (Common Cathode)',
    category: 'Displays',
    sim: 'seven segment display',
    prefix: 'DS'
  },

  // ── power ─────────────────────────────────────────────────────────────────
  'battery-aa': {
    label: '2× AA Battery Pack (3 V)',
    category: 'Sources',
    sim: 'battery',
    prefix: 'BT'
  },
  'voltage-regulator-7805': {
    label: '5 V Linear Regulator (7805)',
    category: 'Power',
    sim: 'voltage regulator',
    prefix: 'U'
  },

  // ── built-in simulation parts (art generated in simParts/simProbes) ───────
  'sim-vdc': { label: 'DC Voltage Source', category: 'Sources', sim: 'sim-vdc', prefix: 'V' },
  'sim-vsin': { label: 'Sine Voltage Source', category: 'Sources', sim: 'sim-vsin', prefix: 'V' },
  'sim-idc': { label: 'DC Current Source', category: 'Sources', sim: 'sim-idc', prefix: 'I' },
  'sim-probe-v': {
    label: 'Voltage Probe',
    category: 'Probes & Meters',
    sim: 'sim-probe-v',
    prefix: 'P'
  },
  'sim-probe-vdiff': {
    label: 'Differential Voltage Probe',
    category: 'Probes & Meters',
    sim: 'sim-probe-vdiff',
    prefix: 'P'
  },
  'sim-probe-i': {
    label: 'Current Probe',
    category: 'Probes & Meters',
    sim: 'sim-probe-i',
    prefix: 'P'
  },

  // ── breadboards ───────────────────────────────────────────────────────────
  'breadboard-mini': {
    label: 'Breadboard (Mini)',
    category: 'Breadboards',
    sim: 'breadboard',
    prefix: 'BB'
  },
  'breadboard-half': {
    label: 'Breadboard (Half+)',
    category: 'Breadboards',
    sim: 'breadboard',
    prefix: 'BB'
  },
  'breadboard-full': {
    label: 'Breadboard (Full+)',
    category: 'Breadboards',
    sim: 'breadboard',
    prefix: 'BB'
  }
}

/**
 * Per-part starting values, applied when a part is placed.
 *
 * The SPICE emitter table only knows generic defaults ("a resistor is 220 Ω",
 * "a capacitor is 100 nF"), because it matches on keywords. A 2xAA pack is
 * 3 V, not the generic source's 5 V, and an electrolytic is microfarads, not
 * nanofarads. These land in the part's `attrs` on placement, so the value
 * printed on the schematic is the value that gets simulated; the sheet never
 * shows a number the netlist disagrees with.
 */
export const PART_DEFAULT_ATTRS: Record<string, Record<string, string>> = {
  'battery-aa': { voltage: '3' },
  'capacitor-electrolytic-medium': { capacitance: '10u' },
  'capacitor-ceramic-100mil': { capacitance: '100n' },
  'capacitor-ceramic-200mil': { capacitance: '100n' },
  'smd-inductor-0805': { inductance: '10u' },
  'ldr-photocell-300mil-v5': { resistance: '10k' },
  'thermistor-300mil': { resistance: '10k' },
  'potentiometer-rotary-16mm-5': { resistance: '10k', position: '0.5' },
  'potentiometer-trimmer-6mm-5': { resistance: '10k', position: '0.5' },
  resistor: { resistance: '220' }
}

/** Starting attrs for a freshly placed part, if it has opinions about them. */
export function defaultAttrsFor(type: string): Record<string, string> | undefined {
  const a = PART_DEFAULT_ATTRS[type]
  return a ? { ...a } : undefined
}

// ── fallback humanizer ───────────────────────────────────────────────────────

/** Tokens that are always fully uppercase when they stand alone as a word. */
const ACRONYMS = new Set([
  'ac',
  'adc',
  'aa',
  'aaa',
  'bjt',
  'dac',
  'dc',
  'dpdt',
  'dpst',
  'eeprom',
  'emf',
  'esp32',
  'fet',
  'gnd',
  'gpio',
  'gps',
  'i2c',
  'ic',
  'imu',
  'ir',
  'jfet',
  'lcd',
  'ldr',
  'led',
  'lipo',
  'mcu',
  'mems',
  'mic',
  'mosfet',
  'npn',
  'ntc',
  'oled',
  'pcb',
  'pnp',
  'ptc',
  'pth',
  'pwm',
  'rf',
  'rgb',
  'rtc',
  'sd',
  'smd',
  'spdt',
  'spi',
  'spst',
  'tft',
  'tht',
  'usb',
  'uart',
  'uv',
  'vcc',
  'vin'
])

/** Words that stay lowercase inside a name (never first or last). */
const MINOR = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with'
])

/** Package families that read better hyphenated + uppercase: TO92 → TO-92. */
const PACKAGE_RE = /^(to|sot|soic|tssop|qfn|dip|sod|smd)-?(\d+[a-z]?)$/i

/** A bare measurement token: 3mm, 300mil, 0805, 10k, 100n, 5v, 0.25w. */
const UNIT_RE = /^([\d.]+)(mm|cm|mil|in|k|m|meg|n|u|p|v|w|a|ma|f|nf|uf|pf|ohm|ω|hz|khz|mhz)$/i

const UNIT_CASE: Record<string, string> = {
  mm: 'mm',
  cm: 'cm',
  mil: 'mil',
  in: 'in',
  k: 'k',
  m: 'm',
  meg: 'M',
  n: 'n',
  u: 'µ',
  p: 'p',
  v: 'V',
  w: 'W',
  a: 'A',
  ma: 'mA',
  f: 'F',
  nf: 'nF',
  uf: 'µF',
  pf: 'pF',
  ohm: 'Ω',
  ω: 'Ω',
  hz: 'Hz',
  khz: 'kHz',
  mhz: 'MHz'
}

/** Brand-style camelCase that must survive intact: tinyCore, tinyGlow. */
const BRAND_CAMEL_RE = /^[a-z]+[A-Z][A-Za-z]*$/

/** Noise suffixes Fritzing bakes into part ids: rotation, revision, variant. */
const NOISE_RE = /(?:[_-](?:[xy]\d{1,3}|v\d+|rev\d*|\d+(?:st|nd|rd|th)))+$/i

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function humanizeWord(word: string, isEdge: boolean): string {
  const lower = word.toLowerCase()
  if (ACRONYMS.has(lower)) return lower.toUpperCase()
  if (!isEdge && MINOR.has(lower)) return lower
  const pkg = PACKAGE_RE.exec(word)
  if (pkg) return `${pkg[1].toUpperCase()}-${pkg[2].toUpperCase()}`
  const unit = UNIT_RE.exec(word)
  if (unit) return `${unit[1]} ${UNIT_CASE[unit[2].toLowerCase()] ?? unit[2]}`
  // already mixed-case and deliberate (tinyCore, LilyPad); leave it alone
  if (/[a-z][A-Z]/.test(word)) return word
  if (word === word.toUpperCase() && word.length > 3) return capitalize(lower)
  return capitalize(word)
}

/**
 * Turn a raw part id or Fritzing title into a readable name:
 *   "led"                       → "LED"
 *   "battery-aa_y90"            → "AA Battery"
 *   "MOSFET-NCHANNEL"           → "MOSFET Nchannel"
 *   "diode-zener-0-5w-300mil"   → "Diode Zener 0 5 W 300 mil"
 * Curated entries in PART_NAMING always win over this; it exists so a dropped
 * .fzpz never shows up in the rail as raw slug text.
 */
export function humanizeLabel(raw: string): string {
  const cleaned = String(raw ?? '').replace(NOISE_RE, '')
  const words: string[] = []
  for (const token of cleaned.split(/[_\-.\s]+/).filter(Boolean)) {
    // brand camelCase (tinyCore, tinyGlow) is deliberate; never split it
    if (BRAND_CAMEL_RE.test(token)) words.push(token)
    else
      words.push(
        ...token
          .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
          .split(' ')
          .filter(Boolean)
      )
  }
  if (!words.length) return 'Part'
  return words
    .map((w, i) => humanizeWord(w, i === 0 || i === words.length - 1))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Map a raw Fritzing family onto one of our display categories, using the
 * same keyword sniffing the netlist generator does. Unknown families are
 * humanized rather than dropped, so a pack can introduce its own category.
 */
export function humanizeCategory(raw: string | undefined): string {
  const f = String(raw ?? '').toLowerCase()
  if (!f.trim()) return 'Uncategorized'
  if (/breadboard/.test(f)) return 'Breadboards'
  if (/tinystudio|tinyboard/.test(f)) return 'tinyStudio Boards'
  if (/probe|meter|multimeter/.test(f)) return 'Probes & Meters'
  if (/battery|power supply|source|cell/.test(f)) return 'Sources'
  if (/resistor|capacitor|inductor|potentiometer|trimmer|fuse|crystal|ferrite|passive/.test(f))
    return 'Passive Elements'
  if (/\bled\b|diode|rectifier|zener|photodiode/.test(f)) return 'Diodes'
  if (/transistor|mosfet|jfet|igbt|\bfet\b|thyristor|triac/.test(f)) return 'Transistors'
  if (/relay|contactor|solenoid/.test(f)) return 'Relays'
  if (/switch|button|encoder/.test(f)) return 'Switches'
  if (/sensor|photo-?resistor|photocell|thermistor|accelerometer|gyro|\bir\b|proximity/.test(f))
    return 'Sensors'
  if (/display|lcd|oled|segment|matrix|screen/.test(f)) return 'Displays'
  if (/speaker|buzzer|piezo|audio|microphone|\bmic\b/.test(f)) return 'Audio'
  if (/motor|servo|stepper|actuator|fan|pump/.test(f)) return 'Motors & Actuators'
  if (/regulator|converter|charger|\bpower\b/.test(f)) return 'Power'
  if (/connector|header|jack|socket|terminal|\busb\b/.test(f)) return 'Connectors'
  if (/\bic\b|integrated|logic|op-?amp|amplifier|microcontroller|\bmcu\b|memory/.test(f))
    return 'Integrated Circuits'
  return humanizeLabel(raw ?? '')
}

export interface ResolvedNaming {
  label: string
  category: string
  /** Keyword string for netlist/refdes matching (never the display category). */
  sim: string
  prefix?: string
}

/**
 * Resolve the display name and category for a part. Curated entries win; then
 * an authored label from the part file; then the humanized type slug.
 *
 * `rawLabel`/`rawFamily` are whatever the part file carried (Fritzing title
 * and family); they stay the sim-matching keywords when there's no curated
 * entry, so importing a part never changes how it simulates.
 */
export function resolveNaming(type: string, rawLabel?: string, rawFamily?: string): ResolvedNaming {
  const curated = PART_NAMING[type]
  if (curated) {
    return {
      label: curated.label,
      category: curated.category,
      sim: curated.sim ?? `${curated.category} ${rawFamily ?? ''}`.trim(),
      prefix: curated.prefix
    }
  }
  const label = rawLabel && !isSluggy(rawLabel) ? tidyAuthored(rawLabel) : humanizeLabel(type)
  return {
    label,
    category: humanizeCategory(rawFamily),
    sim: `${rawFamily ?? ''}`.trim()
  }
}

/** An authored label that is really just the file name ("led", "battery-aa_y90"). */
function isSluggy(label: string): boolean {
  return /^[a-z0-9]+([_-][a-z0-9]+)*$/.test(label.trim())
}

/** Light touch-up for authored labels: fix ALL-CAPS shouting, keep the rest. */
function tidyAuthored(label: string): string {
  const t = label.trim().replace(/\s+/g, ' ')
  if (t === t.toUpperCase() && /[A-Z]{3,}/.test(t)) return humanizeLabel(t)
  return t
}
