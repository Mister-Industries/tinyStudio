// Examples manifest + desktop installer.
//
// The Examples tab (ExamplesContent) and the first-run onboarding (WelcomeDialog)
// both read the same manifest of ready-to-open projects. On the desktop build the
// onboarding can also *download* them to a local folder so they live on disk and
// can be flashed straight away.

import { fetchRepoFolder } from './github'
import { fileSystem } from './fileSystem'

// One project the user can open. `owner/repo/path` are GitHub coordinates, so
// examples may live across multiple repos.
export interface ExampleEntry {
  title: string
  description: string
  owner: string
  repo: string
  path: string
  board?: string
}

// Where the manifest lives. Interim: examples.json at the root of the main repo
// (must be on `main` for this raw URL to resolve). When the dedicated public
// examples repo is set up, repoint this to
// https://raw.githubusercontent.com/Mister-Industries/tinyStudio-examples/main/examples.json.
// Overridable (like tinyservice.url) for testing against a fork or branch via
// localStorage["tinystudio.examples.url"].
const DEFAULT_MANIFEST_URL =
  'https://raw.githubusercontent.com/Mister-Industries/tinyStudio/main/examples.json'

export function resolveManifestUrl(): string {
  try {
    return localStorage.getItem('tinystudio.examples.url') || DEFAULT_MANIFEST_URL
  } catch {
    return DEFAULT_MANIFEST_URL
  }
}

/** Fetch and parse the examples manifest. */
export async function fetchExamplesManifest(): Promise<ExampleEntry[]> {
  const r = await fetch(resolveManifestUrl())
  if (!r.ok) throw new Error(`Manifest ${r.status}`)
  const data = await r.json()
  return Array.isArray(data) ? (data as ExampleEntry[]) : []
}

/** Folder name to store an example under (its path basename, else the repo). */
function exampleFolderName(ex: ExampleEntry): string {
  const base = ex.path ? ex.path.split('/').filter(Boolean).pop() : ''
  return base || ex.repo
}

/**
 * Download every example in the manifest into the desktop app's default examples
 * folder (Documents/tinyStudio Examples). Desktop-only — the browser build
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
    const files = await fetchRepoFolder(ex.owner, ex.repo, ex.path)
    const folder = `${dir}/${exampleFolderName(ex)}`
    for (const [rel, content] of Object.entries(files)) {
      await fileSystem.writeFile(`${folder}/${rel}`, content)
    }
    if (Object.keys(files).length > 0) installed++
  }

  return { dir, installed }
}
