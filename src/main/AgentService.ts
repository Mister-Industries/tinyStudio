/**
 * AgentService — the "brain" behind the Studio AI tab.
 *
 * Runs entirely in the main (Node) process so the API key never reaches the
 * renderer bundle. It holds the conversation, runs the agentic tool loop against
 * Claude, executes a small set of workspace-scoped filesystem tools, and gates
 * every mutating tool (write/edit/delete) behind a renderer permission prompt.
 *
 * Communication with the renderer:
 *   - main → renderer  'agent:event'              streamed text / tool activity / done / error
 *   - main → renderer  'agent:permission-request' { id, ... } — awaits a response
 *   - main → renderer  'agent:file-changed'       { path } — so open editors can refresh
 *   - renderer → main  agent:send / agent:abort / agent:reset / agent:permission-response
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  ContentBlockParam,
  MessageParam,
  Tool,
  ToolUseBlock
} from '@anthropic-ai/sdk/resources/messages'
import { BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { getApiKey } from './settings'

const MODEL = 'claude-opus-4-8'
const MAX_TOKENS = 16000
const MAX_TURNS = 50 // hard stop on the tool loop, in case the model never settles
const MAX_TOOL_OUTPUT = 60000 // chars returned to the model from a single tool

export interface AgentSendArgs {
  text: string
  workspaceRoot: string | null
  context?: { board?: string; openFile?: string; lastError?: string }
}

/** Events streamed to the renderer over 'agent:event'. */
export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; message: string }

type ToolResult = { content: string; isError: boolean; summary: string }

const SYSTEM_BASE = `You are Studio AI, the built-in coding agent for tinyStudio — an IDE for the tinyCore (ESP32-S3) board, used with Arduino sketches (.ino), p5/JS visualizations, and circuit diagrams.

You can read, search, and edit files in the user's open workspace using your tools. Be a capable pair-programmer:
- Read before you write. Inspect the relevant files first; never guess at file contents.
- Make the smallest change that satisfies the request. Don't refactor or add abstractions that weren't asked for.
- Prefer edit_file (a targeted replacement) over rewriting a whole file with write_file.
- All paths you pass to tools are relative to the workspace root.
- Writes, edits, and deletes require the user's approval — a prompt appears for each. If the user denies one, adapt rather than retrying the same change.
- Keep chat replies concise. Explain what you changed and why, not every step.`

export class AgentService {
  private window: BrowserWindow | null = null
  private conversation: MessageParam[] = []
  private pendingPermissions = new Map<string, (allow: boolean) => void>()
  private aborted = false
  private running = false

  setWindow(win: BrowserWindow): void {
    this.window = win
  }

  reset(): void {
    this.conversation = []
    this.aborted = false
  }

  abort(): void {
    this.aborted = true
    // Auto-deny anything currently waiting on the user so the loop can unwind.
    for (const resolve of this.pendingPermissions.values()) resolve(false)
    this.pendingPermissions.clear()
  }

  resolvePermission(id: string, allow: boolean): void {
    const resolve = this.pendingPermissions.get(id)
    if (resolve) {
      this.pendingPermissions.delete(id)
      resolve(allow)
    }
  }

  private emit(evt: AgentEvent): void {
    this.window?.webContents.send('agent:event', evt)
  }

  async send(args: AgentSendArgs): Promise<void> {
    if (this.running) {
      this.emit({ type: 'error', message: 'The agent is already working on a request.' })
      return
    }
    const apiKey = await getApiKey()
    if (!apiKey) {
      this.emit({
        type: 'error',
        message: 'No Anthropic API key configured. Add one in the AI settings.'
      })
      return
    }

    this.running = true
    this.aborted = false
    const client = new Anthropic({ apiKey })
    this.conversation.push({ role: 'user', content: args.text })

    const system = this.buildSystem(args)

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        if (this.aborted) {
          this.emit({ type: 'done', stopReason: 'aborted' })
          return
        }

        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages: this.conversation,
          tools: TOOLS,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'high' }
        })

        stream.on('text', (delta) => {
          if (!this.aborted) this.emit({ type: 'text_delta', text: delta })
        })

        const message = await stream.finalMessage()
        this.conversation.push({ role: 'assistant', content: message.content })

        if (message.stop_reason !== 'tool_use') {
          this.emit({ type: 'done', stopReason: message.stop_reason ?? 'end_turn' })
          return
        }

        const toolUses = message.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
        const results: ContentBlockParam[] = []
        for (const tu of toolUses) {
          if (this.aborted) {
            results.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: 'Cancelled by the user.',
              is_error: true
            })
            continue
          }
          this.emit({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
          const r = await this.execTool(tu.name, tu.input, args.workspaceRoot)
          this.emit({
            type: 'tool_result',
            id: tu.id,
            name: tu.name,
            ok: !r.isError,
            summary: r.summary
          })
          results.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: r.content,
            is_error: r.isError
          })
        }
        this.conversation.push({ role: 'user', content: results })
      }
      this.emit({ type: 'done', stopReason: 'max_turns' })
    } catch (err) {
      this.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      this.running = false
    }
  }

  private buildSystem(args: AgentSendArgs): string {
    const lines = [SYSTEM_BASE, '', '## Current context']
    lines.push(`Workspace root: ${args.workspaceRoot ?? '(no workspace open)'}`)
    if (args.context?.board) lines.push(`Selected board: ${args.context.board}`)
    if (args.context?.openFile) lines.push(`File the user is viewing: ${args.context.openFile}`)
    if (args.context?.lastError) {
      lines.push(`Last build error:\n${args.context.lastError.split('\n').slice(0, 12).join('\n')}`)
    }
    if (!args.workspaceRoot) {
      lines.push(
        'No workspace is open, so file tools are unavailable — answer from knowledge only.'
      )
    }
    return lines.join('\n')
  }

  // --- Tool execution -------------------------------------------------------

  private async execTool(
    name: string,
    rawInput: unknown,
    root: string | null
  ): Promise<ToolResult> {
    const input = (rawInput ?? {}) as Record<string, unknown>
    try {
      if (!root) return err('No workspace is open, so file tools cannot run.')
      switch (name) {
        case 'list_dir':
          return await this.listDir(root, str(input.path, '.'))
        case 'read_file':
          return await this.readFile(root, reqStr(input.path, 'path'))
        case 'grep':
          return await this.grep(root, reqStr(input.pattern, 'pattern'), str(input.path, '.'))
        case 'write_file':
          return await this.writeFile(
            root,
            reqStr(input.path, 'path'),
            reqStr(input.content, 'content')
          )
        case 'edit_file':
          return await this.editFile(
            root,
            reqStr(input.path, 'path'),
            reqStr(input.old_string, 'old_string'),
            reqStr(input.new_string, 'new_string')
          )
        case 'delete_file':
          return await this.deleteFile(root, reqStr(input.path, 'path'))
        default:
          return err(`Unknown tool: ${name}`)
      }
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }

  /** Resolve a workspace-relative path, refusing anything that escapes the root. */
  private resolve(root: string, rel: string): string {
    const normRoot = path.resolve(root)
    const abs = path.resolve(normRoot, rel)
    if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
      throw new Error(`Path "${rel}" is outside the workspace and was blocked.`)
    }
    return abs
  }

  private rel(root: string, abs: string): string {
    return path.relative(path.resolve(root), abs).split(path.sep).join('/') || '.'
  }

  private async listDir(root: string, rel: string): Promise<ToolResult> {
    const abs = this.resolve(root, rel)
    const entries = await fs.readdir(abs, { withFileTypes: true })
    const lines = entries
      .filter((e) => e.name !== 'node_modules' && e.name !== '.git')
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort()
    return ok(lines.join('\n') || '(empty directory)', `listed ${lines.length} items in ${rel}`)
  }

  private async readFile(root: string, rel: string): Promise<ToolResult> {
    const abs = this.resolve(root, rel)
    let content = await fs.readFile(abs, 'utf-8')
    let note = ''
    if (content.length > MAX_TOOL_OUTPUT) {
      content = content.slice(0, MAX_TOOL_OUTPUT)
      note = `\n\n[truncated to ${MAX_TOOL_OUTPUT} characters]`
    }
    return ok(content + note, `read ${rel}`)
  }

  private async grep(root: string, pattern: string, rel: string): Promise<ToolResult> {
    const abs = this.resolve(root, rel)
    let re: RegExp
    try {
      re = new RegExp(pattern, 'i')
    } catch {
      return err(`Invalid regex: ${pattern}`)
    }
    const hits: string[] = []
    const MAX_HITS = 100
    const walk = async (dir: string): Promise<void> => {
      if (hits.length >= MAX_HITS) return
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.git') continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          await walk(full)
        } else if (e.isFile()) {
          let text: string
          try {
            text = await fs.readFile(full, 'utf-8')
          } catch {
            continue // skip binary / unreadable
          }
          const fileRel = this.rel(root, full)
          text.split('\n').forEach((line, i) => {
            if (hits.length < MAX_HITS && re.test(line)) {
              hits.push(`${fileRel}:${i + 1}: ${line.trim().slice(0, 200)}`)
            }
          })
        }
        if (hits.length >= MAX_HITS) return
      }
    }
    const stat = await fs.stat(abs)
    await (stat.isDirectory() ? walk(abs) : Promise.resolve())
    return ok(
      hits.join('\n') || `No matches for /${pattern}/`,
      `${hits.length} match${hits.length === 1 ? '' : 'es'} for "${pattern}"`
    )
  }

  private async writeFile(root: string, rel: string, content: string): Promise<ToolResult> {
    const abs = this.resolve(root, rel)
    const exists = await fileExists(abs)
    const preview = content.length > 1200 ? content.slice(0, 1200) + '\n…' : content
    const allowed = await this.requestPermission({
      tool: 'write_file',
      action: exists ? 'Overwrite file' : 'Create file',
      path: rel,
      preview
    })
    if (!allowed) return err(`User denied writing ${rel}.`)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf-8')
    this.window?.webContents.send('agent:file-changed', { path: abs })
    return ok(`Wrote ${content.length} characters to ${rel}.`, `wrote ${rel}`)
  }

  private async editFile(
    root: string,
    rel: string,
    oldStr: string,
    newStr: string
  ): Promise<ToolResult> {
    const abs = this.resolve(root, rel)
    const original = await fs.readFile(abs, 'utf-8')
    const occurrences = original.split(oldStr).length - 1
    if (occurrences === 0) {
      return err(`old_string not found in ${rel}. Read the file again and match exactly.`)
    }
    if (occurrences > 1) {
      return err(
        `old_string appears ${occurrences} times in ${rel}; include more surrounding context so it is unique.`
      )
    }
    const allowed = await this.requestPermission({
      tool: 'edit_file',
      action: 'Edit file',
      path: rel,
      preview: `- ${truncate(oldStr, 600)}\n+ ${truncate(newStr, 600)}`
    })
    if (!allowed) return err(`User denied editing ${rel}.`)
    await fs.writeFile(abs, original.replace(oldStr, newStr), 'utf-8')
    this.window?.webContents.send('agent:file-changed', { path: abs })
    return ok(`Applied edit to ${rel}.`, `edited ${rel}`)
  }

  private async deleteFile(root: string, rel: string): Promise<ToolResult> {
    const abs = this.resolve(root, rel)
    const allowed = await this.requestPermission({
      tool: 'delete_file',
      action: 'Delete',
      path: rel,
      preview: `This will permanently delete ${rel}.`
    })
    if (!allowed) return err(`User denied deleting ${rel}.`)
    const stat = await fs.stat(abs)
    if (stat.isDirectory()) await fs.rm(abs, { recursive: true })
    else await fs.unlink(abs)
    this.window?.webContents.send('agent:file-changed', { path: abs })
    return ok(`Deleted ${rel}.`, `deleted ${rel}`)
  }

  private requestPermission(details: {
    tool: string
    action: string
    path: string
    preview: string
  }): Promise<boolean> {
    if (!this.window) return Promise.resolve(false)
    const id = randomUUID()
    return new Promise<boolean>((resolve) => {
      this.pendingPermissions.set(id, resolve)
      this.window!.webContents.send('agent:permission-request', { id, ...details })
    })
  }
}

// --- Tool definitions sent to the model -------------------------------------

const TOOLS: Tool[] = [
  {
    name: 'list_dir',
    description:
      'List the files and folders in a workspace directory. Use this to explore the project.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to the workspace root. Defaults to "."'
        }
      }
    }
  },
  {
    name: 'read_file',
    description:
      'Read the full contents of a file in the workspace. Always read a file before editing it.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root.' }
      },
      required: ['path']
    }
  },
  {
    name: 'grep',
    description: 'Search the workspace for lines matching a (case-insensitive) regular expression.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression to search for.' },
        path: {
          type: 'string',
          description: 'Directory to search under, relative to root. Defaults to "."'
        }
      },
      required: ['pattern']
    }
  },
  {
    name: 'write_file',
    description:
      'Create a new file or overwrite an existing one with the given content. Requires user approval. Prefer edit_file for small changes to existing files.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root.' },
        content: { type: 'string', description: 'Full file content to write.' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description:
      'Replace exactly one occurrence of old_string with new_string in a file. old_string must match the file exactly (including whitespace) and be unique. Requires user approval.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root.' },
        old_string: {
          type: 'string',
          description: 'The exact text to replace (must be unique in the file).'
        },
        new_string: { type: 'string', description: 'The replacement text.' }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file or folder from the workspace. Requires user approval.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path relative to the workspace root.' } },
      required: ['path']
    }
  }
]

// --- small helpers ----------------------------------------------------------

function ok(content: string, summary: string): ToolResult {
  return { content, isError: false, summary }
}
function err(message: string): ToolResult {
  return { content: message, isError: true, summary: message }
}
function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}
function reqStr(v: unknown, field: string): string {
  if (typeof v !== 'string') throw new Error(`Missing or invalid "${field}".`)
  return v
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
