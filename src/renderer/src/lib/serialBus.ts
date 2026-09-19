/**
 * serialBus: the lines the board prints over serial, shared by everything that
 * reads them: the Visual sketch runner (components/VisualPreview) and Studio AI's
 * read_serial tool (lib/studioBridge). SerialProvider pushes each line here.
 */

export interface SerialBuffer {
  /** the most recent lines, oldest first */
  lines: string[]
  /** the first number in each of those lines (1 for HIGH / ON / true, else 0) */
  values: number[]
  last: string
  value: number
}

const MAX_LINES = 300

let buffer: SerialBuffer = { lines: [], values: [], last: '', value: 0 }
const listeners = new Set<(line: string) => void>()

export const getSerialBuffer = (): SerialBuffer => buffer

/** Call `listener` with each line as it arrives. Returns an unsubscribe. */
export function onSerialLine(listener: (line: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function pushSerialLine(line: string): void {
  const match = line.match(/-?\d+(?:\.\d+)?/)
  const value = match ? parseFloat(match[0]) : /(HIGH|\bON\b|true)/i.test(line) ? 1 : 0
  buffer = {
    lines: [...buffer.lines.slice(-(MAX_LINES - 1)), line],
    values: [...buffer.values.slice(-(MAX_LINES - 1)), value],
    last: line,
    value
  }
  for (const listener of listeners) listener(line)
}
