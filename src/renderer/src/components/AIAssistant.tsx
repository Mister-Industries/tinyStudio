/**
 * AIAssistant — Studio AI chat panel. Runs against a model when
 * window.claude.complete is provided by the host; otherwise falls back to
 * scripted, offline answers so the panel is always usable.
 */

import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import { useAppSelector } from '@renderer/redux'
import { Send, Sparkles } from 'lucide-react'
import React from 'react'
import { ScrollArea } from './ui/ScrollArea'

declare global {
  interface Window {
    claude?: { complete: (args: { messages: { role: string; content: string }[]; system?: string }) => Promise<string> }
  }
}

interface Msg {
  role: 'ai' | 'user'
  text: string
}

const GREETING =
  "I'm Studio AI ✦ — I can explain tinyCore pinouts, help wire your circuit, and read build errors. What are we making?"

// Offline scripted replies, used when no model host is wired up.
function scriptedReply(prompt: string, ctx: { board?: string; lastError?: string }): string {
  const q = prompt.toLowerCase()
  if (/pinout|pin|gpio/.test(q))
    return 'The tinyCore (ESP32-S3) breaks out 3V3, GND, and signal pins SIG, D3, D4, D5 and D9. SIG is the onboard addressable LED; D9 has the user button with INPUT_PULLUP.'
  if (/error|fail|won'?t compile|build/.test(q))
    return ctx.lastError
      ? `Looking at your last build: ${ctx.lastError.split('\n').slice(0, 2).join(' ')} — check that the matching library is installed (Library manager) and the right board is selected.`
      : 'Compile first (Verify) and I can read the build output to explain any errors.'
  if (/blink|led|light/.test(q))
    return 'For a blink: pinMode(LED_BUILTIN, OUTPUT) in setup(), then digitalWrite HIGH/LOW with delay(500) in loop(). On tinyCore the SIG LED is addressable — use the FastLED or Adafruit NeoPixel library for color.'
  if (/upload|flash|port/.test(q))
    return `Pick your board and serial port in the toolbar, then hit Upload. ${ctx.board ? `You're targeting ${ctx.board}.` : 'Plug the board in and press Refresh if no port shows.'}`
  return "I can help with tinyCore code, wiring the circuit, and build errors. Try asking about the pinout, a blink sketch, or paste an error."
}

export function AIAssistant(): React.JSX.Element {
  const { selectedBoard, lastCompileResult } = useArduinoContext()
  const workspaceName = useAppSelector((s) => s.file.workspace?.name)
  const [messages, setMessages] = React.useState<Msg[]>([{ role: 'ai', text: GREETING }])
  const [input, setInput] = React.useState('')
  const [thinking, setThinking] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const el = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, thinking])

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (!text || thinking) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text }])
    setThinking(true)
    const ctx = {
      board: selectedBoard?.config.name,
      lastError: lastCompileResult && !lastCompileResult.success ? lastCompileResult.output : undefined
    }
    try {
      let reply: string
      if (window.claude?.complete) {
        reply = await window.claude.complete({
          system: `You are Studio AI, the assistant inside tinyStudio for the tinyCore ESP32-S3. Project: ${workspaceName || 'untitled'}. Board: ${ctx.board || 'none'}.`,
          messages: [{ role: 'user', content: text }]
        })
      } else {
        await new Promise((r) => setTimeout(r, 350))
        reply = scriptedReply(text, ctx)
      }
      setMessages((m) => [...m, { role: 'ai', text: reply }])
    } catch {
      setMessages((m) => [...m, { role: 'ai', text: scriptedReply(text, ctx) }])
    } finally {
      setThinking(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <ScrollArea ref={scrollRef} className="flex-1 min-h-0">
        <div className="flex flex-col gap-3 p-4">
          {messages.map((m, i) =>
            m.role === 'ai' ? <AiChatBubble key={i} text={m.text} /> : <UserChatBubble key={i} text={m.text} />
          )}
          {thinking && (
            <div className="self-start flex items-center gap-2 text-fg-3 text-xs px-2">
              <Sparkles size={14} className="text-pink animate-pulse" /> Studio AI is thinking…
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="w-full border-t border-navy-600 p-3 flex gap-2">
        <input
          className="flex-1 bg-navy-900 border border-navy-400 rounded-lg px-3 py-2 text-sm text-fg-1 placeholder:text-fg-4 outline-none focus:border-cyan"
          placeholder="Ask about tinyCore code…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button
          className="px-3 rounded-lg bg-cyan text-[var(--fg-on-cyan)] disabled:opacity-50"
          onClick={send}
          disabled={!input.trim() || thinking}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}

export function AiChatBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div
      className="self-start rounded-xl bg-navy-600 text-fg-1 py-2 px-4 mr-8 w-fit text-sm leading-relaxed"
      style={{ border: '1px solid var(--pink-line)' }}
    >
      <p>{text}</p>
    </div>
  )
}

export function UserChatBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="self-end rounded-xl border border-navy-400 bg-navy-700 text-fg-2 py-2 px-4 ml-8 w-fit text-sm">
      <p>{text}</p>
    </div>
  )
}
