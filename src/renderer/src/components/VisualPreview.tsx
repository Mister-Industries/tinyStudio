/**
 * VisualPreview: runs a project's p5.js sketch (a .js file, conventionally
 * visual.js) live inside its editor tab.
 *
 * A sketch is code from wherever the project came from (an example, someone's
 * GitHub repo) so it runs in a sandboxed iframe (public/sketch-runner) that
 * can't reach the app, the project files or the user's accounts. This component
 * sends it the code, the `theme` object (lib/sketchTheme) and each serial line
 * (lib/serialBus), and shows the errors it reports.
 */

import { AlertTriangle, Pause, Play, RotateCw } from 'lucide-react'
import React from 'react'
import { getSerialBuffer, onSerialLine } from '../lib/serialBus'
import { sketchTheme } from '../lib/sketchTheme'
import { Button } from './ui/Button'

// The desktop app loads from a file, so the runner is a sibling file; the dev
// server and the web app serve it from the site root (deep links included).
const RUNNER_URL =
  window.location.protocol === 'file:' ? './sketch-runner/index.html' : '/sketch-runner/index.html'

type RunnerMessage = { type: 'ready' } | { type: 'error'; message: string }

export function VisualPreview({
  code,
  actions
}: {
  code: string
  name?: string
  actions?: React.ReactNode
}): React.JSX.Element {
  const frame = React.useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = React.useState(false)
  const [running, setRunning] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  const [runId, setRunId] = React.useState(0)

  const post = React.useCallback((message: unknown): void => {
    // The runner's origin is opaque (sandboxed), so there is no origin to target.
    frame.current?.contentWindow?.postMessage(message, '*')
  }, [])

  // Only this component's runner may talk to it.
  React.useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frame.current?.contentWindow) return
      const message = event.data as RunnerMessage | undefined
      if (message?.type === 'ready') setReady(true)
      else if (message?.type === 'error') setErr(String(message.message))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // (Re)start when the runner is up, the code changes, or Restart is pressed.
  React.useEffect(() => {
    if (!ready) return
    setErr(null)
    if (!code) {
      post({ type: 'stop' })
      return
    }
    setRunning(true)
    post({ type: 'run', code, theme: { ...sketchTheme() }, serial: getSerialBuffer() })
  }, [ready, code, runId, post])

  // Serial lines and light/dark switches reach the running sketch.
  React.useEffect(() => {
    if (!ready) return
    const offLine = onSerialLine((line) => post({ type: 'serial', line }))
    // sketchTheme() refills its object on the same mutation, and its observer
    // was registered first, so the copy sent here is already current.
    const theme = sketchTheme()
    const observer = new MutationObserver(() => post({ type: 'theme', theme: { ...theme } }))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme']
    })
    return () => {
      offLine()
      observer.disconnect()
    }
  }, [ready, post])

  const toggle = (): void => {
    post({ type: running ? 'pause' : 'resume' })
    setRunning(!running)
  }

  return (
    <div className="size-full flex flex-col bg-[var(--bg)]">
      <div className="flex items-center gap-2 px-3.5 h-[44px] border-b-[1.5px] border-[var(--border-default)] bg-[var(--bg-raised)]">
        <Button variant="default" size="sm" onClick={toggle} disabled={!code || !ready}>
          {running ? <Pause size={14} className="fill-current" /> : <Play size={14} />}
          {running ? 'Pause' : 'Run'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setRunId((n) => n + 1)}
          disabled={!code || !ready}
        >
          <RotateCw size={13} /> Restart
        </Button>
        {(err || !ready || !running) && code && (
          <span className="text-[11px] font-mono text-[var(--text-muted)]">
            {err ? 'error' : !ready ? 'starting…' : 'paused'}
          </span>
        )}
        <div className="flex-1" />
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      <div
        className="flex-1 min-h-0 flex items-center justify-center px-[22px] py-9 dot-grid"
        style={{ containerType: 'size' }}
      >
        {/* The runner stays mounted while the file is empty, so it's ready the
            moment there is code to run. */}
        <div
          className="relative aspect-square overflow-hidden rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-default)] shadow-[var(--shadow-soft)]"
          style={{
            background: 'var(--bg-raised)',
            width: 'min(100cqw, 100cqh)',
            display: code ? undefined : 'none'
          }}
        >
          <iframe
            ref={frame}
            src={RUNNER_URL}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            title="Visual sketch"
            className="block size-full border-0"
          />
          {err && (
            <div className="absolute inset-x-0 bottom-0 max-h-[50%] overflow-auto bg-[var(--bg-raised)] border-t-[1.5px] border-[var(--border-default)] text-xs text-[var(--status-error)] font-mono p-4">
              <AlertTriangle size={14} className="inline -mt-0.5 mr-1.5" />
              Sketch error:
              <br />
              {err}
            </div>
          )}
        </div>
        {!code && (
          <div className="text-center text-[var(--text-faint)]">
            <Play size={40} className="mx-auto" />
            <div className="mt-2.5 text-sm">
              No p5.js sketch in this file.
              <br />
              Add a <span className="font-mono">visual.js</span> to see a live visual.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
