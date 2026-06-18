/**
 * VisualPreview — runs a project's p5.js sketch (a .js file, conventionally
 * visual.js) live inside its editor tab. Uses a `with(p)` shim so global-style
 * sketches work, and exposes a Processing-style serial API (serialValue(),
 * serialEvent(line), …) fed from the serial monitor via window.__tinySerial.
 */

import { AlertTriangle, Pause, Play, RotateCw } from 'lucide-react'
import React from 'react'

declare global {
  interface Window {
    p5?: any
    __tinySerial?: { lines: string[]; values: number[]; last: string; value: number }
  }
}

export function VisualPreview({ code, name }: { code: string; name: string }): React.JSX.Element {
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
          let k = 0
          const kick = (): void => {
            if (k++ > 6 || !p5ref.current) return
            try {
              p.redraw()
            } catch {
              /* ignore */
            }
            setTimeout(kick, 60)
          }
          setTimeout(kick, 40)
        }
        p.__onSerial = (ev: CustomEvent): void => {
          try {
            if (typeof p.serialEvent === 'function') p.serialEvent(ev.detail.line)
            p.redraw()
          } catch {
            /* ignore */
          }
        }
        window.addEventListener('tinyserial', p.__onSerial as EventListener)
      }, holder.current)
      p5ref.current = inst
      setRunning(true)
    } catch (e) {
      setErr(String(e))
    }
    return () => {
      if (inst) {
        try {
          window.removeEventListener('tinyserial', inst.__onSerial)
        } catch {
          /* ignore */
        }
        inst.remove()
      }
    }
  }, [code, runId, hasP5])

  const toggle = (): void => {
    if (!p5ref.current) return
    if (running) p5ref.current.noLoop()
    else p5ref.current.loop()
    setRunning(!running)
  }

  return (
    <div className="size-full flex flex-col bg-navy-900">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-navy-600">
        <button
          className="h-8 px-3 flex items-center gap-1.5 rounded-full bg-cyan text-[var(--fg-on-cyan)] text-xs font-semibold disabled:opacity-50"
          onClick={toggle}
          disabled={!code || !hasP5}
        >
          {running ? <Pause size={14} /> : <Play size={14} />}
          {running ? 'Pause' : 'Run'}
        </button>
        <button
          className="h-8 px-3 flex items-center gap-1.5 rounded-full border border-navy-400 text-fg-2 text-xs hover:bg-navy-500 disabled:opacity-50"
          onClick={() => setRunId((n) => n + 1)}
          disabled={!code || !hasP5}
        >
          <RotateCw size={13} /> Restart
        </button>
        <span className="text-[11px] font-semibold tracking-wider text-fg-3 truncate">
          P5.JS · {name.toUpperCase()}
        </span>
        <div className="flex-1" />
        <span className="text-[11px] font-mono text-fg-3">
          {err ? 'error' : !hasP5 ? 'loading p5…' : running ? '60 fps' : 'paused'}
        </span>
      </div>
      <div className="flex-1 flex items-center justify-center p-6" style={{ background: 'var(--navy-1000)' }}>
        {code ? (
          <div ref={holder} className="flex items-center justify-center">
            {err && (
              <div className="text-xs text-signal-error font-mono max-w-md">
                <AlertTriangle size={14} className="inline -mt-0.5 mr-1.5" />
                Sketch error:
                <br />
                {err}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-fg-4">
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
