/**
 * VisualPreview — runs a project's p5.js sketch (a .js file, conventionally
 * visual.js) live inside its editor tab. Uses a `with(p)` shim so global-style
 * sketches work, and exposes a Processing-style serial API (serialValue(),
 * serialEvent(line), …) fed from the serial monitor via window.__tinySerial.
 */

import { AlertTriangle, Pause, Play, RotateCw } from 'lucide-react'
import React from 'react'
import { Button } from './ui/Button'

declare global {
  interface Window {
    p5?: any
    __tinySerial?: { lines: string[]; values: number[]; last: string; value: number }
  }
}

export function VisualPreview({
  code,
  actions
}: {
  code: string
  name?: string
  actions?: React.ReactNode
}): React.JSX.Element {
  const holder = React.useRef<HTMLDivElement>(null)
  const p5ref = React.useRef<any>(null)
  const [running, setRunning] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  const [runId, setRunId] = React.useState(0)
  const [hasP5, setHasP5] = React.useState(!!window.p5)

  // p5 is loaded from a CDN script tag; wait for it if not ready yet.
  React.useEffect(() => {
    if (window.p5) {
      setHasP5(true)
      return
    }
    const t = setInterval(() => {
      if (window.p5) {
        setHasP5(true)
        clearInterval(t)
      }
    }, 200)
    return () => clearInterval(t)
  }, [])

  React.useEffect(() => {
    setErr(null)
    if (!window.p5 || !holder.current || !code) return
    let inst: any = null
    const serialPrelude = `
      function __ts(){ return window.__tinySerial || {lines:[],values:[],last:'',value:0}; }
      function serialRead(){ return __ts().last; }
      function serialReadLine(){ return __ts().last; }
      function serialAvailable(){ return __ts().lines.length > 0; }
      function serialValue(){ return __ts().value; }
      function serialValues(){ return __ts().values.slice(); }
      function serialLines(){ return __ts().lines.slice(); }
    `
    try {
      const factory = new Function(
        'p',
        `with(p){
          ${serialPrelude}
          ${code}
          p.setup = (typeof setup==='function')?setup:p.setup;
          p.draw = (typeof draw==='function')?draw:p.draw;
          if(typeof mousePressed==='function') p.mousePressed=mousePressed;
          if(typeof serialEvent==='function') p.serialEvent=serialEvent;
        }`
      )
      inst = new window.p5((p: any) => {
        try {
          factory(p)
        } catch (e) {
          setErr(String(e))
        }
        const origSetup = p.setup
        p.setup = function () {
          try {
            if (origSetup) origSetup.call(p)
          } catch (e) {
            setErr(String(e))
          }
          if (p.canvas) {
            p.canvas.style.maxWidth = '100%'
            p.canvas.style.maxHeight = '100%'
          }
        }
        // Deliver serial lines to the sketch's serialEvent() deterministically:
        // each frame, replay any lines that arrived since the last frame. This
        // is reliable (no dependence on DOM-event timing) and stays in sync with
        // the draw loop. `window.__tinySerial.lines` is the shared serial buffer.
        let lastLen = window.__tinySerial ? window.__tinySerial.lines.length : 0
        const origDraw = p.draw
        p.draw = function () {
          const buf = window.__tinySerial
          if (buf && typeof p.serialEvent === 'function') {
            // If the buffer was cleared/shrank, resync without replaying.
            if (buf.lines.length < lastLen) lastLen = buf.lines.length
            while (lastLen < buf.lines.length) {
              try {
                p.serialEvent(buf.lines[lastLen])
              } catch {
                /* ignore sketch errors */
              }
              lastLen++
            }
          }
          if (origDraw) origDraw.call(p)
        }
      }, holder.current)
      p5ref.current = inst
      setRunning(true)
    } catch (e) {
      setErr(String(e))
    }
    return () => {
      if (inst) inst.remove()
    }
  }, [code, runId, hasP5])

  const toggle = (): void => {
    if (!p5ref.current) return
    if (running) p5ref.current.noLoop()
    else p5ref.current.loop()
    setRunning(!running)
  }

  return (
    <div className="size-full flex flex-col bg-[var(--bg)]">
      <div className="flex items-center gap-2 px-3.5 h-[44px] border-b-[1.5px] border-[var(--border-default)] bg-[var(--bg-raised)]">
        <Button variant="default" size="sm" onClick={toggle} disabled={!code || !hasP5}>
          {running ? <Pause size={14} className="fill-current" /> : <Play size={14} />}
          {running ? 'Pause' : 'Run'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setRunId((n) => n + 1)}
          disabled={!code || !hasP5}
        >
          <RotateCw size={13} /> Restart
        </Button>
        {(err || !hasP5 || !running) && (
          <span className="text-[11px] font-mono text-[var(--text-muted)]">
            {err ? 'error' : !hasP5 ? 'loading p5…' : 'paused'}
          </span>
        )}
        <div className="flex-1" />
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      <div
        className="flex-1 min-h-0 flex items-center justify-center px-[22px] py-9 dot-grid"
        style={{ containerType: 'size' }}
      >
        {code ? (
          <div
            ref={holder}
            className="flex items-center justify-center aspect-square overflow-hidden rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-default)] shadow-[var(--shadow-soft)] [&>canvas]:!w-full [&>canvas]:!h-full [&>canvas]:object-contain"
            style={{ background: '#14161A', width: 'min(100cqw, 100cqh)' }}
          >
            {err && (
              <div className="text-xs text-[var(--status-error)] font-mono max-w-md p-4">
                <AlertTriangle size={14} className="inline -mt-0.5 mr-1.5" />
                Sketch error:
                <br />
                {err}
              </div>
            )}
          </div>
        ) : (
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
