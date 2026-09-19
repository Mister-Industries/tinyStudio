// Project folder layout: the rules for what a tinyStudio project looks like on
// disk, shared by "Save to computer" and "Create project".
//
// The Arduino IDE and arduino-cli only open a sketch whose .ino is named after
// the folder it sits in. tinyStudio wants every other project file (README,
// circuit.json, visual.js…) right beside that .ino too, so ONE folder is the
// whole project: it opens in either tool, and making a new one is just making a
// folder.
//
//   blink-alternate/
//     blink-alternate.ino
//     README.md
//     circuit.json
//
// Pure functions only (no file system), so the rules are unit-testable.

/**
 * Coerce free text into a name the Arduino IDE accepts for a sketch (and so for
 * its folder): letters, digits, `_`, `-` and `.`, starting with a letter or
 * digit, at most 63 characters. Spaces become underscores rather than vanishing,
 * so "Long Distance Box" stays readable as "Long_Distance_Box".
 */
export function toSketchName(input: string): string {
  const cleaned = input
    .trim()
    .replace(/\.ino$/i, '')
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_.-]/g, '')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 63)
  return cleaned || 'sketch'
}

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const baseOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

/**
 * The project's main sketch: the shallowest .ino, ties broken alphabetically so
 * the choice is stable. Deeper ones are usually a library's examples folder.
 */
export function findMainIno(paths: string[]): string | null {
  const inos = paths.filter((p) => /\.ino$/i.test(p))
  if (inos.length === 0) return null
  return inos.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0]
}

/** The name a project would be saved under if the user doesn't pick one. */
export function suggestProjectName(paths: string[], fallback: string): string {
  const ino = findMainIno(paths)
  return toSketchName(ino ? baseOf(ino) : fallback)
}

export interface SketchLayout<T> {
  /** folder name and, when the sketch sits at the top, the .ino's basename */
  name: string
  /** project-relative path -> content, in the new layout */
  files: Record<string, T>
  /** old path -> new path, for every file that moved or was renamed */
  moved: Record<string, string>
}

/**
 * Lay a project's files out as one flat sketch folder called `requestedName`.
 *
 * With `hoist` (the default), a sketch buried in a subfolder (the old
 * `Blink Example/led_blink/led_blink.ino` shape) is lifted to the top along
 * with everything beside it. A file that would land on top of an existing
 * top-level file keeps its original nested path instead: silently overwriting
 * someone's README is worse than a slightly untidy folder.
 *
 * Then the top-level main .ino is renamed to match the folder, which is the one
 * thing the Arduino IDE insists on.
 *
 * Pass `keepPaths` for a project linked to a repo: nothing moves or is renamed,
 * because its paths have to keep matching the repo, or the next push scatters
 * files across new locations.
 */
export function flattenSketchLayout<T>(
  files: Record<string, T>,
  requestedName?: string,
  opts: { keepPaths?: boolean } = {}
): SketchLayout<T> {
  const paths = Object.keys(files)
  const ino = findMainIno(paths)
  const name = toSketchName(requestedName || (ino ? baseOf(ino) : 'sketch'))
  const sketchDir = ino ? dirOf(ino) : ''
  const hoist = !opts.keepPaths && sketchDir !== ''

  const moved: Record<string, string> = {}
  const place = (from: string, to: string): void => {
    if (from !== to) moved[from] = to
  }

  // Pass 1: hoist the sketch folder's contents to the top.
  const placed = new Map<string, string>() // old -> new
  for (const p of paths) {
    let next = p
    if (hoist && p.startsWith(sketchDir + '/')) {
      const lifted = p.slice(sketchDir.length + 1)
      if (!(lifted in files)) next = lifted
    }
    placed.set(p, next)
  }

  // Pass 2: the main sketch takes the folder's name, if it made it to the top.
  if (ino && !opts.keepPaths) {
    const at = placed.get(ino)!
    const renamed = `${name}.ino`
    const taken = [...placed.values()].some((v) => v === renamed && v !== at)
    if (dirOf(at) === '' && !taken) placed.set(ino, renamed)
  }

  const out: Record<string, T> = {}
  for (const [from, to] of placed) {
    out[to] = files[from]
    place(from, to)
  }
  return { name, files: out, moved }
}
