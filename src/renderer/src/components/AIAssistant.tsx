/**
 * AIAssistant — Studio AI agent panel.
 *
 * Talks to the agent: sends a prompt, streams the reply, shows each tool call as
 * it happens, and surfaces an Allow/Deny dialog whenever the agent wants to
 * write, edit, or delete a file. On desktop the agent runs in the main process
 * and the Anthropic API key is stored (encrypted) there; in the web build the
 * same agent runs in the page with the key kept in browser storage.
 */

import {
  refreshFileContentFromDisk,
  selectOpenFiles,
  useAppDispatch,
  useAppSelector
} from '@renderer/redux'
import { updateReadmeContent } from '@renderer/redux/fileSlice'
import type { AgentEvent, AgentPermissionRequest } from '@renderer/lib/agentTypes'
import { fileSystem } from '@renderer/lib/fileSystem'
import { webAgent, webSettings } from '@renderer/lib/webAgent'
import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import {
  Activity,
  BookOpen,
  CircuitBoard,
  FileEdit,
  FilePlus,
  FileSearch,
  FileX,
  Folder,
  KeyRound,
  Loader2,
  Package,
  Search,
  Send,
  Settings,
  Sparkles,
  Square,
  Trash2
} from 'lucide-react'
import React from 'react'
import { Button } from './ui/Button'
import { Markdown } from './Markdown'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/Dialog'
import { Input } from './ui/Input'
import { ScrollArea } from './ui/ScrollArea'

type TimelineItem =
  | { kind: 'user'; text: string }
  | { kind: 'ai'; text: string }
  | { kind: 'tool'; id: string; name: string; summary: string; ok: boolean; running: boolean }
  | { kind: 'error'; text: string }

const GREETING =
  "I'm Studio AI ✦ — I can read and edit the files in your open workspace. Ask me to explain code, wire a circuit, fix a build error, or write a sketch. I'll ask before changing any file."

// Desktop: the agent runs in the Electron main process, reached via the preload
// bridge, so the API key never enters the renderer. Web: there is no main
// process, so the same agent core runs in the page (lib/webAgent.ts).
const isDesktop = typeof window !== 'undefined' && window.api != null
const agent = isDesktop ? window.api.agent : webAgent
const settings = isDesktop ? window.api.settings : webSettings

const openExternal = (url: string): void => {
  if (isDesktop) void window.api.fs.openExternal(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}

const TOOL_ICON: Record<string, React.ReactNode> = {
  list_dir: <Folder size={13} />,
  read_file: <FileSearch size={13} />,
  grep: <Search size={13} />,
  write_file: <FilePlus size={13} />,
  edit_file: <FileEdit size={13} />,
  delete_file: <FileX size={13} />,
  read_guide: <BookOpen size={13} />,
  inspect_circuit: <CircuitBoard size={13} />,
  find_parts: <Package size={13} />,
  read_serial: <Activity size={13} />
}

export function AIAssistant(): React.JSX.Element {
  const dispatch = useAppDispatch()
  const workspace = useAppSelector((s) => s.file.workspace)
  const viewingFileId = useAppSelector((s) => s.file.viewingFileId)
  const editorView = useAppSelector((s) => s.editor.editorView)
  const openFiles = useAppSelector(selectOpenFiles)
  const { selectedBoard, lastCompileResult } = useArduinoContext()

  const [items, setItems] = React.useState<TimelineItem[]>([])
  const [input, setInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [keyConfigured, setKeyConfigured] = React.useState<boolean | null>(null)
  const [showSettings, setShowSettings] = React.useState(false)
  const [permission, setPermission] = React.useState<AgentPermissionRequest | null>(null)

  const scrollRef = React.useRef<HTMLDivElement>(null)
  // Latest open files, read inside the agent callback without re-subscribing.
  const openFilesRef = React.useRef(openFiles)
  openFilesRef.current = openFiles

  // Check whether an API key is configured.
  React.useEffect(() => {
    settings.getStatus().then((s) => setKeyConfigured(s.configured))
  }, [])

  // Subscribe to the agent's streamed events.
  React.useEffect(() => {
    const off = agent.onEvent((evt: AgentEvent) => {
      setItems((prev) => applyEvent(prev, evt))
      if (evt.type === 'done' || evt.type === 'error') setBusy(false)
    })
    return off
  }, [])

  // Surface permission prompts.
  React.useEffect(() => {
    return agent.onPermissionRequest((req) => setPermission(req))
  }, [])

  // When the agent changes a file that's open in the editor, reload it from disk.
  React.useEffect(() => {
    return agent.onFileChanged(({ path }) => {
      const norm = path.replace(/\\/g, '/')
      const match = openFilesRef.current.find((f) => f.path.replace(/\\/g, '/') === norm)
      if (match) {
        fileSystem
          .readFile(match.path)
          .then((content) => dispatch(refreshFileContentFromDisk({ id: match.id, content })))
      }
      // Keep the Documentation tab live when the agent rewrites the README —
      // it reads from readmeContent, which otherwise only updates on a manual edit.
      if (/(^|\/)README\.md$/i.test(norm)) {
        fileSystem
          .readFile(path)
          .then((content) => dispatch(updateReadmeContent(content)))
          .catch((e) => console.error('Failed to refresh README:', e))
      }
    })
  }, [dispatch])

  React.useEffect(() => {
    const el = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (el) el.scrollTop = el.scrollHeight
  }, [items, busy])

  const send = (): void => {
    const text = input.trim()
    if (!text || busy) return
    if (!keyConfigured) {
      setShowSettings(true)
      return
    }
    setInput('')
    setItems((prev) => [...prev, { kind: 'user', text }])
    setBusy(true)
    const viewing = openFiles.find((f) => f.id === viewingFileId)
    agent.send({
      text,
      workspaceRoot: workspace?.path ?? null,
      context: {
        board: selectedBoard?.config.name,
        view: editorView,
        openFile: viewing?.name,
        lastError:
          lastCompileResult && !lastCompileResult.success ? lastCompileResult.output : undefined
      }
    })
  }

  const stop = (): void => {
    agent.abort()
    setBusy(false)
  }

  const newChat = (): void => {
    agent.reset()
    setItems([])
  }

  const respond = (allow: boolean): void => {
    if (permission) agent.respondPermission(permission.id, allow)
    setPermission(null)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Slim toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-navy-600 text-xs text-fg-3">
        <Sparkles size={13} className="text-pink" />
        <span className="font-medium text-fg-2">Claude Opus 4.8</span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-fg-3 hover:text-fg-1"
          title="New chat"
          onClick={newChat}
        >
          <Trash2 size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-fg-3 hover:text-fg-1"
          title="AI settings"
          onClick={() => setShowSettings(true)}
        >
          <Settings size={14} />
        </Button>
      </div>

      <ScrollArea ref={scrollRef} className="flex-1 min-h-0">
        <div className="flex flex-col gap-3 p-4">
          <AiBubble text={GREETING} />
          {keyConfigured === false && (
            <button
              onClick={() => setShowSettings(true)}
              className="self-start flex items-center gap-2 rounded-lg border border-pink/40 bg-navy-600 px-3 py-2 text-xs text-fg-2 hover:border-pink"
            >
              <KeyRound size={14} className="text-pink" /> Add your Anthropic API key to get started
            </button>
          )}
          {items.map((it, i) => (
            <TimelineRow key={i} item={it} />
          ))}
          {busy && (
            <div className="self-start flex items-center gap-2 text-fg-3 text-xs px-2">
              <Loader2 size={14} className="text-pink animate-spin" /> Working…
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="w-full border-t border-navy-600 p-3 flex gap-2">
        <input
          className="flex-1 bg-navy-900 border border-navy-400 rounded-lg px-3 py-2 text-sm text-fg-1 placeholder:text-fg-4 outline-none focus:border-cyan"
          placeholder={
            workspace
              ? 'Ask Studio AI to edit your project…'
              : 'Open a workspace to let AI edit files…'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        {busy ? (
          <button className="px-3 rounded-lg bg-navy-500 text-fg-1" onClick={stop} title="Stop">
            <Square size={16} />
          </button>
        ) : (
          <button
            className="px-3 rounded-lg bg-[var(--purple)] text-white disabled:opacity-50"
            onClick={send}
            disabled={!input.trim()}
          >
            <Send size={16} />
          </button>
        )}
      </div>

      <SettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        configured={!!keyConfigured}
        onSaved={() => setKeyConfigured(true)}
        onCleared={() => setKeyConfigured(false)}
      />
      <PermissionDialog request={permission} onRespond={respond} />
    </div>
  )
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

function TimelineRow({ item }: { item: TimelineItem }): React.JSX.Element {
  if (item.kind === 'user') return <UserBubble text={item.text} />
  if (item.kind === 'ai') return <AiBubble text={item.text} />
  if (item.kind === 'error')
    return (
      <div className="self-start rounded-lg border border-red-500/50 bg-red-500/10 text-red-300 text-xs px-3 py-2">
        {item.text}
      </div>
    )
  // tool chip
  return (
    <div className="self-start flex items-center gap-2 rounded-full border border-navy-400 bg-navy-700 px-3 py-1 text-xs text-fg-3">
      {item.running ? (
        <Loader2 size={13} className="animate-spin text-cyan" />
      ) : (
        (TOOL_ICON[item.name] ?? <Folder size={13} />)
      )}
      <span className={item.ok ? 'text-fg-2' : 'text-red-300'}>
        {item.running ? `${item.name}…` : item.summary || item.name}
      </span>
    </div>
  )
}

function AiBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div
      className="self-start rounded-xl bg-[var(--purple-soft)] text-[var(--purple-on)] py-2 px-4 mr-8 max-w-[90%] text-sm leading-relaxed"
      style={{ border: '1px solid var(--purple)' }}
    >
      <Markdown>{text}</Markdown>
    </div>
  )
}

function UserBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="self-end rounded-xl border border-[var(--purple-deep)] bg-[var(--purple)] text-white py-2 px-4 ml-8 w-fit text-sm whitespace-pre-wrap">
      {text}
    </div>
  )
}

function PermissionDialog({
  request,
  onRespond
}: {
  request: AgentPermissionRequest | null
  onRespond: (allow: boolean) => void
}): React.JSX.Element {
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onRespond(false)}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {request?.action}: <span className="font-mono text-sm">{request?.path}</span>
          </DialogTitle>
          <DialogDescription>Studio AI wants to change a file in your workspace.</DialogDescription>
        </DialogHeader>
        <pre className="max-h-64 overflow-auto rounded-[var(--radius-md)] bg-[var(--bg-sunken)] border-[1.5px] border-[var(--border-soft)] p-3 font-mono text-xs text-[var(--text-body)] whitespace-pre-wrap">
          {request?.preview}
        </pre>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onRespond(false)}>
            Deny
          </Button>
          <Button onClick={() => onRespond(true)}>Allow</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SettingsDialog({
  open,
  onOpenChange,
  configured,
  onSaved,
  onCleared
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  configured: boolean
  onSaved: () => void
  onCleared: () => void
}): React.JSX.Element {
  const [key, setKey] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const save = async (): Promise<void> => {
    if (!key.trim()) return
    setSaving(true)
    try {
      await settings.setApiKey(key.trim())
    } finally {
      setSaving(false)
    }
    setKey('')
    onSaved()
    onOpenChange(false)
  }

  const clear = async (): Promise<void> => {
    await settings.clearApiKey()
    onCleared()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Studio AI settings</DialogTitle>
          <DialogDescription>
            {isDesktop
              ? 'Your Anthropic API key is stored encrypted on this device and is only used by the main process — it never leaves your machine except to call the Anthropic API.'
              : "Your Anthropic API key is saved in this browser and is only sent to the Anthropic API. Anyone who can use this browser profile can read it, so remove it when you're done on a shared computer."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <label className="text-xs text-[var(--text-muted)]">
            API key{' '}
            {configured && <span className="text-[var(--status-ok)]">· a key is configured</span>}
          </label>
          <Input
            type="password"
            placeholder="sk-ant-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <a
            className="text-xs text-[var(--brand)] hover:underline cursor-pointer"
            onClick={() => openExternal('https://console.anthropic.com/settings/keys')}
          >
            Get an API key →
          </a>
        </div>
        <DialogFooter>
          {configured && (
            <Button variant="ghost" onClick={clear}>
              Remove key
            </Button>
          )}
          <Button onClick={save} disabled={!key.trim() || saving}>
            {saving ? 'Saving…' : 'Save key'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
