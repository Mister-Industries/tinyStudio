/**
 * Shared serial → visual bridge. Whoever owns the live serial connection (the
 * Serial Monitor panel in Code view, or the Visual view when the panel is
 * closed) pushes each incoming line here. It updates window.__tinySerial and
 * dispatches a `tinyserial` event so a running p5 sketch can react via
 * serialValue() / serialValues() / serialEvent(line).
 */

export interface TinySerialBuffer {
  lines: string[]
  values: number[]
  last: string
  value: number
}

declare global {
  interface Window {
    __tinySerial?: TinySerialBuffer
  }
}

export function pushSerialLine(line: string): void {
  const m = line.match(/-?\d+(?:\.\d+)?/)
  const value = m ? parseFloat(m[0]) : /(HIGH|\bON\b|true)/i.test(line) ? 1 : 0
  const buf: TinySerialBuffer = window.__tinySerial || { lines: [], values: [], last: '', value: 0 }
  buf.lines = [...buf.lines.slice(-300), line]
  buf.values = [...buf.values.slice(-300), value]
  buf.last = line
  buf.value = value
  window.__tinySerial = buf
  try {
    window.dispatchEvent(new CustomEvent('tinyserial', { detail: { line, value } }))
  } catch {
    /* ignore */
  }
}
