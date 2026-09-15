/**
 * gitClone — recognise a folder that is a git clone of a GitHub repo.
 *
 * Everything comes from the plain-text files git keeps in `.git`: the remote in
 * `config`, the checked-out branch in `HEAD`, and that branch's commit in
 * `refs/heads/<branch>` or `packed-refs`. No git runs and no objects are read.
 *
 * Not recognised: a folder inside a clone (the browser can't see the parent),
 * a worktree or submodule (their `.git` is a file), a detached HEAD, and
 * remotes that aren't on github.com.
 */

export interface CloneInfo {
  owner: string
  repo: string
  branch: string
  /** the commit the branch points at */
  head: string
}

/** owner/repo from a github.com remote URL, in any of the forms git accepts. */
export function githubRepoFromUrl(url: string): { owner: string; repo: string } | null {
  const m = url
    .trim()
    .match(
      /^(?:(?:https?|git|ssh):\/\/(?:[^@/\s]+@)?github\.com(?::\d+)?\/|[^@/\s]+@github\.com:)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i
    )
  return m ? { owner: m[1], repo: m[2] } : null
}

/** The GitHub repo `.git/config` points at: `origin` if it's on GitHub, else the first remote that is. */
export function parseGitHubRemote(config: string): { owner: string; repo: string } | null {
  const urls = new Map<string, string>()
  let remote: string | null = null
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim()
    const section = line.match(/^\[\s*remote\s+"([^"]+)"\s*\]$/i)
    if (section) {
      remote = section[1]
      continue
    }
    if (line.startsWith('[')) {
      remote = null
      continue
    }
    const url = line.match(/^url\s*=\s*(.+)$/i)
    if (remote && url && !urls.has(remote)) urls.set(remote, url[1])
  }
  const ordered = [
    ...(urls.has('origin') ? [urls.get('origin')!] : []),
    ...[...urls].filter(([name]) => name !== 'origin').map(([, url]) => url)
  ]
  for (const url of ordered) {
    const repo = githubRepoFromUrl(url)
    if (repo) return repo
  }
  return null
}

/** `.git/HEAD`: a branch (`ref: refs/heads/main`) or a detached commit. */
export function parseHead(head: string): { branch: string } | { commit: string } | null {
  const text = head.trim()
  const ref = text.match(/^ref:\s*refs\/heads\/(.+)$/)
  if (ref) return { branch: ref[1] }
  if (/^[0-9a-f]{40}$/i.test(text)) return { commit: text.toLowerCase() }
  return null
}

/** A branch's commit from `.git/packed-refs`. */
export function packedRefCommit(packedRefs: string, branch: string): string | null {
  for (const line of packedRefs.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{40})\s+refs\/heads\/(.+)$/i)
    if (m && m[2] === branch) return m[1].toLowerCase()
  }
  return null
}

/**
 * Read the clone at `root`. `read` returns a file's text, or null when it
 * doesn't exist or can't be read. Null when `root` isn't a recognisable clone
 * of a GitHub repo with a checked-out branch.
 */
export async function readClone(
  root: string,
  read: (path: string) => Promise<string | null>
): Promise<CloneInfo | null> {
  const config = await read(`${root}/.git/config`)
  if (!config) return null
  const remote = parseGitHubRemote(config)
  if (!remote) return null

  const head = parseHead((await read(`${root}/.git/HEAD`)) ?? '')
  if (!head || !('branch' in head)) return null

  const loose = (await read(`${root}/.git/refs/heads/${head.branch}`))?.trim() ?? ''
  const commit = /^[0-9a-f]{40}$/i.test(loose)
    ? loose.toLowerCase()
    : packedRefCommit((await read(`${root}/.git/packed-refs`)) ?? '', head.branch)
  // A branch with no commits yet has nothing to sync against.
  if (!commit) return null

  return { ...remote, branch: head.branch, head: commit }
}
