// "Run tinyService" prompt for the browser build.
//
// Compile / upload / serial all go through tinyService, a small local WebSocket
// backend (see WebSocketArduinoService.ts). The desktop app launches it for you;
// in the browser the user runs it themselves. This banner watches the live
// connection state and, when nothing is listening, shows a copy-paste command to
// start it. It hides automatically once connected, and is never shown in the
// Electron build (which auto-starts the backend).

import { Check, Copy, Server, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isElectron } from '@renderer/lib/utils'
import { getArduinoService } from '@renderer/services/arduino/ArduinoServiceFactory'
import { Button } from './ui/Button'

const INSTALL_CMD = 'npx @mister-industries/tinyservice'

export function BackendPrompt(): React.JSX.Element | null {
  // Assume connected during the initial grace period so we don't flash the
  // prompt before the first WebSocket attempt resolves.
  const [connected, setConnected] = useState(true)
  const [dismissed, setDismissed] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (isElectron()) return // desktop starts tinyService itself
    const service = getArduinoService()

    const grace = setTimeout(() => {
      if (!service.isConnected()) setConnected(false)
    }, 5000)

    const off = service.onConnectionChange((isConn) => {
      setConnected(isConn)
      // A fresh disconnect re-arms the prompt even if previously dismissed.
      if (!isConn) setDismissed(false)
    })

    return () => {
      clearTimeout(grace)
      off()
    }
  }, [])

  if (isElectron() || connected || dismissed) return null

  const copy = (): void => {
    navigator.clipboard
      .writeText(INSTALL_CMD)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {
        /* clipboard blocked; user can select the text manually */
      })
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 w-[380px] rounded-lg border border-border bg-background shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Server size={16} />
          Start tinyService to build &amp; flash
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
      <div className="px-4 py-3 text-sm text-muted-foreground">
        <p>
          Compiling, uploading, and the serial monitor run through a small local backend. Run this
          in a terminal — the app reconnects automatically:
        </p>
        <div className="mt-2 flex items-center gap-2 rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">
          <code className="flex-1 select-all break-all">{INSTALL_CMD}</code>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </Button>
        </div>
        <p className="mt-2 text-xs">
          Tip: use <span className="font-medium text-foreground">Chrome</span> or{' '}
          <span className="font-medium text-foreground">Edge</span> — they allow the local
          connection from a hosted page.
        </p>
      </div>
    </div>
  )
}
