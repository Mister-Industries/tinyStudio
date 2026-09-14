/**
 * webAgent — Studio AI for the browser build.
 *
 * On desktop the agent runs in the Electron main process behind IPC
 * (window.api.agent). A browser has no main process, so here the same agent core
 * (src/shared/agentCore.ts) runs in the page and calls the Anthropic API
 * directly — the API allows this for browser clients that opt in. File tools go
 * through the unified fileSystem service, so they work on both a local folder
 * picked with the File System Access API and a mem:// project (examples, GitHub
 * deep links).
 *
 * The API key is the user's own and lives in this browser's localStorage; it is
 * only ever sent to api.anthropic.com. Exposes the same surface as the preload
 * bridge so AIAssistant doesn't care which one it's talking to.
 */

import Anthropic from '@anthropic-ai/sdk'
import {
  AgentSession,
  type AgentEvent,
  type AgentPermissionRequest,
  type AgentWorkspace
} from '../../../shared/agentCore'
import { fileSystem } from './fileSystem'
import { studioBridge } from './studioBridge'
import { isVirtualPath } from './virtualFileSystem'
import { webFileSystem } from './webFileSystem'

const KEY_STORAGE = 'tinystudio.anthropicApiKey'

function readKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE)
  } catch {
    return null
  }
}

/**
 * Normalise a model-supplied path to a '/'-separated path relative to `base`
 * ('' = the workspace root), accepting one that echoes the root it was shown.
 * Throws if the path climbs out of the workspace.
 */
export function workspaceRelative(base: string, p: string): string {
  let rest = p.replace(/\\/g, '/')
  if (base && (rest === base || rest.startsWith(base + '/'))) rest = rest.slice(base.length)
  const out: string[] = []
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) throw new Error(`Path "${p}" is outside the workspace and was blocked.`)
      out.pop()
    } else {
      out.push(seg)
    }
  }
  return out.join('/')
}

function browserWorkspace(root: string | null): AgentWorkspace | null {
  if (root === null) return null
  let base: string
  let label: string
  if (isVirtualPath(root)) {
    base = root.replace(/\/+$/, '')
    label = base
  } else if (webFileSystem.rootDirectoryName) {
    // A local folder from the File System Access API. webFileSystem lists
    // paths as "<folder>/…" (and accepts them with or without that prefix), so
    // the folder's name is the base the agent's relative paths hang off.
    base = webFileSystem.rootDirectoryName
    label = webFileSystem.rootDirectoryName
  } else {
    return null // folder access was lost (e.g. after a reload)
  }

  const join = (rel: string): string => (base && rel ? `${base}/${rel}` : base || rel)
  const abs = (p: string): string => join(workspaceRelative(base, p))
  const toRel = (full: string): string => {
    const norm = full.replace(/\\/g, '/')
    return base && norm.startsWith(base + '/') ? norm.slice(base.length + 1) : norm
  }

  return {
    label,
    absolute: abs,
    list: async (p) =>
      (await fileSystem.readDirectory(abs(p), false)).map((i) => ({
        name: i.name,
        isDirectory: i.isDirectory
      })),
    read: (p) => fileSystem.readFile(abs(p)),
    listFilesRecursive: async (p) => {
      const items = await fileSystem.readDirectory(abs(p), true).catch(() => [])
      if (items.length > 0) return items.filter((i) => !i.isDirectory).map((i) => toRel(i.path))
      // Not a folder (or an empty one): let grep try it as a single file.
      const rel = workspaceRelative(base, p)
      return rel ? [rel] : []
    },
    exists: (p) => fileSystem.pathExists(abs(p)),
    write: async (p, content) => {
      const rel = workspaceRelative(base, p)
      // The File System Access backend can't write into a folder that doesn't exist yet.
      const parts = rel.split('/')
      for (let i = 1; i < parts.length; i++) {
        const dir = join(parts.slice(0, i).join('/'))
        if (!(await fileSystem.pathExists(dir))) await fileSystem.createFolder(dir)
      }
      await fileSystem.writeFile(join(rel), content)
    },
    remove: async (p) => {
      const rel = workspaceRelative(base, p)
      if (!rel) throw new Error('Refusing to delete the workspace root.')
      await fileSystem.deleteFile(join(rel))
    }
  }
}

const eventListeners = new Set<(evt: AgentEvent) => void>()
const permissionListeners = new Set<(req: AgentPermissionRequest) => void>()
const fileListeners = new Set<(info: { path: string }) => void>()

function subscribe<T>(set: Set<T>, cb: T): () => void {
  set.add(cb)
  return () => {
    set.delete(cb)
  }
}

const session = new AgentSession({
  getApiKey: async () => readKey(),
  createClient: (apiKey) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true }),
  openWorkspace: browserWorkspace,
  emit: (evt) => eventListeners.forEach((cb) => cb(evt)),
  requestPermission: (req) => {
    if (permissionListeners.size === 0) return false
    permissionListeners.forEach((cb) => cb(req))
    return true
  },
  fileChanged: (path) => fileListeners.forEach((cb) => cb({ path })),
  studio: studioBridge
})

export const webAgent: Window['api']['agent'] = {
  send: async (args) => {
    // Fire-and-forget, like the IPC bridge: results stream through onEvent.
    void session.send(args)
  },
  abort: async () => session.abort(),
  reset: async () => session.reset(),
  respondPermission: async (id, allow) => session.resolvePermission(id, allow),
  onEvent: (cb) => subscribe(eventListeners, cb),
  onPermissionRequest: (cb) => subscribe(permissionListeners, cb),
  onFileChanged: (cb) => subscribe(fileListeners, cb)
}

export const webSettings: Window['api']['settings'] = {
  getStatus: async () =>
    readKey() ? { configured: true, source: 'stored' } : { configured: false, source: 'none' },
  setApiKey: async (key) => {
    localStorage.setItem(KEY_STORAGE, key)
  },
  clearApiKey: async () => {
    try {
      localStorage.removeItem(KEY_STORAGE)
    } catch {
      /* ignore */
    }
  }
}
