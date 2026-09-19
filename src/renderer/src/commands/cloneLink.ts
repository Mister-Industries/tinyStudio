/**
 * cloneLink: link a folder that is a git clone of a GitHub repo from its own
 * `.git` (lib/gitClone), so Push and Pull work on a clone without linking it by
 * hand in the GitHub tab.
 */

import { fileSystem } from '@renderer/lib/fileSystem'
import { readClone } from '@renderer/lib/gitClone'
import { loadAccount, loadLink, saveLink } from '@renderer/lib/github'
import { linkForClone } from '@renderer/lib/githubSync'
import { notify as toast } from '@renderer/lib/notify'
import { refreshRepoSync } from '@renderer/lib/repoSync'

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await fileSystem.readFile(path)
  } catch {
    // A missing or unreadable .git file just means this isn't a clone we can use.
    return null
  }
}

/**
 * Run when a folder opens. A link made by hand is left alone, and so is a clone
 * link whose checked-out commit hasn't changed: its baseline already includes
 * anything pushed from tinyStudio since. Otherwise the link is synced to the
 * commit the clone has checked out, the way `git status` measures changes.
 */
export async function linkClonedFolder(folder: string): Promise<void> {
  const clone = await readClone(folder, readIfExists)
  if (!clone) return

  const remote = `${clone.owner}/${clone.repo}`
  const existing = loadLink(folder)
  if (existing && !existing.clone) return
  if (
    existing?.clone &&
    existing.remote.toLowerCase() === remote.toLowerCase() &&
    existing.branch === clone.branch &&
    existing.clone.head === clone.head
  ) {
    return
  }

  try {
    const result = await linkForClone(clone, loadAccount()?.token)
    // Another folder may have opened while GitHub answered.
    if (fileSystem.getCurrentWorkspace() !== folder) return
    if ('problem' in result) {
      if (result.problem === 'not-on-github' && !existing) {
        toast.info(`Not linked to ${remote}`, {
          description: `${result.message} Push that commit with git, then open the folder again.`
        })
      } else {
        console.info(`Not linking ${remote} from .git: ${result.message}`)
      }
      return
    }
    saveLink(folder, result.link)
    await refreshRepoSync()
    toast.success(existing ? `Synced with ${remote}` : `Linked to ${remote}`, {
      description: existing
        ? `This folder has ${clone.head.slice(0, 7)} checked out now, so changes are measured from there.`
        : `Found in this folder's .git. Push and Pull use ${clone.branch} on GitHub.`
    })
  } catch (e) {
    console.warn(`Could not link ${remote} from this folder's .git:`, e)
  }
}
