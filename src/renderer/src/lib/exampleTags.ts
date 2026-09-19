/**
 * exampleTags: the tag vocabulary for the Examples library.
 *
 * One place defines what a tag *is*, what it's called, and what colour it
 * wears, so the Examples tab, the filter bar and the manifest generator
 * (scripts/gen-example-tags.mjs) can never drift apart.
 *
 * Two kinds of tag, and the difference is the whole design:
 *
 *   'board':  a piece of hardware the example runs on or plugs into. These
 *             are colour-coded to the real solder-mask of the board, so the
 *             chip on the card matches the PCB on the bench: tinySniff is
 *             yellow because tinySniff *is* yellow. The colours come from
 *             the same masks partsLibrary.ts paints the Circuit view with.
 *
 *   'topic':  what the example teaches (i2c, pwm, wifi…). Deliberately
 *             neutral grey. Colour means "hardware" here; if topics were
 *             coloured too, the board colours would stop carrying meaning.
 *
 * Unknown tags are not an error. A tag that appears in the manifest but not
 * in this file still renders (as a neutral topic chip) and still filters,
 * so the examples repo can add vocabulary without shipping an app update.
 */

import type { CSSProperties } from 'react'

/** 'board' chips are colour-coded to their solder-mask; 'topic' chips are neutral. */
export type TagKind = 'board' | 'topic'

/** Facets group the filter bar. Board tags lead; topics follow in this order. */
export type TagFacet = 'board' | 'protocol' | 'peripheral' | 'concept'

export interface TagMeta {
  /** Canonical lowercase slug: what lives in the manifest and the filter state. */
  slug: string
  /** Display text on the chip. */
  label: string
  kind: TagKind
  facet: TagFacet
  /**
   * Board tags only: the `--board-<key>-*` CSS custom-property family that
   * paints the chip (defined in assets/base.css, theme-aware).
   */
  colorKey?: string
  /** Extra spellings that normalise onto this tag (matching is slug-folded). */
  aliases?: string[]
}

// ── boards & expansions ──────────────────────────────────────────────────────
// Order mirrors BUILTIN_PARTS in lib/partsLibrary so the filter bar reads in
// the same order as the Circuit view's parts rail.
const BOARD_TAGS: TagMeta[] = [
  {
    slug: 'tinycore',
    label: 'tinyCore',
    kind: 'board',
    facet: 'board',
    colorKey: 'tinycore',
    aliases: ['core', 'esp32', 'esp32-s3', 'esp32s3', 'tinycore-esp32-s3']
  },
  {
    slug: 'tinyglow',
    label: 'tinyGlow',
    kind: 'board',
    facet: 'board',
    colorKey: 'tinyglow',
    aliases: ['glow']
  },
  {
    slug: 'tinyproto',
    label: 'tinyProto',
    kind: 'board',
    facet: 'board',
    colorKey: 'tinyproto',
    aliases: ['proto', 'protoboard']
  },
  {
    slug: 'tinysniff',
    label: 'tinySniff',
    kind: 'board',
    facet: 'board',
    colorKey: 'tinysniff',
    aliases: ['sniff', 'gas-sensor', 'tinysniff-hat']
  },
  {
    slug: 'tinyspeak',
    label: 'tinySpeak',
    kind: 'board',
    facet: 'board',
    colorKey: 'tinyspeak',
    aliases: ['speak', 'microphone', 'speaker', 'tinyspeak-hat']
  },
  {
    slug: 'tinydisplay',
    label: 'tinyDisplay',
    kind: 'board',
    facet: 'board',
    colorKey: 'tinydisplay',
    aliases: ['display-board', 'round-lcd']
  },
  // Not a tinyBoard, but it is hardware you plug in, so it earns a colour of
  // its own rather than hiding among the topic chips.
  {
    slug: 'qwiic',
    label: 'Qwiic',
    kind: 'board',
    facet: 'board',
    colorKey: 'qwiic',
    aliases: ['qwiic-joystick', 'stemma', 'stemma-qt']
  }
]

// ── topics ───────────────────────────────────────────────────────────────────
const TOPIC_TAGS: TagMeta[] = [
  // protocols & connectivity
  { slug: 'wifi', label: 'WiFi', facet: 'protocol', kind: 'topic', aliases: ['wi-fi', 'wlan'] },
  { slug: 'bluetooth', label: 'Bluetooth', facet: 'protocol', kind: 'topic', aliases: ['ble'] },
  { slug: 'i2c', label: 'I2C', facet: 'protocol', kind: 'topic', aliases: ['wire', 'twi'] },
  { slug: 'spi', label: 'SPI', facet: 'protocol', kind: 'topic' },
  { slug: 'serial', label: 'Serial', facet: 'protocol', kind: 'topic', aliases: ['uart'] },
  { slug: 'esp-now', label: 'ESP-NOW', facet: 'protocol', kind: 'topic', aliases: ['espnow'] },
  { slug: 'mqtt', label: 'MQTT', facet: 'protocol', kind: 'topic' },
  {
    slug: 'websocket',
    label: 'WebSocket',
    facet: 'protocol',
    kind: 'topic',
    aliases: ['websockets']
  },
  {
    slug: 'web-server',
    label: 'Web server',
    facet: 'protocol',
    kind: 'topic',
    aliases: ['webserver', 'http']
  },
  {
    slug: 'ota',
    label: 'OTA updates',
    facet: 'protocol',
    kind: 'topic',
    aliases: ['over-the-air']
  },

  // peripherals & parts
  { slug: 'led', label: 'LED', facet: 'peripheral', kind: 'topic', aliases: ['leds'] },
  {
    slug: 'rgb-led',
    label: 'RGB LED',
    facet: 'peripheral',
    kind: 'topic',
    aliases: ['neopixel', 'ws2812']
  },
  {
    slug: 'button',
    label: 'Button',
    facet: 'peripheral',
    kind: 'topic',
    aliases: ['buttons', 'switch']
  },
  {
    slug: 'buzzer',
    label: 'Buzzer',
    facet: 'peripheral',
    kind: 'topic',
    aliases: ['piezo', 'tone']
  },
  {
    slug: 'oled',
    label: 'OLED',
    facet: 'peripheral',
    kind: 'topic',
    aliases: ['ssd1306', 'screen']
  },
  {
    slug: 'imu',
    label: 'IMU',
    facet: 'peripheral',
    kind: 'topic',
    aliases: ['accelerometer', 'gyroscope', 'lsm6dsox']
  },
  {
    slug: 'sd-card',
    label: 'SD card',
    facet: 'peripheral',
    kind: 'topic',
    aliases: ['sdcard', 'sd']
  },
  {
    slug: 'potentiometer',
    label: 'Potentiometer',
    facet: 'peripheral',
    kind: 'topic',
    aliases: ['pot']
  },
  {
    slug: 'light-sensor',
    label: 'Light sensor',
    facet: 'peripheral',
    kind: 'topic',
    aliases: ['photoresistor', 'ldr']
  },
  { slug: 'joystick', label: 'Joystick', facet: 'peripheral', kind: 'topic' },
  {
    slug: 'distance-sensor',
    label: 'Distance sensor',
    facet: 'peripheral',
    kind: 'topic',
    aliases: ['ir-distance', 'proximity', 'ultrasonic']
  },
  { slug: 'dac', label: 'DAC', facet: 'peripheral', kind: 'topic', aliases: ['mcp4725'] },

  // concepts & techniques
  { slug: 'blink', label: 'Blink', facet: 'concept', kind: 'topic' },
  { slug: 'pwm', label: 'PWM', facet: 'concept', kind: 'topic', aliases: ['analogwrite', 'fade'] },
  {
    slug: 'adc',
    label: 'ADC',
    facet: 'concept',
    kind: 'topic',
    aliases: ['analogread', 'analog-input']
  },
  {
    slug: 'digital-io',
    label: 'Digital I/O',
    facet: 'concept',
    kind: 'topic',
    aliases: ['gpio', 'digitalwrite', 'digitalread']
  },
  {
    slug: 'plotter',
    label: 'Plotter',
    facet: 'concept',
    kind: 'topic',
    aliases: ['serial-plotter', 'graphing', 'charting']
  },
  {
    slug: 'file-io',
    label: 'File I/O',
    facet: 'concept',
    kind: 'topic',
    aliases: ['filesystem', 'logging', 'csv']
  },
  {
    slug: 'timing',
    label: 'Timing',
    facet: 'concept',
    kind: 'topic',
    aliases: ['millis', 'delay', 'non-blocking']
  },
  {
    slug: 'interrupts',
    label: 'Interrupts',
    facet: 'concept',
    kind: 'topic',
    aliases: ['isr', 'debounce']
  },
  {
    slug: 'visual',
    label: 'Visual view',
    facet: 'concept',
    kind: 'topic',
    aliases: ['p5', 'p5js', 'sketch']
  },
  {
    slug: 'beginner',
    label: 'Beginner',
    facet: 'concept',
    kind: 'topic',
    aliases: ['basics', 'getting-started']
  },
  { slug: 'advanced', label: 'Advanced', facet: 'concept', kind: 'topic' }
]

export const ALL_TAGS: TagMeta[] = [...BOARD_TAGS, ...TOPIC_TAGS]

/** Filter-bar section order and headings. */
export const FACET_ORDER: TagFacet[] = ['board', 'protocol', 'peripheral', 'concept']
export const FACET_LABEL: Record<TagFacet, string> = {
  board: 'Boards & expansions',
  protocol: 'Connectivity',
  peripheral: 'Parts & sensors',
  concept: 'Concepts'
}

// slug -> meta, plus every alias folded in, built once.
const BY_SLUG = new Map<string, TagMeta>()
for (const t of ALL_TAGS) {
  BY_SLUG.set(t.slug, t)
  for (const a of t.aliases ?? []) BY_SLUG.set(a, t)
}

/** Fold arbitrary text into a slug: "Qwiic Joystick" -> "qwiic-joystick". */
export function slugifyTag(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[²₂]/g, '2') // I²C -> i2c
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Is this a tag the app actually knows, rather than a synthesised one? */
export function isKnownTag(raw: string): boolean {
  return BY_SLUG.has(slugifyTag(raw))
}

/**
 * Resolve a raw manifest string to its canonical tag. Unknown tags get a
 * synthesised neutral meta rather than being dropped, so the manifest can
 * introduce vocabulary this build has never heard of.
 */
export function getTagMeta(raw: string): TagMeta {
  const slug = slugifyTag(raw)
  const known = BY_SLUG.get(slug)
  if (known) return known
  // An unknown tag reaches the chip as a bare slug ('time-of-flight'), because
  // that is what a normalised entry stores. Render it as words rather than
  // shouting the slug at the user.
  const label = raw.includes(' ') ? raw.trim() : slug.replace(/-/g, ' ')
  return { slug, label, kind: 'topic', facet: 'concept' }
}

/** Canonical slugs for a list of raw tags, de-duplicated, order preserved. */
export function canonicalizeTags(raw: readonly string[] | undefined): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const r of raw) {
    const slug = getTagMeta(r).slug
    if (slug && !out.includes(slug)) out.push(slug)
  }
  return out
}

/**
 * Inline style for a tag chip. Board tags point the chip's three colour
 * variables at their solder-mask family; topic chips inherit the neutral
 * defaults from .ts-tag.
 */
export function tagChipStyle(meta: TagMeta): CSSProperties | undefined {
  if (meta.kind !== 'board' || !meta.colorKey) return undefined
  return {
    '--tag-soft': `var(--board-${meta.colorKey}-soft)`,
    '--tag-line': `var(--board-${meta.colorKey})`,
    '--tag-ink': `var(--board-${meta.colorKey}-on)`
  } as CSSProperties
}

/** Sort comparator: boards first (in rail order), then topics by facet. */
export function compareTags(a: string, b: string): number {
  const rank = (slug: string): number => {
    const i = ALL_TAGS.findIndex((t) => t.slug === slug)
    return i === -1 ? ALL_TAGS.length : i
  }
  const ra = rank(a)
  const rb = rank(b)
  return ra === rb ? a.localeCompare(b) : ra - rb
}
