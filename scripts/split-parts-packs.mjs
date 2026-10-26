#!/usr/bin/env node
/**
 * split-parts-packs.mjs — turn one giant parts pack into many small ones,
 * shaped the way Fritzing shapes its parts bins.
 *
 * Why
 * ---
 * A single 1776-part pack is a bad download and a worse palette: installing it
 * gives you one enormous tab holding everything from a 220Ω resistor to a
 * SparkFun XBee breakout. Fritzing solves this with bins — Core (split into
 * Basic / Input / Output / ICs / Power / …), a per-vendor bin for Arduino,
 * LilyPad, Seeed and friends, and thirteen SparkFun sub-bins. This script
 * reproduces that taxonomy so each bin ships as its own installable pack, and
 * the app can render one tab per installed pack.
 *
 * How a part is classified (first rule that matches wins)
 * -------------------------------------------------------
 *  1. Fritzing bin membership — parsed straight out of `fritzing-parts/bins/`
 *     (`--bins`). A part listed in `arduino.fzb` goes to the arduino pack, no
 *     guessing. This is the highest-confidence signal but only covers the
 *     ~280 parts Fritzing bothered to curate into bins.
 *  2. SparkFun filename convention — `sparkfun-<subbin>-*.fzp` maps directly
 *     onto SparkFun's own sub-bins. This alone files ~900 parts.
 *  3. Vendor prefixes — filename or family starting with a known vendor.
 *  4. Core-section keywords — matched against family + label + filename.
 *  5. Anything left lands in core-misc.
 *
 * Output
 * ------
 *   <out>/index.json                    every non-empty pack, with group + icon
 *   <out>/packs/<id>/pack.json          that pack's manifest
 *   <out>/packs/<id>/parts/<type>.json  the part defs themselves
 *   <out>/packs/<id>/ATTRIBUTION.md     Fritzing CC-BY-SA notice
 *   <migration>                         { <packId>: [type, …] } so the app can
 *                                       re-file parts installed from the old
 *                                       monolithic pack without a re-download
 *
 * Usage
 * -----
 *   node scripts/split-parts-packs.mjs \
 *     --src  ../tinyparts/packs/tinystudio-core/parts \
 *     --out  ../tinyparts \
 *     --bins ../fritzing-parts/bins \
 *     --migration src/renderer/src/assets/packMigration.json
 *
 *   --dry   classify and print the histogram, write nothing
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packIcons } from './lib/bin-icons.mjs'
import { BIN_TO_PACK } from './lib/bin-map.mjs'
import { disambiguateLabels, foldVariants } from './lib/fold-variants.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, '..')

// ── pack catalogue ──────────────────────────────────────────────────────────
// `icon` is a 2-letter monogram; the palette's vertical tab rail renders it
// when a pack ships no artwork. `group` drives the Pack Manager's headings.

const CORE = 'Core'
const SPARKFUN = 'SparkFun'
const VENDORS = 'Vendors'

/** id → { name, group, icon, description } */
const PACKS = {
  'core-basic': {
    name: 'Core · Basic',
    group: CORE,
    icon: 'BA',
    description: 'Resistors, capacitors, inductors, diodes, transistors, crystals'
  },
  'core-input': {
    name: 'Core · Input',
    group: CORE,
    icon: 'IN',
    description: 'Buttons, switches, potentiometers, sensors, encoders'
  },
  'core-output': {
    name: 'Core · Output',
    group: CORE,
    icon: 'OU',
    description: 'LEDs, displays, motors, servos, buzzers, relays'
  },
  'core-ics': {
    name: 'Core · ICs',
    group: CORE,
    icon: 'IC',
    description: 'Logic, memory, op-amps, drivers, converters, 74xx / 4000 series'
  },
  'core-power': {
    name: 'Core · Power',
    group: CORE,
    icon: 'PW',
    description: 'Regulators, batteries, supplies, sources, fuses'
  },
  'core-microcontroller': {
    name: 'Core · Microcontroller',
    group: CORE,
    icon: 'MC',
    description: 'Microcontrollers and generic development boards'
  },
  'core-connection': {
    name: 'Core · Connection',
    group: CORE,
    icon: 'CN',
    description: 'Headers, connectors, jumpers, sockets, terminals, cables'
  },
  'core-communication': {
    name: 'Core · Communication',
    group: CORE,
    icon: 'CM',
    description: 'WiFi, Bluetooth, radio, GSM, ethernet and other comms modules'
  },
  'core-tools': {
    name: 'Core · Tools & Boards',
    group: CORE,
    icon: 'TL',
    description: 'Breadboards, perfboard, PCBs, multimeters, measuring tools'
  },
  'core-misc': {
    name: 'Core · Misc',
    group: CORE,
    icon: 'MI',
    description: 'Everything else from the Fritzing core library'
  },

  'sparkfun-analogic': { name: 'SparkFun · AnalogIC', group: SPARKFUN, icon: 'SA' },
  'sparkfun-boards': { name: 'SparkFun · Boards', group: SPARKFUN, icon: 'SB' },
  'sparkfun-connectors': { name: 'SparkFun · Connectors', group: SPARKFUN, icon: 'SC' },
  'sparkfun-digitalic': { name: 'SparkFun · DigitalIC', group: SPARKFUN, icon: 'SD' },
  'sparkfun-discretesemi': { name: 'SparkFun · DiscreteSemi', group: SPARKFUN, icon: 'SS' },
  'sparkfun-displays': { name: 'SparkFun · Displays', group: SPARKFUN, icon: 'SY' },
  'sparkfun-electromechanical': {
    name: 'SparkFun · Electromechanical',
    group: SPARKFUN,
    icon: 'SE'
  },
  'sparkfun-freqctrl': { name: 'SparkFun · Frequency Control', group: SPARKFUN, icon: 'SQ' },
  'sparkfun-led': { name: 'SparkFun · LEDs', group: SPARKFUN, icon: 'SL' },
  'sparkfun-passives': { name: 'SparkFun · Passives', group: SPARKFUN, icon: 'SV' },
  'sparkfun-poweric': { name: 'SparkFun · PowerIC', group: SPARKFUN, icon: 'SP' },
  'sparkfun-rf': { name: 'SparkFun · RF', group: SPARKFUN, icon: 'SR' },
  'sparkfun-sensors': { name: 'SparkFun · Sensors', group: SPARKFUN, icon: 'SN' },
  'sparkfun-etc': { name: 'SparkFun · Etc.', group: SPARKFUN, icon: 'SX' },

  arduino: { name: 'Arduino', group: VENDORS, icon: 'AR' },
  lilypad: { name: 'LilyPad', group: VENDORS, icon: 'LP' },
  picaxe: { name: 'PICAXE', group: VENDORS, icon: 'PX' },
  parallax: { name: 'Parallax', group: VENDORS, icon: 'PL' },
  seeed: { name: 'Seeed Studio', group: VENDORS, icon: 'SG' },
  wemos: { name: 'WeMos', group: VENDORS, icon: 'WM' },
  'analog-devices': { name: 'Analog Devices', group: VENDORS, icon: 'AD' },
  'atlas-scientific': { name: 'Atlas Scientific', group: VENDORS, icon: 'AS' },
  infineon: { name: 'Infineon', group: VENDORS, icon: 'IF' },
  intel: { name: 'Intel', group: VENDORS, icon: 'IT' },
  spresense: { name: 'Spresense', group: VENDORS, icon: 'SZ' },
  dagu: { name: 'Dagu', group: VENDORS, icon: 'DG' },
  frc: { name: 'FRC', group: VENDORS, icon: 'FR' },
  'raspberry-pi': { name: 'Raspberry Pi', group: VENDORS, icon: 'RP' },
  chipkit: { name: 'chipKIT', group: VENDORS, icon: 'CK' },
  calliope: { name: 'Calliope', group: VENDORS, icon: 'CL' },
  esp: { name: 'ESP8266 / ESP32', group: VENDORS, icon: 'EP' },
  adafruit: { name: 'Adafruit', group: VENDORS, icon: 'AF' },
  'voltage-regulators': { name: 'Voltage Regulators', group: VENDORS, icon: 'VR' },
  simulator: { name: 'Simulator Parts', group: VENDORS, icon: 'SM' }
}

/** SparkFun's own sub-bins, as they appear in its filenames. */
const SF_SUBBINS = new Set([
  'analogic',
  'boards',
  'connectors',
  'digitalic',
  'discretesemi',
  'displays',
  'electromechanical',
  'freqctrl',
  'led',
  'passives',
  'poweric',
  'rf',
  'sensors'
])

/** [filename-or-family prefix, pack id] — checked in order. */
const VENDOR_PREFIXES = [
  ['adafruit', 'adafruit'],
  ['arduino', 'arduino'],
  ['lilypad', 'lilypad'],
  ['picaxe', 'picaxe'],
  ['parallax', 'parallax'],
  ['basic stamp', 'parallax'],
  ['seeed', 'seeed'],
  ['seeeduino', 'seeed'],
  ['grove', 'seeed'],
  ['wemos', 'wemos'],
  ['adi', 'analog-devices'],
  ['atlas', 'atlas-scientific'],
  ['infineon', 'infineon'],
  ['intel', 'intel'],
  ['spresense', 'spresense'],
  ['dagu', 'dagu'],
  ['frc', 'frc'],
  ['roborio', 'frc'],
  ['talonsrx', 'frc'],
  ['raspberry', 'raspberry-pi'],
  ['chipkit', 'chipkit'],
  ['calliope', 'calliope'],
  ['esp8266', 'esp'],
  ['esp32', 'esp'],
  ['espruino', 'esp']
]

/** [regex over "filename family label", pack id] — checked in order, so put
 * the specific ahead of the general (a "LED matrix display" must not be eaten
 * by the ICs rule just because "display driver" mentions driver). */
const CORE_RULES = [
  [
    /breadboard|perfboard|stripboard|protoboard|prototyping|experimenter|vanilla pcb|\bpcb\b|carrier card|donut|fritzing logo|multimeter|panel meter|logic analyz|oscilloscope|\bruler\b|\bnote\b|measuring/,
    'core-tools'
  ],
  [
    /wireless|\bwifi\b|wi-fi|bluetooth|\bble\b|zigbee|\blora\b|\bgsm\b|\bgps\b|\bradio\b|\bfm\b|nrf\d|rfm\d|esp-?\d|ethernet|networkmodule|network module|\bxbee\b|\brf\b|transceiver|tranceiver/,
    'core-communication'
  ],
  [
    /\bled\b|\bleds\b|display|lcd|oled|\btft\b|e-?paper|e-?ink|matrix|segment|buzzer|speaker|piezo|audio play|\bmp3\b|\bmotor\b|servo|\brelay\b|solenoid|vibrat|\blamp\b|neopixel|printer|stepper|\bfan\b/,
    'core-output'
  ],
  [
    /switch|button|\bkey\b|keypad|joystick|trackball|encoder|sensor|\bimu\b|potentiometer|trimmer|rheostat|photo|\breed\b|tilt|touch|accelerom|gyro|magnetom|humid|thermistor|temperature|pressure|proximity|\bhall\b|microphone|\bmic\b|\brtc\b|real time clock|\brfid\b|infrared|\bir\b/,
    'core-input'
  ],
  [
    /microcontroller|\bmcu\b|\bcpu\b|dev board|development board|single board|cpu board|\bfpga\b|\bsoc\b|\bshield\b|arduino|processor|computer|beagle|nucleo|teensy|\bmbed\b|duino\b/,
    'core-microcontroller'
  ],
  [
    /74xx|74hc|74ls|4000 series|40\d\d |generic ic|logic|gate|inverter|schmitt|level shifter|eeprom|memory|\bflash\b|\bsram\b|micro-?sd|\bsd card\b|data logger|op-?amp|amplifier|shift register|counter|multiplex|\bmux\b|\badc\b|\bdac\b|a2d|driver|\btimer\b|comparator|optocoup|transistor array|\buart\b|serial interface|\bfpu\b|\bic\b/,
    'core-ics'
  ],
  [
    /regulator|batter|power supply|power condition|voltage source|current source|\bsolar\b|charger|\bfuse\b|step-?up|step-?down|dc-?dc|dc\/dc|converter|transformer|transformator|\bground\b|peltier/,
    'core-power'
  ],
  [
    /header|connector|jumper|socket|terminal|\bplug\b|\bjack\b|\busb\b|\bdb\d|screw|\bwire\b|\bpin\b|cable|df13|picoblade|\brj\d|\bxlr\b|\brca\b|scart|antenna|\bftdi\b/,
    'core-connection'
  ],
  [
    /resistor|capacitor|inductor|diode|transistor|\bfet\b|mosfet|crystal|resonator|varistor|\bzener\b|schottky|semiconductor|passive/,
    'core-basic'
  ]
]

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    const next = () => argv[++i]
    if (t === '--src') a.src = next()
    else if (t === '--out') a.out = next()
    else if (t === '--bins') a.bins = next()
    else if (t === '--migration') a.migration = next()
    else if (t === '--version') a.version = next()
    else if (t === '--show') a.show = next()
    else if (t === '--dry') a.dry = true
    else if (t === '--help' || t === '-h') a.help = true
    else console.warn(`Unknown arg: ${t}`)
  }
  return a
}

const args = parseArgs(process.argv.slice(2))
if (args.help || !args.src) {
  console.log(
    `Usage: node scripts/split-parts-packs.mjs --src <parts dir> [--out <repo>]\n` +
      `         [--bins <fritzing-parts/bins>] [--migration <file.json>]\n` +
      `         [--version 1.0.0] [--dry]`
  )
  process.exit(args.help ? 0 : 1)
}

const srcDir = resolve(process.cwd(), args.src)
const outDir = args.out ? resolve(process.cwd(), args.out) : null
const version = args.version || '1.0.0'

// ── read the source parts ───────────────────────────────────────────────────

const parts = []
for (const fn of readdirSync(srcDir)) {
  if (!fn.endsWith('.json')) continue
  const def = JSON.parse(readFileSync(join(srcDir, fn), 'utf8'))
  if (!def?.type || !def?.views) continue
  parts.push({ fn, def })
}
if (!parts.length) {
  console.error(`No part JSON files in ${srcDir}`)
  process.exit(1)
}

// ── bin membership (highest-confidence signal) ──────────────────────────────

/** moduleId → packId, fzpBasename → packId */
const binByModule = new Map()
const binByFzp = new Map()
if (args.bins) {
  const binRoot = resolve(process.cwd(), args.bins)
  const files = []
  for (const dir of [binRoot, join(binRoot, 'more')]) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) if (f.endsWith('.fzb')) files.push(join(dir, f))
  }
  const instRe = /<instance\s+moduleIdRef="([^"]*)"[^>]*path="([^"]*)"/g
  for (const f of files) {
    const pack = BIN_TO_PACK[basename(f)]
    if (!pack) continue
    const xml = readFileSync(f, 'utf8')
    for (const m of xml.matchAll(instRe)) {
      const [, moduleId, path] = m
      if (moduleId === '__spacer__') continue
      if (moduleId && !binByModule.has(moduleId)) binByModule.set(moduleId, pack)
      const base = basename(path).toLowerCase()
      if (base && !binByFzp.has(base)) binByFzp.set(base, pack)
    }
  }
  console.log(
    `bins: ${files.length} files → ${binByModule.size} moduleIds, ${binByFzp.size} filenames`
  )

  // Fritzing already drew a mark for most of these bins — use it for the
  // palette's tab rail instead of a two-letter monogram. Bins with no usable
  // artwork keep the monogram declared in PACKS above.
  const icons = packIcons(binRoot, BIN_TO_PACK)
  let iconed = 0
  for (const [id, icon] of Object.entries(icons)) {
    if (!PACKS[id]) continue
    PACKS[id].icon = icon
    iconed++
  }
  console.log(`bins: ${iconed} pack tab icons taken from fritzing-parts`)
}

// ── classifier ──────────────────────────────────────────────────────────────

function classify(def) {
  const src = def.source || {}
  const fzp = String(src.fzp || '').toLowerCase()
  const fzpBase = fzp.replace(/\.fzp$/, '')
  const family = String(def.family || '').toLowerCase()
  const label = String(def.label || '').toLowerCase()
  const tags = (def.tags || []).join(' ').toLowerCase()

  // 1. explicit Fritzing bin membership
  const fromBin = binByModule.get(src.moduleId) || binByFzp.get(fzp)
  if (fromBin) return fromBin

  // 2. SparkFun's own sub-bin, straight off the filename
  if (fzpBase.startsWith('sparkfun')) {
    const sub = fzpBase.split('-')[1] || ''
    return SF_SUBBINS.has(sub) ? `sparkfun-${sub}` : 'sparkfun-etc'
  }

  // 3. vendor prefixes
  for (const [prefix, pack] of VENDOR_PREFIXES) {
    if (fzpBase.startsWith(prefix) || family.startsWith(prefix)) return pack
  }

  // 4. core sections by keyword
  const hay = ` ${fzpBase} ${family} ${label} ${tags} `
  for (const [rx, pack] of CORE_RULES) if (rx.test(hay)) return pack

  // 5. give up gracefully
  return 'core-misc'
}

// ── classify ─────────────────────────────────────────────────────────────────
// Every part is filed on its own merits. Variant grouping happens after this
// and only ever inside one pack, so a primary and its variants can't end up
// split across two bins.

const packOfType = new Map()
for (const { def } of parts) packOfType.set(def.type, classify(def))

const byPack = new Map()
for (const p of parts) {
  const id = packOfType.get(p.def.type)
  if (!PACKS[id]) throw new Error(`classifier produced unknown pack id "${id}"`)
  if (!byPack.has(id)) byPack.set(id, [])
  byPack.get(id).push(p)
}

// ── variant merging + label disambiguation ─────────────────────────────
// One tile per (pack, family, base title) — see lib/fold-variants.mjs for why
// the old render-fingerprint rule left sixteen identical "Inductors" squares in
// the SparkFun Passives bin, and what guards the new one against folding parts
// that only look alike.

const foldable = []
for (const [packId, list] of byPack) for (const { def } of list) foldable.push({ packId, def })

const inBin = (def) => {
  const src = def.source || {}
  return binByModule.has(src.moduleId) || binByFzp.has(String(src.fzp || '').toLowerCase())
}
const fold = foldVariants(foldable, { inBin })
const relabelled = disambiguateLabels(foldable)

console.log(
  `${fold.tiles} tiles from ${parts.length} files ` +
    `(${fold.variants} package variants folded into ${fold.groups} primaries, ` +
    `${relabelled} titles disambiguated)`
)

// ── ordering ────────────────────────────────────────────────────────────────
// The palette renders a bin as one flat grid, so the manifest order is the
// only thing keeping related parts adjacent. Fritzing's curated .fzb order
// comes first (that's the sequence people know from the Core bin); everything
// else sorts by family then label so like still sits with like.

const curatedOrder = new Map()
if (args.bins) {
  const binRoot = resolve(process.cwd(), args.bins)
  const files = []
  for (const dir of [binRoot, join(binRoot, 'more')]) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) if (f.endsWith('.fzb')) files.push(join(dir, f))
  }
  // core.fzb first so its ordering wins for anything listed twice
  files.sort((a, b) => (basename(a) === 'core.fzb' ? -1 : basename(b) === 'core.fzb' ? 1 : 0))
  const instRe = /<instance\s+moduleIdRef="([^"]*)"[^>]*path="([^"]*)"/g
  let n = 0
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(instRe)) {
      const [, moduleId, path] = m
      if (moduleId === '__spacer__') continue
      for (const key of [moduleId, basename(path).toLowerCase()]) {
        if (key && !curatedOrder.has(key)) curatedOrder.set(key, n)
      }
      n++
    }
  }
}

/** Curated rank, or null when Fritzing never binned this part. */
function curatedRank(def) {
  const src = def.source || {}
  const a = curatedOrder.get(src.moduleId)
  const b = curatedOrder.get(String(src.fzp || '').toLowerCase())
  const best = [a, b].filter((x) => x != null)
  return best.length ? Math.min(...best) : null
}

// Assign `order` now rather than at write time — the migration map needs it
// too, and that's emitted even on a --dry / migration-only run.
const orderedByPack = new Map()
for (const [id, list] of byPack) {
  const sorted = [...list].sort((a, b) => {
    const ra = curatedRank(a.def)
    const rb = curatedRank(b.def)
    if (ra != null && rb != null && ra !== rb) return ra - rb
    if (ra != null && rb == null) return -1
    if (ra == null && rb != null) return 1
    return (
      (a.def.family || '').localeCompare(b.def.family || '') ||
      (a.def.label || '').localeCompare(b.def.label || '') ||
      a.def.type.localeCompare(b.def.type)
    )
  })
  sorted.forEach(({ def }, i) => {
    def.order = i
  })
  orderedByPack.set(id, sorted)
}

const ordered = [...byPack.entries()].sort(
  (a, b) => Object.keys(PACKS).indexOf(a[0]) - Object.keys(PACKS).indexOf(b[0])
)

console.log(`\n${parts.length} parts → ${ordered.length} packs\n`)
for (const [id, list] of [...ordered].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(list.length).padStart(5)}  ${id.padEnd(28)} ${PACKS[id].group}`)
}

// `--show <packId>` lists what landed in a pack — handy when tuning the rules
if (args.show) {
  const list = byPack.get(args.show) || []
  console.log(`\n${args.show} (${list.length}):`)
  for (const { def } of list)
    console.log(
      `   ${(def.label || '').slice(0, 42).padEnd(44)} ${(def.family || '').slice(0, 28)}`
    )
}

if (args.dry) {
  console.log('\n--dry: nothing written')
  process.exit(0)
}

// ── write ───────────────────────────────────────────────────────────────────

const ATTRIBUTION = `# Attribution

Parts in this pack are derived from the Fritzing parts library
(https://github.com/fritzing/fritzing-parts), licensed
**CC-BY-SA 3.0** (https://creativecommons.org/licenses/by-sa/3.0/).

Breadboard and schematic artwork and pin metadata were converted to
tinyStudio's PartDef format by \`scripts/fritzing-import.mjs\` and split into
bins by \`scripts/split-parts-packs.mjs\`. The converted files remain under
CC-BY-SA 3.0; attribution is to the Fritzing project and its contributors.
`

if (outDir) {
  const packsRoot = join(outDir, 'packs')
  mkdirSync(packsRoot, { recursive: true })

  // Clear out packs we're about to regenerate (and the old monolith), leaving
  // anything hand-maintained alone. Deletion is best-effort: some checkouts
  // live on filesystems that refuse unlink (sandboxed mounts, read-only CI),
  // and a stale directory is far less bad than a failed regeneration.
  const stale = []
  for (const existing of existsSync(packsRoot) ? readdirSync(packsRoot) : []) {
    if (!PACKS[existing] && existing !== 'tinystudio-core') continue
    try {
      rmSync(join(packsRoot, existing), { recursive: true, force: true })
    } catch {
      stale.push(existing)
    }
  }
  if (stale.length)
    console.warn(`! could not remove old pack dir(s): ${stale.join(', ')} — delete by hand`)

  const indexPacks = []
  for (const [id, list] of ordered) {
    const meta = PACKS[id]
    const dir = join(packsRoot, id)
    mkdirSync(join(dir, 'parts'), { recursive: true })

    // one flat, deliberately-ordered grid — `order` was assigned above and is
    // what the palette actually sorts on
    const packParts = orderedByPack.get(id)
    const refs = []
    for (const { def } of packParts) {
      writeFileSync(join(dir, 'parts', `${def.type}.json`), JSON.stringify(def, null, 2))
      refs.push({ type: def.type, file: `parts/${def.type}.json` })
    }

    writeFileSync(
      join(dir, 'pack.json'),
      JSON.stringify(
        {
          schema: 1,
          id,
          name: meta.name,
          version,
          group: meta.group,
          icon: meta.icon,
          description: meta.description || `${meta.name} parts from the Fritzing library`,
          parts: refs
        },
        null,
        2
      )
    )
    writeFileSync(join(dir, 'ATTRIBUTION.md'), ATTRIBUTION)

    indexPacks.push({
      id,
      name: meta.name,
      version,
      group: meta.group,
      icon: meta.icon,
      // tiles the palette will actually show — variants hide behind a primary
      count: packParts.filter(({ def }) => !def.variantOf).length,
      files: refs.length,
      description: meta.description || `${meta.name} parts from the Fritzing library`,
      url: `packs/${id}/pack.json`
    })
  }

  // group order first, then the catalogue order inside each group
  const groupOrder = [CORE, SPARKFUN, VENDORS]
  indexPacks.sort(
    (a, b) =>
      groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) ||
      Object.keys(PACKS).indexOf(a.id) - Object.keys(PACKS).indexOf(b.id)
  )

  writeFileSync(
    join(outDir, 'index.json'),
    JSON.stringify({ schema: 1, groups: groupOrder, packs: indexPacks }, null, 2)
  )
  console.log(`\nwrote ${indexPacks.length} packs + index.json → ${outDir}`)
}

// migration map: lets the app re-file parts installed from the old monolithic
// pack into their new bins without downloading anything again
if (args.migration) {
  const target = resolve(process.cwd(), args.migration)
  mkdirSync(dirname(target), { recursive: true })
  // Carry the presentation fields too, not just the pack id. A user upgrading
  // from the monolith has part defs on disk that predate variant merging and
  // label disambiguation — restamping only `pack` would leave them staring at
  // five tiles called "220 Ω Resistor" inside the new Core · Basic tab.
  const map = {}
  for (const [id, list] of ordered) {
    map[id] = [...list]
      .sort((a, b) => a.def.type.localeCompare(b.def.type))
      .map(({ def }) => ({
        type: def.type,
        label: def.label,
        order: def.order,
        ...(def.variantOf ? { variantOf: def.variantOf } : {}),
        ...(def.variants ? { variants: def.variants } : {})
      }))
  }
  writeFileSync(
    target,
    JSON.stringify({ schema: 2, version, legacyPackIds: ['tinystudio-core'], packs: map }, null, 2)
  )
  console.log(`wrote migration map → ${target}`)
}

void REPO
