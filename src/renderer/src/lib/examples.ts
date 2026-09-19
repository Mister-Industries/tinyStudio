// Examples manifest + desktop installer.
//
// The Examples tab (ExamplesContent) and the first-run onboarding (WelcomeDialog)
// both read the same manifest of ready-to-open projects. On the desktop build the
// onboarding can also *download* them to a local folder so they live on disk and
// can be flashed straight away.

import { fetchRepoProject } from './github'
import { fileSystem } from './fileSystem'
import { canonicalizeTags, compareTags, getTagMeta, isKnownTag } from './exampleTags'
import { STORAGE_KEYS } from './storageKeys'

// One project the user can open. `owner/repo/path` are GitHub coordinates, so
// examples may live across multiple repos.
export interface ExampleEntry {
  title: string
  description: string
  owner: string
  repo: string
  path: string
  board?: string
  /** Grouping for the Examples tab: 'basics' | 'advanced' | 'hats'. */
  category?: string
  /** The tinyDocs page this example was generated from. */
  docsUrl?: string
  /**
   * Search/filter keywords, canonicalised to the vocabulary in
   * lib/exampleTags. Board tags ('tinycore', 'tinysniff', 'qwiic') colour the
   * card's chips to the real PCB; topic tags ('i2c', 'pwm') stay neutral.
   * Optional: a manifest without tags still loads and still searches on
   * title/description/board (see `searchHaystack`).
   *
   * Populated by scripts/gen-example-tags.mjs, which reads each project's
   * .ino and README, so this rarely needs hand-editing.
   */
  tags?: string[]
}

// Where the manifest lives: examples.json on the examples repo's `main`, which
// is what the raw URL serves. Its tags are written there by the repo's own
// workflow (tools/gen-example-tags.mjs).
//
// Entries carry `owner`/`repo`/`path` per project, so one manifest can span
// repos; the tinyHAT examples point straight at tinySniff / tinySpeak rather
// than being copied.
//
// Overridable (like tinyservice.url) for testing against a fork or branch via
// localStorage["tinystudio.examples.url"].
const DEFAULT_MANIFEST_URL =
  'https://raw.githubusercontent.com/Mister-Industries/tinyStudio-examples/main/examples.json'

export function resolveManifestUrl(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.examplesManifestUrl)
  } catch {
    return null
  }
}

/**
 * Normalise one manifest entry. Tags are folded onto their canonical slugs so
 * an entry written as "I2C" / "Wire" / "i2c" all filter as one tag, and a
 * board named only in the free-text `board` field still gets a board chip,
 * which keeps older manifests (and hand-written entries) working.
 */
function normalizeEntry(raw: ExampleEntry): ExampleEntry {
  // Declared tags are trusted as-is, unknown slugs included; that is what
  // lets the manifest introduce vocabulary ahead of the app.
  const tags = canonicalizeTags(raw.tags)
  // Board-derived tags are the opposite: `board` is free text a human typed,
  // so only fragments that resolve to a *known* tag are accepted. Without
  // that, "tinyCore (ESP32-S3)" ships a junk `tinycore-esp32-s3` chip beside
  // the real `tinyCore` one, and "/ Arduino" becomes a tag of its own.
  for (const t of knownTagsIn(raw.board)) if (!tags.includes(t)) tags.push(t)
  return tags.length > 0 ? { ...raw, tags: tags.sort(compareTags) } : raw
}

/**
 * Pull recognised tags out of a free-text board field.
 *
 * Real values this has to survive, from the published manifest:
 *   "tinyCore (ESP32-S3)"       -> tinycore          (parenthetical is a qualifier)
 *   "tinyCore + tinySpeak HAT"  -> tinycore, tinyspeak   ("HAT" is a form factor)
 *   "tinyCore + Qwiic Joystick" -> tinycore, qwiic, joystick
 *   "tinyCore / Arduino"        -> tinycore          ("Arduino" is not a tag)
 */
function knownTagsIn(board: string | undefined): string[] {
  if (!board) return []
  const fragments = board
    // Parentheses and brackets delimit a qualifier, not a separate board, but
    // what's inside can still be a recognised alias, so split, don't strip.
    .split(/[+/,&()[\]]|\bwith\b|\band\b/i)
    .flatMap((part) => {
      const trimmed = part
        .trim()
        .replace(/\b(hat|board|module|breakout)\b/gi, '')
        .trim()
      // "Qwiic Joystick" should yield both `qwiic` and `joystick`, so offer the
      // whole fragment and its individual words as candidates.
      return trimmed.includes(' ') ? [trimmed, ...trimmed.split(/\s+/)] : [trimmed]
    })
    .filter(Boolean)

  const out: string[] = []
  for (const f of fragments) {
    const meta = getTagMeta(f)
    // getTagMeta synthesises a meta for anything it doesn't know; a synthesised
    // one has no facet entry in the vocabulary, so compare against the real list.
    if (isKnownTag(meta.slug) && !out.includes(meta.slug)) out.push(meta.slug)
  }
  return out
}

/** Normalise a whole manifest. Exported so the rules above are testable. */
export function normalizeManifest(raw: ExampleEntry[]): ExampleEntry[] {
  return raw.map(normalizeEntry)
}

async function fetchManifestFrom(url: string): Promise<ExampleEntry[]> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Manifest ${r.status}`)
  const data = await r.json()
  return Array.isArray(data) ? normalizeManifest(data as ExampleEntry[]) : []
}

/**
 * The lowercased text one example matches free-text search against: its title,
 * description, board, category and every tag (slug *and* display label, so
 * typing "bluetooth" finds an entry tagged `ble`).
 */
export function searchHaystack(ex: ExampleEntry): string {
  const parts = [ex.title, ex.description, ex.board ?? '', ex.category ?? '']
  for (const t of ex.tags ?? []) {
    const meta = getTagMeta(t)
    parts.push(meta.slug, meta.label, ...(meta.aliases ?? []))
  }
  return parts.join(' ').toLowerCase()
}

/**
 * Free-text match. Whitespace-separated terms are AND-ed and matched as
 * substrings, so "wifi server" finds the WiFi web-server example regardless of
 * word order, and a partial word ("blue") still matches while typing.
 */
export function matchesQuery(ex: ExampleEntry, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const hay = searchHaystack(ex)
  return terms.every((t) => hay.includes(t))
}

/**
 * Fetch and parse the examples manifest, from the localStorage override when
 * one is set (a failure there should be loud), else from the examples repo.
 */
export async function fetchExamplesManifest(): Promise<ExampleEntry[]> {
  return fetchManifestFrom(resolveManifestUrl() ?? DEFAULT_MANIFEST_URL)
}

/**
 * Where an example lands on disk. Namespaced by owner/repo because example
 * folder names are not unique across repos: two `blink/` examples from
 * different repos would install over each other.
 */
function exampleFolderName(ex: ExampleEntry): string {
  const base = ex.path ? ex.path.split('/').filter(Boolean).pop() : ''
  return [ex.owner, ex.repo, base || ex.repo].join('/')
}

/**
 * Download every example in the manifest into the desktop app's default examples
 * folder (Documents/tinyStudio Examples). Desktop-only; the browser build
 * browses examples live via the Examples tab instead. Returns the target folder
 * and how many projects were written.
 */
export async function installExamplesToDisk(
  onProgress?: (msg: string) => void
): Promise<{ dir: string; installed: number }> {
  if (!fileSystem.isElectron()) {
    throw new Error('Example download is only available in the desktop app.')
  }

  const dir = await window.api.app.getExamplesDir()
  const manifest = await fetchExamplesManifest()
  let installed = 0

  for (let i = 0; i < manifest.length; i++) {
    const ex = manifest[i]
    onProgress?.(`Downloading ${i + 1}/${manifest.length} · ${ex.title}`)
    const project = await fetchRepoProject(ex.owner, ex.repo, ex.path)
    const folder = `${dir}/${exampleFolderName(ex)}`
    for (const [rel, content] of Object.entries(project.files)) {
      await fileSystem.writeFile(`${folder}/${rel}`, content)
    }
    if (Object.keys(project.files).length > 0) installed++
  }

  return { dir, installed }
}
