/**
 * agentCore: the platform-neutral "brain" behind the Studio AI tab.
 *
 * Holds the conversation, runs the agentic tool loop against Claude, executes a
 * small set of workspace-scoped file tools, and gates every mutating tool
 * (write/edit/delete) behind a permission prompt. It knows nothing about where
 * it runs: the host supplies the API key, file access, and the channel back to
 * the UI:
 *
 *   - Desktop: src/main/AgentService.ts (Node fs, key in safeStorage, IPC).
 *   - Web:     src/renderer/src/lib/webAgent.ts (File System Access / mem://)
 *              workspaces, key in localStorage, calls the API from the page.
 */

import type Anthropic from '@anthropic-ai/sdk'
import type {
  ContentBlockParam,
  ImageBlockParam,
  MessageParam,
  TextBlockParam,
  Tool,
  ToolUseBlock
} from '@anthropic-ai/sdk/resources/messages'
import { GUIDE_IDS, type GuideId } from './agentGuides/catalog'
import { thinkingOptionsFor, type AgentModelId } from './agentModels'
import { STUDIO_SYSTEM_PROMPT } from './agentPrompt'

const MAX_TOKENS = 16000
const MAX_TURNS = 50 // hard stop on the tool loop, in case the model never settles
const MAX_TOOL_OUTPUT = 60000 // chars returned to the model from a single tool
const MAX_GREP_HITS = 100
const DEFAULT_SERIAL_LINES = 40

/** Folders the tools never descend into. */
export const IGNORED_DIRS = new Set(['node_modules', '.git'])

export interface AgentSendArgs {
  text: string
  workspaceRoot: string | null
  context?: {
    board?: string
    openFile?: string
    lastError?: string
    /** The editor view the user is in. */
    view?: 'code' | 'circuit' | 'visual'
  }
}

/** Events streamed to the UI. */
export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; message: string }

export interface AgentPermissionRequest {
  id: string
  tool: string
  action: string
  path: string
  preview: string
}

/**
 * File access for one open workspace. Paths are exactly what the model passed
 * (normally workspace-relative); each implementation resolves them and must
 * throw for anything that escapes the workspace.
 */
export interface AgentWorkspace {
  /** Shown to the model as the workspace root. */
  label: string
  /** The path the rest of the app uses for this file (for change notifications). */
  absolute(p: string): string
  list(p: string): Promise<{ name: string; isDirectory: boolean }[]>
  read(p: string): Promise<string>
  /** Every file under `p`, as workspace-relative paths; `[p]` when `p` is a file. */
  listFilesRecursive(p: string): Promise<string[]>
  exists(p: string): Promise<boolean>
  /** Write a file, creating parent folders as needed. */
  write(p: string, content: string): Promise<void>
  /** Delete a file or folder. Must refuse the workspace root itself. */
  remove(p: string): Promise<void>
}

/**
 * Live app state only the renderer holds: the parts registry (needed to work out
 * breadboard seating) and the serial buffer. The web host calls the renderer
 * directly; the desktop host round-trips over IPC (lib/studioBridge.ts).
 */
export interface StudioBridge {
  /** Parts, connections and tinyCore GPIOs for circuit file text (v2 or v1). */
  inspectCircuit(text: string): Promise<string>
  /** Library part types matching a query, with their pin names. */
  findParts(query: string): Promise<string>
  /** The most recent `count` serial lines. */
  readSerial(count: number): Promise<string>
}

export type StudioMethod = keyof StudioBridge

export interface AgentHost {
  getApiKey(): Promise<string | null>
  /** The model the user picked in the Studio AI settings (agentModels.ts). */
  getModel(): Promise<AgentModelId>
  /** Build the API client; the web host opts into browser mode here. */
  createClient(apiKey: string): Anthropic
  /** The workspace a request targets, or null when none is open. */
  openWorkspace(root: string | null): AgentWorkspace | null
  emit(evt: AgentEvent): void
  /** Show a permission prompt. Return false if there is no UI to ask. */
  requestPermission(req: AgentPermissionRequest): boolean
  fileChanged(absolutePath: string): void
  /** Live app state for inspect_circuit / find_parts / read_serial. */
  studio?: StudioBridge
}

type ToolResultContent = TextBlockParam | ImageBlockParam
type ToolResult = { content: string | ToolResultContent[]; isError: boolean; summary: string }

export class AgentSession {
  private host: AgentHost
  private conversation: MessageParam[] = []
  private pendingPermissions = new Map<string, (allow: boolean) => void>()
  private stream: { abort(): void } | null = null
  private nextPermissionId = 1
  private aborted = false
  private running = false

  constructor(host: AgentHost) {
    this.host = host
  }

  reset(): void {
    this.conversation = []
    this.aborted = false
  }

  abort(): void {
    this.aborted = true
    // Stop the in-flight response rather than paying for tokens nobody will see.
    this.stream?.abort()
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

  async send(args: AgentSendArgs): Promise<void> {
    const { host } = this
    if (this.running) {
      host.emit({ type: 'error', message: 'The agent is already working on a request.' })
      return
    }
    const apiKey = await host.getApiKey()
    if (!apiKey) {
      host.emit({
        type: 'error',
        message: 'No Anthropic API key configured. Add one in the AI settings.'
      })
      return
    }

    this.running = true
    this.aborted = false
    const client = host.createClient(apiKey)
    const model = await host.getModel()
    const workspace = host.openWorkspace(args.workspaceRoot)
    this.conversation.push({ role: 'user', content: args.text })

    const system = buildSystem(args, workspace)

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        if (this.aborted) {
          host.emit({ type: 'done', stopReason: 'aborted' })
          return
        }

        const stream = client.messages.stream({
          model,
          max_tokens: MAX_TOKENS,
          system,
          messages: this.conversation,
          tools: TOOLS,
          ...thinkingOptionsFor(model, MAX_TOKENS)
        })
        this.stream = stream

        stream.on('text', (delta) => {
          if (!this.aborted) host.emit({ type: 'text_delta', text: delta })
        })

        const message = await stream.finalMessage().finally(() => {
          this.stream = null
        })
        this.conversation.push({ role: 'assistant', content: message.content })

        if (message.stop_reason !== 'tool_use') {
          host.emit({ type: 'done', stopReason: message.stop_reason ?? 'end_turn' })
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
          host.emit({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
          const r = await this.execTool(tu.name, tu.input, workspace)
          host.emit({
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
      host.emit({ type: 'done', stopReason: 'max_turns' })
    } catch (err) {
      // Stop aborts the stream mid-response, which surfaces here as an error.
      if (this.aborted) host.emit({ type: 'done', stopReason: 'aborted' })
      else host.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      this.running = false
    }
  }

  // --- Tool execution -------------------------------------------------------

  private async execTool(
    name: string,
    rawInput: unknown,
    ws: AgentWorkspace | null
  ): Promise<ToolResult> {
    const input = (rawInput ?? {}) as Record<string, unknown>
    const { studio } = this.host
    try {
      // Tools that don't touch the workspace.
      switch (name) {
        case 'read_guide':
          return await readGuide(reqStr(input.topic, 'topic'))
        case 'find_parts': {
          if (!studio) return err(NO_STUDIO)
          const query = reqStr(input.query, 'query')
          return ok(await studio.findParts(query), `searched parts for "${query}"`)
        }
        case 'read_serial': {
          if (!studio) return err(NO_STUDIO)
          const count = typeof input.lines === 'number' ? input.lines : DEFAULT_SERIAL_LINES
          return ok(await studio.readSerial(count), 'read serial output')
        }
      }

      if (!ws) return err('No workspace is open, so file tools cannot run.')
      switch (name) {
        case 'inspect_circuit':
          return await inspectCircuit(ws, studio, str(input.path, ''))
        case 'list_dir':
          return await listDir(ws, str(input.path, '.'))
        case 'read_file':
          return await readFile(ws, reqStr(input.path, 'path'))
        case 'grep':
          return await grep(ws, reqStr(input.pattern, 'pattern'), str(input.path, '.'))
        case 'write_file':
          return await this.writeFile(
            ws,
            reqStr(input.path, 'path'),
            reqStr(input.content, 'content')
          )
        case 'edit_file':
          return await this.editFile(
            ws,
            reqStr(input.path, 'path'),
            reqStr(input.old_string, 'old_string'),
            reqStr(input.new_string, 'new_string')
          )
        case 'delete_file':
          return await this.deleteFile(ws, reqStr(input.path, 'path'))
        default:
          return err(`Unknown tool: ${name}`)
      }
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }

  private async writeFile(ws: AgentWorkspace, p: string, content: string): Promise<ToolResult> {
    const exists = await ws.exists(p)
    const preview = content.length > 1200 ? content.slice(0, 1200) + '\n…' : content
    const allowed = await this.requestPermission({
      tool: 'write_file',
      action: exists ? 'Overwrite file' : 'Create file',
      path: p,
      preview
    })
    if (!allowed) return err(`User denied writing ${p}.`)
    await ws.write(p, content)
    this.host.fileChanged(ws.absolute(p))
    return ok(`Wrote ${content.length} characters to ${p}.`, `wrote ${p}`)
  }

  private async editFile(
    ws: AgentWorkspace,
    p: string,
    oldStr: string,
    newStr: string
  ): Promise<ToolResult> {
    const original = await ws.read(p)
    const occurrences = original.split(oldStr).length - 1
    if (occurrences === 0) {
      return err(`old_string not found in ${p}. Read the file again and match exactly.`)
    }
    if (occurrences > 1) {
      return err(
        `old_string appears ${occurrences} times in ${p}; include more surrounding context so it is unique.`
      )
    }
    const allowed = await this.requestPermission({
      tool: 'edit_file',
      action: 'Edit file',
      path: p,
      preview: `- ${truncate(oldStr, 600)}\n+ ${truncate(newStr, 600)}`
    })
    if (!allowed) return err(`User denied editing ${p}.`)
    // Function replacer: a string replacement would expand `$&`, `$1`, … in code.
    await ws.write(
      p,
      original.replace(oldStr, () => newStr)
    )
    this.host.fileChanged(ws.absolute(p))
    return ok(`Applied edit to ${p}.`, `edited ${p}`)
  }

  private async deleteFile(ws: AgentWorkspace, p: string): Promise<ToolResult> {
    const allowed = await this.requestPermission({
      tool: 'delete_file',
      action: 'Delete',
      path: p,
      preview: `This will permanently delete ${p}.`
    })
    if (!allowed) return err(`User denied deleting ${p}.`)
    await ws.remove(p)
    this.host.fileChanged(ws.absolute(p))
    return ok(`Deleted ${p}.`, `deleted ${p}`)
  }

  private requestPermission(details: Omit<AgentPermissionRequest, 'id'>): Promise<boolean> {
    const id = `perm-${this.nextPermissionId++}`
    return new Promise<boolean>((resolve) => {
      this.pendingPermissions.set(id, resolve)
      if (!this.host.requestPermission({ id, ...details })) {
        this.pendingPermissions.delete(id)
        resolve(false)
      }
    })
  }
}

function buildSystem(args: AgentSendArgs, ws: AgentWorkspace | null): TextBlockParam[] {
  const lines = ['## Current context']
  lines.push(`Workspace root: ${ws?.label ?? '(no workspace open)'}`)
  if (args.context?.board) lines.push(`Selected board: ${args.context.board}`)
  if (args.context?.view) lines.push(`Editor view: ${args.context.view}`)
  if (args.context?.openFile) lines.push(`File the user is viewing: ${args.context.openFile}`)
  if (args.context?.lastError) {
    lines.push(`Last build error:\n${args.context.lastError.split('\n').slice(0, 12).join('\n')}`)
  }
  if (!ws) {
    lines.push(
      'No workspace is open, so file tools are unavailable; answer from knowledge and the guides.'
    )
  }
  return [
    // Identical on every request, so it (and the tool definitions before it) is cached.
    { type: 'text', text: STUDIO_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: lines.join('\n') }
  ]
}

// --- tinyStudio tools ---------------------------------------------------------

const NO_STUDIO = 'Live app state is not available in this session.'

async function readGuide(topic: string): Promise<ToolResult> {
  if (!GUIDE_IDS.includes(topic as GuideId)) {
    return err(`Unknown guide "${topic}". Topics: ${GUIDE_IDS.join(', ')}.`)
  }
  // Lazy: the guides carry base64 screenshots, so they load on first use.
  const { loadGuide } = await import('./agentGuides/index.js')
  const guide = loadGuide(topic as GuideId)
  const content: ToolResultContent[] = [{ type: 'text', text: guide.markdown }]
  for (const img of guide.images) {
    content.push({ type: 'text', text: `Screenshot: ${img.caption}` })
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data }
    })
  }
  return { content, isError: false, summary: `read the ${topic} guide` }
}

async function inspectCircuit(
  ws: AgentWorkspace,
  studio: StudioBridge | undefined,
  p: string
): Promise<ToolResult> {
  if (!studio) return err(NO_STUDIO)
  let file = p
  if (!file) {
    if (await ws.exists('circuit.json')) file = 'circuit.json'
    else if (await ws.exists('diagram.json')) file = 'diagram.json'
    else {
      return ok(
        'This project has no circuit.json (or v1 diagram.json) yet. The Circuit view creates one the first time it opens.',
        'no circuit file'
      )
    }
  }
  return ok(await studio.inspectCircuit(await ws.read(file)), `inspected ${file}`)
}

// --- Read-only tools ----------------------------------------------------------

async function listDir(ws: AgentWorkspace, p: string): Promise<ToolResult> {
  const lines = (await ws.list(p))
    .filter((e) => !IGNORED_DIRS.has(e.name))
    .map((e) => (e.isDirectory ? `${e.name}/` : e.name))
    .sort()
  return ok(lines.join('\n') || '(empty directory)', `listed ${lines.length} items in ${p}`)
}

async function readFile(ws: AgentWorkspace, p: string): Promise<ToolResult> {
  let content = await ws.read(p)
  let note = ''
  if (content.length > MAX_TOOL_OUTPUT) {
    content = content.slice(0, MAX_TOOL_OUTPUT)
    note = `\n\n[truncated to ${MAX_TOOL_OUTPUT} characters]`
  }
  return ok(content + note, `read ${p}`)
}

async function grep(ws: AgentWorkspace, pattern: string, p: string): Promise<ToolResult> {
  let re: RegExp
  try {
    re = new RegExp(pattern, 'i')
  } catch {
    return err(`Invalid regex: ${pattern}`)
  }
  const hits: string[] = []
  for (const file of await ws.listFilesRecursive(p)) {
    if (hits.length >= MAX_GREP_HITS) break
    if (file.split('/').some((seg) => IGNORED_DIRS.has(seg))) continue
    let text: string
    try {
      text = await ws.read(file)
    } catch {
      continue // skip binary / unreadable
    }
    text.split('\n').forEach((line, i) => {
      if (hits.length < MAX_GREP_HITS && re.test(line)) {
        hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 200)}`)
      }
    })
  }
  return ok(
    hits.join('\n') || `No matches for /${pattern}/`,
    `${hits.length} match${hits.length === 1 ? '' : 'es'} for "${pattern}"`
  )
}

// --- Tool definitions sent to the model -------------------------------------

const TOOLS: Tool[] = [
  {
    name: 'read_guide',
    description:
      'Read a tinyStudio reference guide (markdown, some with screenshots). Read the relevant guide the first time a task involves visual.js, tinyCore pins or hardware, serial formats, circuit.json, or how the app works.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', enum: GUIDE_IDS, description: 'The guide to read.' }
      },
      required: ['topic']
    }
  },
  {
    name: 'inspect_circuit',
    description:
      "Summarize the project's circuit: its parts, every connection (including parts seated in breadboard holes, which the file itself doesn't list), and the tinyCore GPIO each part is wired to. Use before writing or checking pin constants.",
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Circuit file relative to the workspace root. Defaults to circuit.json, then diagram.json.'
        }
      }
    }
  },
  {
    name: 'find_parts',
    description:
      'Search the parts library by name, type, or category (e.g. "led", "button", "servo"). Returns part types and their pin names, for use in circuit.json.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Words to match.' } },
      required: ['query']
    }
  },
  {
    name: 'read_serial',
    description:
      'Read the most recent lines the board printed over serial: exactly what visual.js receives. Empty if no board is connected or nothing has been printed since the app opened.',
    input_schema: {
      type: 'object',
      properties: {
        lines: { type: 'number', description: 'How many recent lines, 1–300. Defaults to 40.' }
      }
    }
  },
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
