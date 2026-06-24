// Deep-link routing for opening GitHub projects in the editor.
//
// URL scheme: app.tinyStudio.cc/<owner>/<repo>/<optional/sub/path>
//   e.g. /Mister-Industries/tinyStudio-examples/blink
//
// There is no router dependency — the app parses window.location on startup (and
// on back/forward) and loads the matching project via LoadGitHubProjectCommand.
// The Netlify SPA redirect (netlify.toml) ensures the deep URL serves index.html
// so this code can run.

import { LoadGitHubProjectCommand } from '@renderer/commands/fileCommands'

export interface ProjectRoute {
  owner: string
  repo: string
  path: string
}

/** Parse a pathname into a project route, or null if it isn't one. */
export function parseProjectRoute(
  pathname: string = window.location.pathname
): ProjectRoute | null {
  const segs = pathname
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)
  if (segs.length < 2) return null
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
export async function navigateToProject(owner: string, repo: string, path = ''): Promise<void> {
  const url = projectRoutePath(owner, repo, path)
  if (url !== window.location.pathname) {
    window.history.pushState({ owner, repo, path }, '', url)
  }
  await new LoadGitHubProjectCommand(owner, repo, path).execute()
}
