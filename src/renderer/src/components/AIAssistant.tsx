/**
 * AIAssistant: Studio AI agent panel.
 *
 * Sends prompts, streams the reply, shows each tool call as it happens, and
 * surfaces an Allow/Deny dialog whenever the agent wants to write, edit, or
 * delete a file. The conversation lives in lib/agentChat, so it survives this
 * panel closing. On desktop the agent runs in the main process and the Anthropic
 * API key is stored (encrypted) there; in the web build the same agent runs in
 * the page with the key kept in browser storage.
 */

import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import {
  agentSettings as settings,
  getChatState,
  isDesktopAgent as isDesktop,
  respondToPermission,
  sendToAgent,
  startNewChat,
  stopAgent,
  subscribeChat,
  type TimelineItem
} from '@renderer/lib/agentChat'
import type { AgentPermissionRequest } from '@renderer/lib/agentTypes'
import { AGENT_MODELS, DEFAULT_AGENT_MODEL } from '../../../shared/agentModels'
import { openExternal } from '@renderer/lib/utils'
import { selectOpenFiles, useAppSelector } from '@renderer/redux'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select'

const GREETING =
  "I'm Studio AI ✦. I can read and edit the files in your open workspace. Ask me to explain code, wire a circuit, fix a build error, or write a sketch. I'll ask before changing any file."

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
  const workspace = useAppSelector((s) => s.file.workspace)
  const viewingFileId = useAppSelector((s) => s.file.viewingFileId)
  const editorView = useAppSelector((s) => s.editor.editorView)
  const openFiles = useAppSelector(selectOpenFiles)
  const { selectedBoard, lastCompileResult } = useArduinoContext()
  const { items, busy, permission } = React.useSyncExternalStore(subscribeChat, getChatState)

  const [input, setInput] = React.useState('')
  const [keyConfigured, setKeyConfigured] = React.useState<boolean | null>(null)
  const [showSettings, setShowSettings] = React.useState(false)
  const [model, setModel] = React.useState<string>(DEFAULT_AGENT_MODEL)

  const scrollRef = React.useRef<HTMLDivElement>(null)

  // Check whether an API key is configured, and which model was chosen.
  React.useEffect(() => {
    settings.getStatus().then((s) => setKeyConfigured(s.configured))
    settings.getModel().then(setModel)
  }, [])

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
    const viewing = openFiles.find((f) => f.id === viewingFileId)
    sendToAgent({
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

  return (
    <div className="h-full flex flex-col">
      {/* Slim toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--border-default)] text-xs text-[var(--text-muted)]">
        <Sparkles size={13} className="text-[var(--brand)]" />
        <span className="font-medium text-[var(--text-body)]">
          Claude {AGENT_MODELS.find((m) => m.id === model)?.label ?? model}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-[var(--text-muted)] hover:text-[var(--text-strong)]"
          title="New chat"
          onClick={startNewChat}
        >
          <Trash2 size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-[var(--text-muted)] hover:text-[var(--text-strong)]"
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
              className="self-start flex items-center gap-2 rounded-lg border border-[var(--brand)]/40 bg-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-body)] hover:border-[var(--brand)]"
            >
              <KeyRound size={14} className="text-[var(--brand)]" /> Add your Anthropic API key to
              get started
            </button>
          )}
          {items.map((it, i) => (
            <TimelineRow key={i} item={it} />
          ))}
          {busy && (
            <div className="self-start flex items-center gap-2 text-[var(--text-muted)] text-xs px-2">
              <Loader2 size={14} className="text-[var(--brand)] animate-spin" /> Working…
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="w-full border-t border-[var(--border-default)] p-3 flex gap-2">
        <input
          className="flex-1 bg-[var(--bg-raised)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--brand)]"
          placeholder={
            workspace
              ? 'Ask Studio AI to edit your project…'
              : 'Open a project to let Studio AI edit files…'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        {busy ? (
          <button
            className="px-3 rounded-lg bg-[var(--bg-sunken)] text-[var(--text-strong)]"
            onClick={stopAgent}
            title="Stop"
          >
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
        model={model}
        onModelChange={setModel}
        configured={!!keyConfigured}
        onSaved={() => setKeyConfigured(true)}
        onCleared={() => setKeyConfigured(false)}
      />
      <PermissionDialog request={permission} onRespond={respondToPermission} />
    </div>
  )
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
    <div className="self-start flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-1 text-xs text-[var(--text-muted)]">
      {item.running ? (
        <Loader2 size={13} className="animate-spin text-[var(--brand)]" />
      ) : (
        (TOOL_ICON[item.name] ?? <Folder size={13} />)
      )}
      <span className={item.ok ? 'text-[var(--text-body)]' : 'text-red-300'}>
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
  model,
  onModelChange,
  onSaved,
  onCleared
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  configured: boolean
  model: string
  onModelChange: (model: string) => void
  onSaved: () => void
  onCleared: () => void
}): React.JSX.Element {
  const [key, setKey] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  // Applies at once. The conversation so far was produced by the previous
  // model, so a chat in progress starts over rather than mixing models.
  const changeModel = async (next: string): Promise<void> => {
    if (next === model) return
    onModelChange(next)
    await settings.setModel(next)
    if (getChatState().items.length > 0) startNewChat()
  }

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
              ? 'Your Anthropic API key is stored encrypted on this device and is only used by the main process; it never leaves your machine except to call the Anthropic API.'
              : "Your Anthropic API key is saved in this browser and is only sent to the Anthropic API. Anyone who can use this browser profile can read it, so remove it when you're done on a shared computer."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <label className="text-xs text-[var(--text-muted)]">Model</label>
          <Select value={model} onValueChange={(v) => void changeModel(v)}>
            <SelectTrigger size="sm" aria-label="Model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGENT_MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label} · {m.note}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-[var(--text-muted)]">Changing the model starts a new chat.</p>
        </div>
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
