/**
 * True when the open project exists only in the browser — an example, a GitHub
 * repo, or a scratch project — with no folder on the user's computer yet.
 *
 * Desktop never has these: it writes opened repos to disk straight away.
 */

import { isElectron } from '@renderer/lib/utils'
import { isVirtualPath } from '@renderer/lib/virtualFileSystem'
import { useAppSelector } from '@renderer/redux'

export function useIsBrowserOnlyProject(): boolean {
  const path = useAppSelector((state) => state.file.workspace?.path)
  return isVirtualPath(path) && !isElectron()
}
