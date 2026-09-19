/* global p5 */
/**
 * tinyStudio sketch runner: runs a visual.js p5 sketch inside a sandboxed
 * iframe. The parent (components/VisualPreview) sends:
 *
 *   { type: 'run', code, theme, serial }   start (or restart) a sketch
 *   { type: 'theme', theme }               the app switched light/dark
 *   { type: 'serial', line }               a line the board printed
 *   { type: 'pause' } / { type: 'resume' } / { type: 'stop' }
 *
 * and receives { type: 'ready' } once, then { type: 'error', message } for
 * anything the sketch throws.
 */
;(() => {
  const CALLBACKS = [
    'preload',
    'setup',
    'draw',
    'mousePressed',
    'mouseReleased',
    'mouseClicked',
    'mouseMoved',
    'mouseDragged',
    'mouseWheel',
    'doubleClicked',
    'keyPressed',
    'keyReleased',
    'keyTyped',
    'touchStarted',
    'touchMoved',
    'touchEnded',
    'windowResized',
    'serialEvent'
  ]
  const MAX_LINES = 300
  const stage = document.getElementById('stage')

  let serial = { lines: [], values: [], last: '', value: 0 }
  /** Filled in place, because sketches keep a reference to it. */
  const theme = {}
  let instance = null
  /** Lines received since the last frame, handed to serialEvent() before draw(). */
  let pending = []

  const post = (message) => window.parent.postMessage(message, '*')
  const report = (error) =>
    post({ type: 'error', message: String(error && error.message ? error.message : error) })

  const numberIn = (line) => {
    const match = String(line).match(/-?\d+(?:\.\d+)?/)
    if (match) return parseFloat(match[0])
    return /(HIGH|\bON\b|true)/i.test(line) ? 1 : 0
  }

  const pushLine = (line) => {
    const value = numberIn(line)
    serial.lines.push(line)
    serial.values.push(value)
    if (serial.lines.length > MAX_LINES) serial.lines.shift()
    if (serial.values.length > MAX_LINES) serial.values.shift()
    serial.last = line
    serial.value = value
    pending.push(line)
    if (pending.length > MAX_LINES) pending.shift()
  }

  // Processing-style serial helpers, in scope for the sketch.
  const helpers = {
    serialRead: () => serial.last,
    serialReadLine: () => serial.last,
    serialAvailable: () => serial.lines.length > 0,
    serialValue: () => serial.value,
    serialValues: () => serial.values.slice(),
    serialLines: () => serial.lines.slice()
  }
  const helperNames = Object.keys(helpers)

  const stop = () => {
    if (instance) instance.remove()
    instance = null
    pending = []
  }

  const run = (code) => {
    stop()
    let factory
    try {
      // Global-style sketches: `with (p)` puts p5's API in scope, and any
      // callback the sketch defines is handed to the instance.
      const hookup = CALLBACKS.map(
        (name) => `if (typeof ${name} === 'function') p.${name} = ${name};`
      ).join('\n')
      factory = new Function('p', 'theme', ...helperNames, `with (p) {\n${code}\n${hookup}\n}`)
    } catch (error) {
      report(error)
      return
    }
    try {
      instance = new p5((p) => {
        try {
          factory(p, theme, ...helperNames.map((name) => helpers[name]))
        } catch (error) {
          report(error)
        }
        const setup = p.setup
        p.setup = function () {
          try {
            if (setup) setup.call(p)
          } catch (error) {
            report(error)
          }
        }
        const draw = p.draw
        p.draw = function () {
          const lines = pending
          pending = []
          if (typeof p.serialEvent === 'function') {
            for (const line of lines) {
              try {
                p.serialEvent(line)
              } catch {
                // a bad line shouldn't stop the sketch
              }
            }
          }
          if (!draw) return
          try {
            draw.call(p)
          } catch (error) {
            report(error)
            p.noLoop()
          }
        }
      }, stage)
    } catch (error) {
      report(error)
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return
    const message = event.data || {}
    switch (message.type) {
      case 'run':
        Object.assign(theme, message.theme || {})
        if (message.serial && Array.isArray(message.serial.lines)) {
          serial = {
            lines: message.serial.lines.slice(-MAX_LINES),
            values: (message.serial.values || []).slice(-MAX_LINES),
            last: message.serial.last || '',
            value: message.serial.value || 0
          }
        }
        run(String(message.code || ''))
        break
      case 'theme':
        Object.assign(theme, message.theme || {})
        break
      case 'serial':
        pushLine(String(message.line))
        break
      case 'pause':
        if (instance) instance.noLoop()
        break
      case 'resume':
        if (instance) instance.loop()
        break
      case 'stop':
        stop()
        break
    }
  })

  post({ type: 'ready' })
})()
