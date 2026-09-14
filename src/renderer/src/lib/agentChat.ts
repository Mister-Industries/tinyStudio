/**
 * agentChat — the Studio AI conversation as the panel shows it.
 *
 * Kept outside the AIAssistant component so the timeline survives switching
 * tabs, and so what streams in while the panel is closed (a reply, a tool call,
 * a file the agent just edited) isn't dropped. The agent itself — conversation
 * history and tool loop — runs in the main process on desktop and in the page on
 * the web (lib/webAgent); this module mirrors what it reports.
 */

import { refreshFileContentFromDisk, selectOpenFiles } from '@renderer/redux'
import { updateReadmeContent } from '@renderer/redux/fileSlice'
import { store } from '@renderer/redux/store'
import type { AgentEvent, AgentPermissionRequest } from './agentTypes'
import { fileSystem } from './fileSystem'
import { webAgent, webSettings } from './webAgent'

export type TimelineItem =
  | { kind: 'user'; text: string }
  | { kind: 'ai'; text: string }
  | { kind: 'tool'; id: string; name: string; summary: string; ok: boolean; running: boolean }
  | { kind: 'error'; text: string }

export interface ChatState {
  items: TimelineItem[]
  busy: boolean
  /** A write, edit or delete waiting for the user's Allow / Deny. */
  permission: AgentPermissionRequest | null
}

// Desktop: the agent runs in the Electron main process behind the preload
// bridge, so the API key never enters the renderer. Web: the same agent core
// runs in the page.
export const isDesktopAgent = typeof window !== 'undefined' && window.api != null
const agent = isDesktopAgent ? window.api.agent : webAgent
export const agentSettings = isDesktopAgent ? window.api.settings : webSettings

let state: ChatState = { items: [], busy: false, permission: null }
const listeners = new Set<() => void>()

function update(next: Partial<ChatState>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

export const getChatState = (): ChatState => state

/** For useSyncExternalStore. The first subscriber connects to the agent. */
export function subscribeChat(listener: () => void): () => void {
  connect()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

let connected = false
function connect(): void {
  if (connected) return
  connected = true
  agent.onEvent((evt: AgentEvent) => {
    update({
      items: applyEvent(state.items, evt),
      ...(evt.type === 'done' || evt.type === 'error' ? { busy: false } : {})
    })
  })
  agent.onPermissionRequest((request) => update({ permission: request }))
  agent.onFileChanged(({ path }) => reloadChangedFile(path))
}

/** An open editor tab for a file the agent changed reloads from disk. */
function reloadChangedFile(path: string): void {
  const norm = path.replace(/\\/g, '/')
  const open = selectOpenFiles(store.getState()).find((f) => f.path.replace(/\\/g, '/') === norm)
  if (open) {
    fileSystem
      .readFile(open.path)
      .then((content) => store.dispatch(refreshFileContentFromDisk({ id: open.id, content })))
      .catch((e) => console.warn('A file Studio AI changed was not reloaded:', open.path, e))
  }
  // The Documentation tab reads readmeContent, which otherwise updates only on a manual edit.
  if (/(^|\/)README\.md$/i.test(norm)) {
    fileSystem
      .readFile(path)
      .then((content) => store.dispatch(updateReadmeContent(content)))
      .catch((e) => console.warn('README not refreshed after Studio AI changed it:', path, e))
  }
}

export function sendToAgent(args: Parameters<typeof agent.send>[0]): void {
  update({ items: [...state.items, { kind: 'user', text: args.text }], busy: true })
  void agent.send(args)
}

export function stopAgent(): void {
  void agent.abort()
  update({ busy: false })
}

export function startNewChat(): void {
  void agent.reset()
  update({ items: [], busy: false })
}

export function respondToPermission(allow: boolean): void {
  if (state.permission) void agent.respondPermission(state.permission.id, allow)
  update({ permission: null })
}

/** Fold a streamed agent event into the timeline. */
function applyEvent(prev: TimelineItem[], evt: AgentEvent): TimelineItem[] {
  switch (evt.type) {
    case 'text_delta': {
      const last = prev[prev.length - 1]
      if (last && last.kind === 'ai') {
        return [...prev.slice(0, -1), { ...last, text: last.text + evt.text }]
      }
      return [...prev, { kind: 'ai', text: evt.text }]
    }
    case 'tool_use':
      return [
        ...prev,
        { kind: 'tool', id: evt.id, name: evt.name, summary: '', ok: true, running: true }
      ]
    case 'tool_result':
      return prev.map((it) =>
        it.kind === 'tool' && it.id === evt.id
          ? { ...it, running: false, ok: evt.ok, summary: evt.summary }
          : it
      )
    case 'error':
      return [...prev, { kind: 'error', text: evt.message }]
    case 'done':
    default:
      return prev
  }
}
