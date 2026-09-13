/**
 * True when the open project came from a GitHub repo the signed-in user cannot
 * push to — an example, or anyone else's repo.
 *
 * Access is answered by GitHub per-token (see canPushTo) rather than inferred
 * from identity, so collaborators get write access with no extra wiring and a
 * signed-out user correctly reads as read-only.
 */

import { useAppSelector } from '@renderer/redux'

export function useIsReadOnlyProject(): boolean {
  const workspace = useAppSelector((state) => state.file.workspace)
  return !!workspace?.source && !workspace.source.canPush
}
