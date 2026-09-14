/**
 * AgentService — the desktop host for the Studio AI agent.
 *
 * The agent itself (conversation, tool loop, tool definitions) lives in
 * src/shared/agentCore.ts so the web build can run it too. This file supplies
 * the desktop pieces: it runs in the main (Node) process so the API key never
 * reaches the renderer bundle, and gives the agent Node filesystem access scoped
 * to the open workspace.
 *
 * Communication with the renderer:
 *   - main → renderer  'agent:event'              streamed text / tool activity / done / error
 *   - main → renderer  'agent:permission-request' { id, ... } — awaits a response
 *   - main → renderer  'agent:file-changed'       { path } — so open editors can refresh
 *   - renderer → main  agent:send / agent:abort / agent:reset / agent:permission-response
 */

import Anthropic from '@anthropic-ai/sdk'
import { BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import {
  AgentSession,
  IGNORED_DIRS,
  type AgentSendArgs,
  type AgentWorkspace,
  type StudioMethod
} from '../shared/agentCore'
import { getApiKey } from './settings'

export type { AgentSendArgs }

/** How long to wait for the renderer to answer a live-state request. */
const STUDIO_TIMEOUT_MS = 20000

type StudioAnswer = { ok: boolean; value: string }

export class AgentService {
  private window: BrowserWindow | null = null
  private studioRequests = new Map<string, (answer: StudioAnswer) => void>()
  private nextStudioId = 1
  private session = new AgentSession({
    getApiKey,
    createClient: (apiKey) => new Anthropic({ apiKey }),
    openWorkspace: (root) => (root ? nodeWorkspace(root) : null),
    emit: (evt) => this.window?.webContents.send('agent:event', evt),
    requestPermission: (req) => {
      if (!this.window) return false
      this.window.webContents.send('agent:permission-request', req)
      return true
    },
    fileChanged: (absolutePath) =>
      this.window?.webContents.send('agent:file-changed', { path: absolutePath }),
    // The parts registry and serial buffer live in the renderer.
    studio: {
      inspectCircuit: (text) => this.askRenderer('inspectCircuit', text),
      findParts: (query) => this.askRenderer('findParts', query),
      readSerial: (count) => this.askRenderer('readSerial', count)
    }
  })

  setWindow(win: BrowserWindow): void {
    this.window = win
  }

  /** The renderer's answer to an askRenderer() request. */
  resolveStudio(id: string, answer: StudioAnswer): void {
    const resolve = this.studioRequests.get(id)
    if (resolve) {
      this.studioRequests.delete(id)
      resolve(answer)
    }
  }

  /** Round-trip a live-state request to the renderer (lib/studioBridge.ts). */
  private askRenderer(method: StudioMethod, arg: string | number): Promise<string> {
    const win = this.window
    if (!win) return Promise.reject(new Error('The app window is not available.'))
    const id = `studio-${this.nextStudioId++}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.studioRequests.delete(id)
        reject(new Error('The app did not answer in time.'))
      }, STUDIO_TIMEOUT_MS)
      this.studioRequests.set(id, ({ ok, value }) => {
        clearTimeout(timer)
        if (ok) resolve(value)
        else reject(new Error(value))
      })
      win.webContents.send('agent:studio-request', { id, method, arg })
    })
  }

  reset(): void {
    this.session.reset()
  }

  abort(): void {
    this.session.abort()
  }

  resolvePermission(id: string, allow: boolean): void {
    this.session.resolvePermission(id, allow)
  }

  send(args: AgentSendArgs): Promise<void> {
    return this.session.send(args)
  }
}

/** Node filesystem access confined to one workspace folder. */
function nodeWorkspace(root: string): AgentWorkspace {
  const normRoot = path.resolve(root)

  /** Resolve a workspace-relative path, refusing anything that escapes the root. */
  const resolve = (p: string): string => {
    const abs = path.resolve(normRoot, p)
    if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
      throw new Error(`Path "${p}" is outside the workspace and was blocked.`)
    }
    return abs
  }
  const rel = (abs: string): string => path.relative(normRoot, abs).split(path.sep).join('/') || '.'

  return {
    label: root,
    absolute: resolve,
    list: async (p) =>
      (await fs.readdir(resolve(p), { withFileTypes: true })).map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory()
      })),
    read: (p) => fs.readFile(resolve(p), 'utf-8'),
    listFilesRecursive: async (p) => {
      const start = resolve(p)
      const files: string[] = []
      const walk = async (dir: string): Promise<void> => {
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
          if (IGNORED_DIRS.has(e.name)) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) await walk(full)
          else if (e.isFile()) files.push(rel(full))
        }
      }
      if ((await fs.stat(start)).isDirectory()) await walk(start)
      else files.push(rel(start))
      return files
    },
    exists: async (p) => {
      try {
        await fs.access(resolve(p))
        return true
      } catch {
        return false
      }
    },
    write: async (p, content) => {
      const abs = resolve(p)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, content, 'utf-8')
    },
    remove: async (p) => {
      const abs = resolve(p)
      if (abs === normRoot) throw new Error('Refusing to delete the workspace root.')
      const stat = await fs.stat(abs)
      if (stat.isDirectory()) await fs.rm(abs, { recursive: true })
      else await fs.unlink(abs)
    }
  }
}
