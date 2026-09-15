/**
 * The open project's GitHub sync state (lib/repoSync), kept following the
 * current workspace and signed-in account.
 */

import { useGitHubAccount } from '@renderer/hooks/useGitHubAccount'
import {
  getRepoSync,
  subscribeRepoSync,
  trackRepoSync,
  type RepoSyncState
} from '@renderer/lib/repoSync'
import { useAppSelector } from '@renderer/redux'
import { useEffect, useSyncExternalStore } from 'react'

export function useRepoSync(): RepoSyncState {
  const workspace = useAppSelector((state) => state.file.workspace)
  const { account } = useGitHubAccount()
  useEffect(() => {
    trackRepoSync(workspace, account?.token)
  }, [workspace, account?.token])
  return useSyncExternalStore(subscribeRepoSync, getRepoSync)
}
