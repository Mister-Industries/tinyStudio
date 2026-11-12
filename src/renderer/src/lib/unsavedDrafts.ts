/**
 * unsavedDrafts: crash recovery for project files edited in a full-window view.
 *
 * The Circuit view edits an in-memory buffer that reaches disk only on Save, so
 * anything that reloads the window (a renderer crash, a dev-server reload, a
 * force quit) used to throw the whole diagram away. Every edit now also lands
 * here, in localStorage, which survives all of those. When the view next opens
 * the file and finds a copy that differs from what is on disk, it offers to
 * restore it.
 *
 * Best effort by design: storage can be full, disabled or throw, and none of
 * that may ever break editing, so every access is guarded.
 */

import { draftKey } from './storageKeys'

export interface Draft {
  content: string
  /** epoch ms of the edit */
  at: number
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const defaultStore = (): Store | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function saveDraft(path: string, content: string, store = defaultStore()): void {
  try {
    store?.setItem(draftKey(path), JSON.stringify({ content, at: Date.now() } satisfies Draft))
  } catch {
    // quota or disabled storage: recovery is a bonus, never a blocker
  }
}

export function readDraft(path: string, store = defaultStore()): Draft | null {
  try {
    const raw = store?.getItem(draftKey(path))
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<Draft>
    return typeof d.content === 'string' && typeof d.at === 'number'
      ? { content: d.content, at: d.at }
      : null
  } catch {
    return null
  }
}

export function clearDraft(path: string, store = defaultStore()): void {
  try {
    store?.removeItem(draftKey(path))
  } catch {
    // ignore
  }
}

/**
 * The draft worth offering when a file is opened: only one that differs from
 * the content just loaded (a draft equal to the file was saved, nothing lost).
 */
export function recoverableDraft(
  path: string,
  loaded: string,
  store = defaultStore()
): Draft | null {
  const d = readDraft(path, store)
  return d && d.content !== loaded ? d : null
}
