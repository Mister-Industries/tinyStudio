#!/usr/bin/env node
/**
 * gen-example-tags — propose tags for example projects and emit a manifest.
 *
 * Reads every example folder under the given roots and infers tags from what
 * the code actually does, rather than from what someone remembered to type:
 *
 *   - the `Board:` header comment tinyDocs generates into each .ino
 *   - `#include <...>` lines (Wire.h -> i2c, SD.h -> sd-card, WiFi.h -> wifi…)
 *   - Arduino API calls in the source (analogWrite -> pwm, tone -> buzzer…)
 *   - the `Docs:` URL's topic segment (…/basics/i2c-display/ -> i2c, oled)
 *   - the folder name and README title as a last pass of keyword matching
 *   - sibling files (visual.js / *.js sketches -> visual, circuit.json)
 *
 * Every rule is listed in RULES below, so adding vocabulary is a one-line edit
 * rather than a code change. Tags are emitted as canonical slugs matching
 * src/renderer/src/lib/exampleTags.ts — keep the two in step.
 *
 * Usage:
 *   node scripts/gen-example-tags.mjs [roots...] [options]
 *
 *   --owner <o>     GitHub owner for emitted entries  (default Mister-Industries)
 *   --repo <r>      GitHub repo for emitted entries   (default tinyStudio-examples)
 *   --category <c>  Force a category instead of inferring from the parent dir
 *   --base <dir>    Emit paths relative to this dir (default: cwd). Point it at
 *                   the root the examples repo will serve from.
 *   --out <file>    Write the manifest here           (default: stdout)
 *   --manifest <f>  ENRICH MODE. Instead of scanning for example folders and
 *                   inventing entries, read this manifest and add a `tags`
 *                   field to every entry it already has, leaving titles,
 *                   descriptions and paths untouched. Source folders given as
 *                   roots are matched to entries by path so the sketch itself
 *                   can be read; an entry with no local folder still gets tags
 *                   from its title, description and board field. This is the
 *                   mode to use on the published examples manifest.
 *   --merge <file>  Keep hand-authored fields from an existing manifest,
 *                   matching on owner/repo/path. Existing tags are unioned
 *                   with the inferred ones, so manual additions survive a
 *                   re-run and nothing you typed gets clobbered.
 *   --report        Print a per-example tag table to stderr for review
 *
 * Examples:
 *   node scripts/gen-example-tags.mjs tinyStudio-examples-old --report
 *   node scripts/gen-example-tags.mjs tinyStudio-examples-old \
 *     --manifest remote.json --out examples-tagged.json --report
 *
 * Node stdlib only — no install step, runs anywhere the repo is checked out.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'

// ── rules ────────────────────────────────────────────────────────────────────
// Each rule: a tag slug and the evidence that earns it. `include` matches
// #include filenames, `code` matches identifiers in the source, `text` matches
// folder name / README / docs URL. All matching is case-insensitive.
const RULES = [
  // boards & expansions
  { tag: 'tinycore', include: [], code: [], text: ['tinycore', 'esp32-s3', 'esp32s3'] },
  { tag: 'tinyglow', text: ['tinyglow'] },
  { tag: 'tinyproto', text: ['tinyproto'] },
  { tag: 'tinysniff', text: ['tinysniff', 'gas sensor'] },
  { tag: 'tinyspeak', text: ['tinyspeak'] },
  { tag: 'tinydisplay', text: ['tinydisplay'] },
  { tag: 'qwiic', text: ['qwiic', 'stemma'] },

  // connectivity
  { tag: 'wifi', include: ['WiFi.h', 'WiFiUdp.h'], code: ['WiFi.begin'], text: ['wifi', 'wi-fi'] },
  {
    tag: 'bluetooth',
    include: ['BLEDevice.h', 'BLEServer.h', 'BLEUtils.h', 'BLE2902.h'],
    text: ['bluetooth', 'ble']
  },
  { tag: 'i2c', include: ['Wire.h'], code: ['Wire.begin'], text: ['i2c', 'i²c'] },
  { tag: 'spi', include: ['SPI.h'], code: ['SPI.begin'], text: ['spi'] },
  {
    tag: 'serial',
    code: ['Serial.begin', 'Serial.println', 'Serial.print', 'Serial.read'],
    text: ['serial monitor', 'serial plotter']
  },
  { tag: 'esp-now', include: ['esp_now.h'], code: ['esp_now_init'], text: ['esp-now', 'espnow'] },
  { tag: 'mqtt', include: ['PubSubClient.h'], text: ['mqtt'] },
  { tag: 'websocket', include: ['WebSocketsServer.h'], text: ['websocket'] },
  {
    tag: 'web-server',
    include: ['WebServer.h', 'ESPAsyncWebServer.h'],
    text: ['web server', 'webserver', 'http server']
  },
  { tag: 'ota', include: ['AsyncElegantOTA.h', 'ArduinoOTA.h'], text: ['ota', 'over-the-air'] },

  // parts & sensors
  { tag: 'led', code: ['LED_BUILTIN'], text: ['led', 'blink', 'mood light'] },
  { tag: 'rgb-led', code: ['Adafruit_NeoPixel'], text: ['rgb', 'neopixel', 'rgb mood light'] },
  { tag: 'button', code: ['INPUT_PULLUP', 'digitalRead'], text: ['button', 'press'] },
  {
    tag: 'buzzer',
    code: ['tone(', 'noTone', 'ledcWriteTone'],
    text: ['buzzer', 'buzz', 'song', 'tone']
  },
  {
    tag: 'oled',
    include: ['Adafruit_SSD1306.h', 'Adafruit_GFX.h'],
    text: ['oled', 'ssd1306', 'i2c display']
  },
  {
    tag: 'imu',
    include: ['Adafruit_LSM6DSOX.h'],
    code: ['getEvent', 'accel.acceleration'],
    text: ['imu', 'accelerometer', 'gyro', 'motion']
  },
  { tag: 'sd-card', include: ['SD.h', 'FS.h'], code: ['SD.begin'], text: ['sd card', 'sdcard'] },
  { tag: 'potentiometer', text: ['potentiometer'] },
  { tag: 'light-sensor', text: ['light sensor', 'photoresistor', 'ldr'] },
  { tag: 'joystick', text: ['joystick'] },
  { tag: 'distance-sensor', text: ['distance sensor', 'proximity', 'ir distance', 'ultrasonic'] },
  { tag: 'dac', include: ['Adafruit_MCP4725.h'], text: ['dac', 'mcp4725'] },

  // concepts
  { tag: 'blink', text: ['blink', 'sos'] },
  {
    tag: 'pwm',
    code: ['analogWrite', 'ledcWrite', 'ledcSetup'],
    text: ['pwm', 'fade', 'breathing', 'brightness']
  },
  { tag: 'adc', code: ['analogRead'], text: ['adc', 'analog value', 'analog input'] },
  { tag: 'digital-io', code: ['digitalWrite', 'pinMode'], text: ['digital'] },
  { tag: 'plotter', text: ['plotter', 'plotting', 'graph', 'chart', 'visuali'] },
  {
    tag: 'file-io',
    code: ['file.print', 'FILE_APPEND'],
    text: ['csv', 'append', 'logging', 'save data']
  },
  { tag: 'timing', code: ['millis('], text: ['non-blocking', 'timestamp'] },
  { tag: 'interrupts', code: ['attachInterrupt'], text: ['interrupt', 'debounce'] }
]

// ── cli ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const opt = {
  owner: 'Mister-Industries',
  repo: 'tinyStudio-examples',
  category: null,
  out: null,
  merge: null,
  report: false
}
const roots = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--report') opt.report = true
  else if (a.startsWith('--')) opt[a.slice(2)] = argv[++i]
  else roots.push(a)
}
if (roots.length === 0) {
  console.error(
    'usage: node scripts/gen-example-tags.mjs <root...> [--out file] [--merge file] [--report]'
  )
  process.exit(1)
}

// ── scanning ─────────────────────────────────────────────────────────────────
const SOURCE_EXT = /\.(ino|cpp|c|h|js)$/i

/** Every directory that directly contains a sketch file is one example. */
function findExampleDirs(root) {
  const found = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((e) => e.isFile() && /\.ino$/i.test(e.name))) {
      found.push(dir)
      return // an example is a leaf; don't descend into its subfolders
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        walk(join(dir, e.name))
    }
  }
  walk(root)
  return found.sort()
}

function readExample(dir) {
  const files = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile())
  let source = ''
  let readme = ''
  const names = []
  for (const f of files) {
    names.push(f.name)
    const p = join(dir, f.name)
    if (statSync(p).size > 512 * 1024) continue // skip anything oversized
    if (SOURCE_EXT.test(f.name)) source += '\n' + readFileSync(p, 'utf8')
    else if (/^readme\.md$/i.test(f.name)) readme = readFileSync(p, 'utf8')
  }
  return { source, readme, names }
}

/**
 * These READMEs are generated from tinyDocs and carry a fixed tail ("## Open
 * it", "## Where this came from", "## Files") plus a stock "Click the **Flash
 * tinyCore** button" line. That prose is identical across every example, so
 * feeding it to the matcher tags unrelated sketches with `button`. Everything
 * from the first boilerplate heading on is cut before the README is used as
 * either a description or tag evidence.
 */
const README_TAIL = /^##\s+(open it|where this came from|files)\b/im
/** H1s that say nothing about the example — never usable as a title. */
const BOILERPLATE_TITLES = /^(flash (the )?tinycore|readme|example|getting started)$/i

function readmeBody(readme) {
  const cut = readme.search(README_TAIL)
  return (cut === -1 ? readme : readme.slice(0, cut)).replace(/click the \*\*flash[^\n]*/gi, '')
}

/** The `Board:` / `Docs:` / title metadata tinyDocs writes into each sketch. */
function headerMeta(source, readme, dir) {
  const board = source.match(/^\s*\*\s*Board:\s*(.+)$/m)?.[1]?.trim() ?? ''
  const docsUrl = source.match(/^\s*\*\s*Docs:\s*(\S+)/m)?.[1]?.trim() ?? ''
  // The tinyDocs page this was generated from — good tag evidence ("What is
  // an ADC?"), too generic to use as the example's own title.
  const docsTitle = readme.match(/From the tinyDocs page \[([^\]]+)\]/)?.[1]?.trim() ?? ''
  const body = readmeBody(readme)

  // Title: the sketch's own block-comment title is the most specific thing
  // available ("Alternating Blink Pattern"); the README H1 usually matches it
  // but is sometimes stock. Folder name is the floor.
  const candidates = [
    source.match(/^\/\*+\s*\n\s*\*\s*(.+?)\s*$/m)?.[1],
    body.match(/^#\s+(.+)$/m)?.[1],
    basename(dir)
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  ]
  const title =
    candidates.map((c) => c?.trim()).find((c) => c && !BOILERPLATE_TITLES.test(c)) ?? basename(dir)

  // Description: first substantive prose line of the README body.
  const prose = body
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 20 &&
        !l.startsWith('#') &&
        !l.startsWith('!') &&
        !l.startsWith('>') &&
        !l.startsWith('|') &&
        !l.startsWith('-') &&
        !l.startsWith('```')
    )
  // A line ending in ':' is a lead-in to a code block ("Replace your loop()
  // with this:"), which reads badly as a card description — prefer a line that
  // stands on its own, and only fall back to the lead-in if there isn't one.
  const description = prose.find((l) => !l.endsWith(':')) ?? prose[0] ?? ''
  return { board, docsUrl, docsTitle, title, description, body }
}

/**
 * Text evidence is matched on word boundaries, never as a bare substring.
 * Substring matching looks fine until "ble" tags every example that says
 * "variable", "led" matches "called", and "http" in the Docs: URL tags all 55
 * examples as web servers — all three of which it did.
 */
const textHitCache = new Map()
function textHit(text, keyword) {
  let re = textHitCache.get(keyword)
  if (!re) {
    const esc = keyword
      .toLowerCase()
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, 'i')
    textHitCache.set(keyword, re)
  }
  return re.test(text)
}

function inferTags({ source, readme, names }, meta, dir) {
  const includes = [...source.matchAll(/#include\s*[<"]([^>"]+)[>"]/g)].map((m) =>
    m[1].toLowerCase()
  )
  const code = source.toLowerCase()
  // Text evidence: folder name, title, README, the docs URL topic, board line.
  const text = [
    basename(dir).replace(/[-_]+/g, ' '),
    meta.title,
    meta.description,
    meta.board,
    meta.docsTitle,
    decodeURIComponent(meta.docsUrl)
      .replace(/^https?:\/\/[^/]+/i, '')
      .replace(/[/_-]+/g, ' '),
    (meta.body ?? readme).slice(0, 4000),
    names.join(' ')
  ]
    .join('\n')
    .toLowerCase()

  const tags = []
  for (const rule of RULES) {
    const hit =
      (rule.include ?? []).some((i) => includes.includes(i.toLowerCase())) ||
      (rule.code ?? []).some((c) => code.includes(c.toLowerCase())) ||
      (rule.text ?? []).some((t) => textHit(text, t))
    if (hit) tags.push(rule.tag)
  }
  // A p5 sketch beside the .ino means the example drives the Visual view.
  if (names.some((n) => /\.js$/i.test(n))) tags.push('visual')
  return [...new Set(tags)]
}

/**
 * Recognised tags inside a free-text `board` field — the same rules as
 * lib/examples.ts#knownTagsIn, which the app applies at load time. Keep the two
 * in step: "tinyCore (ESP32-S3)" must yield `tinycore`, not a junk slug, and
 * "tinyCore + tinySpeak HAT" must yield both boards.
 */
const KNOWN_TAGS = new Set([
  ...RULES.map((r) => r.tag),
  'visual',
  'beginner',
  'advanced',
  'joystick'
])
const BOARD_ALIASES = {
  'esp32 s3': 'tinycore',
  esp32: 'tinycore',
  core: 'tinycore',
  sniff: 'tinysniff',
  speak: 'tinyspeak',
  glow: 'tinyglow',
  proto: 'tinyproto'
}

function tagsFromBoardField(board) {
  if (!board) return []
  const out = []
  const fragments = board
    .split(/[+/,&()[\]]|\bwith\b|\band\b/i)
    .flatMap((part) => {
      const t = part
        .trim()
        .replace(/\b(hat|board|module|breakout)\b/gi, '')
        .trim()
      return t.includes(' ') ? [t, ...t.split(/\s+/)] : [t]
    })
    .filter(Boolean)
  for (const f of fragments) {
    const slug = f
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    const spaced = f
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
    const tag = KNOWN_TAGS.has(slug) ? slug : (BOARD_ALIASES[spaced] ?? BOARD_ALIASES[slug])
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out
}

/** Keep the chip row readable: boards, then the most specific topics. */
const BOARD_TAGS = new Set([
  'tinycore',
  'tinyglow',
  'tinyproto',
  'tinysniff',
  'tinyspeak',
  'tinydisplay',
  'qwiic'
])
// Generic tags only earn a slot if the example has little else to say.
const GENERIC = ['serial', 'digital-io', 'timing', 'led']
const MAX_TOPIC_TAGS = 5

function prioritize(tags) {
  const boards = tags.filter((t) => BOARD_TAGS.has(t))
  const specific = tags.filter((t) => !BOARD_TAGS.has(t) && !GENERIC.includes(t))
  const generic = tags.filter((t) => GENERIC.includes(t))
  return [...boards, ...specific, ...generic].slice(0, boards.length + MAX_TOPIC_TAGS)
}

// ── build ────────────────────────────────────────────────────────────────────
const existing = new Map()
if (opt.merge) {
  try {
    for (const e of JSON.parse(readFileSync(opt.merge, 'utf8'))) {
      existing.set(`${e.owner}/${e.repo}/${e.path}`, e)
    }
  } catch (err) {
    console.error(`--merge: could not read ${opt.merge} (${err.message}); continuing without it`)
  }
}

const entries = []
const report = []

// ── enrich mode ──────────────────────────────────────────────────────────────
// Add tags to a manifest that already exists, changing nothing else about it.
if (opt.manifest) {
  const manifest = JSON.parse(readFileSync(opt.manifest, 'utf8'))

  // Index every local example folder by path and by basename, so a manifest
  // entry can find its own sketch wherever the checkout happens to keep it.
  const byPath = new Map()
  for (const root of roots) {
    for (const dir of findExampleDirs(root)) {
      const rel = relative(root, dir).split(sep).join('/')
      byPath.set(rel.toLowerCase(), dir)
      byPath.set(basename(dir).toLowerCase(), dir)
      byPath.set(relative(process.cwd(), dir).split(sep).join('/').toLowerCase(), dir)
    }
  }

  for (const e of manifest) {
    const p = (e.path ?? '').toLowerCase()
    const dir = byPath.get(p) ?? byPath.get(basename(p))
    let inferred = []
    if (dir) {
      const files = readExample(dir)
      inferred = inferTags(files, headerMeta(files.source, files.readme, dir), dir)
    } else {
      // No local folder (the tinyHAT examples live in their own repos): fall
      // back to the entry's own prose. Fewer tags, but never wrong ones.
      const text = [e.title, e.description, e.path, e.board].filter(Boolean).join('\n')
      inferred = RULES.filter((r) => (r.text ?? []).some((t) => textHit(text, t))).map((r) => r.tag)
    }
    // The board field is authoritative for which hardware an example needs.
    const boardTags = tagsFromBoardField(e.board)
    const tags = prioritize([...new Set([...boardTags, ...inferred, ...(e.tags ?? [])])])
    entries.push({ ...e, tags })
    report.push({ path: e.path ?? e.title, tags, matched: Boolean(dir) })
  }
} else
  for (const root of roots) {
    for (const dir of findExampleDirs(root)) {
      const files = readExample(dir)
      const meta = headerMeta(files.source, files.readme, dir)
      const inferred = prioritize(inferTags(files, meta, dir))

      // Emitted paths are relative to --base (the root of the repo the examples
      // will live in), so scanning ./tinyStudio-examples-old emits
      // "basics/blink-basic" — what the examples repo actually serves — rather
      // than a path that only makes sense in this checkout.
      const relPath = relative(opt.base ?? process.cwd(), dir)
        .split(sep)
        .join('/')
      const category = opt.category ?? relative(root, dir).split(sep)[0] ?? undefined
      const key = `${opt.owner}/${opt.repo}/${relPath}`
      const prev = existing.get(key)

      // Hand-authored fields win; tags are unioned so manual additions survive.
      const tags = [...new Set([...(prev?.tags ?? []), ...inferred])]
      entries.push({
        title: prev?.title ?? meta.title,
        description: prev?.description ?? meta.description,
        owner: opt.owner,
        repo: opt.repo,
        path: relPath,
        ...((prev?.board ?? meta.board) ? { board: prev?.board ?? meta.board } : {}),
        ...((prev?.category ?? category) ? { category: prev?.category ?? category } : {}),
        ...((prev?.docsUrl ?? meta.docsUrl) ? { docsUrl: prev?.docsUrl ?? meta.docsUrl } : {}),
        tags
      })
      report.push({ path: relPath, tags })
    }
  }

if (opt.report) {
  const width = Math.min(52, Math.max(...report.map((r) => basename(r.path).length), 10))
  for (const r of report) {
    console.error(`${basename(r.path).padEnd(width)}  ${r.tags.join(' ') || '(none)'}`)
  }
  const counts = new Map()
  for (const r of report) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  console.error(`\n${report.length} examples, ${counts.size} distinct tags`)
  console.error(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t}:${n}`)
      .join('  ')
  )
  const untagged = report.filter((r) => r.tags.length === 0)
  if (untagged.length)
    console.error(`\nUNTAGGED (${untagged.length}): ${untagged.map((r) => r.path).join(', ')}`)

  // Enrich mode only. An entry whose sketch wasn't found locally is tagged from
  // its title and description alone — the board tags stay correct, but the
  // topic tags are whatever the prose happened to say. This is the loud warning
  // that you are running against the wrong checkout: run the generator from a
  // clone of the repo the manifest actually describes to get full tags.
  const unmatched = report.filter((r) => r.matched === false)
  if (unmatched.length) {
    console.error(
      `\nNO LOCAL SOURCE (${unmatched.length}/${report.length}) — tagged from manifest prose only.\n` +
        `These entries' sketches were not found under the roots given, so their topic tags are\n` +
        `incomplete. Re-run with a checkout that contains them:\n  ` +
        unmatched
          .map((r) => r.path)
          .slice(0, 12)
          .join('\n  ') +
        (unmatched.length > 12 ? `\n  … and ${unmatched.length - 12} more` : '')
    )
  }
}

const json = JSON.stringify(entries, null, 2) + '\n'
if (opt.out) {
  writeFileSync(opt.out, json)
  console.error(`wrote ${entries.length} entries to ${opt.out}`)
} else {
  process.stdout.write(json)
}
