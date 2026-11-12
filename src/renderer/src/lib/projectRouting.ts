// Deep-link routing for opening GitHub projects in the editor.
//
// URL scheme: studio.tinycore.cc/<owner>/<repo>/<optional/sub/path>
//   e.g. /Mister-Industries/tinyStudio-examples/blink
//
// Paths under /auth/ belong to sign-in (lib/githubWebAuth) and are never
// read as a project.
//
// There is no router dependency; the app parses window.location on startup (and
// on back/forward) and loads the matching project via loadGitHubProject.
// The Netlify SPA redirect (netlify.toml) ensures the deep URL serves index.html
// so this code can run.

import { loadGitHubProject } from '@renderer/commands/fileCommands'

export interface ProjectRoute {
  owner: string
  repo: string
  path: string
}

/**
 * Whether this window's URL can carry a project deep link. Only when the app is
 * served over http(s): the web app and the dev server. The packaged desktop app
 * loads from file://, where the path is the app's own location on disk
 * (/Applications/tinyStudio.app/…), not a project. Reading it as one opened
 * "Applications/tinyStudio.app" on GitHub at every launch, failed, and skipped
 * reopening the last workspace.
 */
export function hasUrlRouting(): boolean {
  const { protocol } = window.location
  return protocol === 'http:' || protocol === 'https:'
}

/**
 * Parse a pathname into a project route, or null if it isn't one. With no
 * argument it reads the window's own URL, which is never a route in the
 * packaged desktop app (see hasUrlRouting).
 */
export function parseProjectRoute(pathname?: string): ProjectRoute | null {
  if (pathname === undefined) {
    if (!hasUrlRouting()) return null
    pathname = window.location.pathname
  }
  const segs = pathname
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)
  if (segs.length < 2 || segs[0] === 'auth') return null
  const [owner, repo, ...rest] = segs
  return { owner, repo, path: rest.join('/') }
}

/** Build the URL path for a project route. */
export function projectRoutePath(owner: string, repo: string, path = ''): string {
  return (
    '/' +
    [owner, repo, path]
      .filter(Boolean)
      .map((s) => s.split('/').map(encodeURIComponent).join('/'))
      .join('/')
  )
}

/**
 * Push a project URL into history and load it. Used by the Examples browser and
 * any in-app "open this project" affordance.
 */
export async function navigateToProject(
  owner: string,
  repo: string,
  path = '',
  // A non-default branch (from a pasted /tree/<branch>/ link). The URL scheme
  // has no slot for it, so a reload falls back to the default branch.
  branch?: string
): Promise<void> {
  const url = projectRoutePath(owner, repo, path)
  // On file:// a pushed path would replace the app's own file path, and a reload
  // would then load a file that doesn't exist.
  if (hasUrlRouting() && url !== window.location.pathname) {
    window.history.pushState({ owner, repo, path }, '', url)
  }
  await loadGitHubProject(owner, repo, path, branch)
}
